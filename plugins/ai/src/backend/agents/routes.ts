import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import type { Client, ClientChannel } from "ssh2";
import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  createAiGate,
  readPrivateAllowlist,
  resolveAiAccess,
} from "../gating.js";
import { createProviderFetch } from "../providers/http.js";
import type { AiRepository } from "../repository.js";
import {
  AGENTS,
  clipText,
  compatible,
  shellQuote,
  validStart,
  type AgentEvent,
  type AgentSession,
  type QueuedPrompt,
  type AgentAttachment,
} from "./types.js";
import { registerInstallRoute } from "./install.js";
import { workspaceOperation } from "./workspace.js";
import { promptInput, updateSession, updateQueue } from "./session-state.js";
import { REMOTE_RUNNER } from "./remote-runner.js";
import { EVENT_HISTORY, type AgentStore } from "./store.js";

interface Live {
  session: AgentSession;
  channel?: ClientChannel;
  dispose: () => void;
  subscribers: Set<Response>;
  approvals: Set<string>;
  /** Events not yet written; flushed together at most once a second. */
  pending: AgentEvent[];
  saved: Promise<void>;
  stopping?: Promise<void>;
  draining?: boolean;
  flush?: ReturnType<typeof setTimeout>;
}
const MAX_BODY = 16 * 1024 * 1024;
const PROVIDER_PATHS = new Set([
  "/chat/completions",
  "/responses",
  "/messages",
  "/messages/count_tokens",
  "/models",
]);
export function providerPath(raw: string): string | null {
  const url = new URL(raw, "http://localhost");
  const path = url.pathname.replace(/^\/v1(?=\/)/, "");
  return PROVIDER_PATHS.has(path) ? path : null;
}

export function registerAgentRoutes(
  router: Router,
  repository: AiRepository,
  ctx: PluginContext,
  store: AgentStore,
): void {
  const live = new Map<string, Live>();
  const actor = () => ctx.currentActor() as string;
  /** Writes are queued per session, so rows land in the order they happened. */
  const write = (entry: Live, full: boolean) => {
    entry.saved = entry.saved
      .catch(() => undefined)
      .then(async () => {
        const session = { ...entry.session };
        await store.append(session, entry.pending.splice(0));
        if (full) await store.save(session);
      });
    return entry.saved;
  };
  const save = (entry: Live) => write(entry, true);
  const logFailure = (error: unknown) =>
    ctx.log.error(
      "Agent session could not be saved",
      error instanceof Error ? error : new Error(String(error)),
    );
  const event = (entry: Live, input: Omit<AgentEvent, "seq">) => {
    const s = entry.session;
    const item = {
      ...input,
      seq: (s.events.at(-1)?.seq ?? 0) + 1,
      text: clipText(input.text.slice(0, 32000)),
    };
    s.events.push(item);
    if (s.events.length > EVENT_HISTORY) s.events.shift();
    entry.pending.push(item);
    s.updatedAt = new Date().toISOString();
    for (const res of entry.subscribers) {
      if (!res.write(`id: ${item.seq}\ndata: ${JSON.stringify(item)}\n\n`))
        res.end();
    }
    if (!entry.flush)
      entry.flush = setTimeout(() => {
        entry.flush = undefined;
        write(entry, false).catch(logFailure);
      }, 1000);
  };
  async function allowed(s: AgentSession) {
    return (
      (await resolveAiAccess(ctx.settings, s.userId)).enabled &&
      (await ctx.rbac.hasFor(s.userId, "agents")) &&
      (await ctx.hosts.checkAccess(s.hostId, "connect")).hasAccess
    );
  }
  async function find(id: string): Promise<AgentSession> {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid session ID");
    const s = live.get(id)?.session ?? (await store.get(actor(), id));
    if (!s || s.userId !== actor() || !(await allowed(s)))
      throw Error("Agent session is not accessible");
    return live.has(id) ? s : { ...s, status: "stopped" };
  }
  function stop(entry: Live): Promise<void> {
    if (entry.stopping) return entry.stopping;
    if (live.get(entry.session.id) !== entry) return Promise.resolve();
    entry.stopping = (async () => {
      if (entry.channel && !entry.channel.destroyed) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          entry.channel!.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
          entry.channel!.write(JSON.stringify({ type: "stop" }) + "\n");
        });
      }
      if (live.get(entry.session.id) === entry) live.delete(entry.session.id);
      entry.dispose();
      entry.session.status = "stopped";
      event(entry, { kind: "status", text: "stopped" });
      // The save below writes everything pending.
      clearTimeout(entry.flush);
      for (const res of entry.subscribers) res.end();
      await save(entry);
    })();
    return entry.stopping;
  }
  ctx.disposables.add(() => {
    for (const entry of live.values()) stop(entry);
  });
  ctx.events.on("user.deleted", (payload) => {
    const id = (payload as { userId?: string }).userId;
    for (const entry of live.values())
      if (entry.session.userId === id) stop(entry);
  });

  async function persist(s: AgentSession) {
    const entry = live.get(s.id);
    s.updatedAt = new Date().toISOString();
    if (entry) {
      event(entry, { kind: "state", text: "" });
      await save(entry);
    } else await store.save(s);
  }
  async function dispatch(entry: Live, prompt: QueuedPrompt) {
    const s = entry.session;
    if (s.status !== "ready" || entry.stopping || !entry.channel)
      throw Error("Agent is not ready");
    s.status = "running";
    s.queue = s.queue?.filter((p) => p.id !== prompt.id);
    event(entry, {
      kind: "user",
      text:
        prompt.text +
        (prompt.attachmentIds.length
          ? "\n" +
            prompt.attachmentIds
              .map((id) => s.attachments!.find((a) => a.id === id)!.name)
              .join("\n")
          : ""),
    });
    event(entry, { kind: "status", text: "running" });
    event(entry, { kind: "state", text: "" });
    await save(entry);
    entry.channel.write(
      JSON.stringify({
        type: "prompt",
        text: prompt.text,
        attachments: prompt.attachmentIds.map((id) =>
          s.attachments!.find((a) => a.id === id),
        ),
      }) + "\n",
    );
  }
  function drain(entry: Live) {
    if (entry.draining || entry.stopping) return;
    entry.draining = true;
    void ctx
      .asUser(entry.session.userId, async () => {
        const s = entry.session;
        if (!(await allowed(s))) return stop(entry);
        if (
          s.status === "ready" &&
          !s.queuePaused &&
          !s.archived &&
          s.queue?.length &&
          !entry.stopping
        )
          await dispatch(entry, s.queue[0]);
      })
      .catch((error) => {
        entry.session.queuePaused = true;
        event(entry, { kind: "error", text: String(error.message || error) });
      })
      .finally(() => {
        entry.draining = false;
      });
  }

  async function start(s: AgentSession): Promise<Live> {
    const existing = live.get(s.id);
    if (existing?.stopping) await existing.stopping;
    else if (existing) return existing;
    if (
      [...live.values()].filter((e) => e.session.userId === s.userId).length >=
      4
    )
      throw Error(
        "Stop an agent before opening another (maximum 4 active sessions)",
      );
    const provider = await repository.findProviderWithSecret(
      s.providerId,
      s.userId,
    );
    if (!provider?.enabled || !compatible(s.agent, provider.providerType))
      throw Error("Provider protocol is not compatible with this agent");
    const connection = await ctx.ssh.connect<Client>(s.hostId, {
      purpose: "ai-agent",
      profile: "session",
      timeoutMs: 15000,
    });
    const entry: Live = {
      // History is loaded so a resumed session keeps numbering its events.
      session: { ...s, status: "starting", events: await store.events(s.id) },
      dispose: connection.dispose,
      subscribers: new Set(),
      approvals: new Set(),
      pending: [],
      saved: Promise.resolve(),
    };
    live.set(s.id, entry);
    const token = randomBytes(32).toString("hex");
    const aborters = new Set<AbortController>();
    let port = 0;
    const proxy = createServer((req, res) => {
      const controller = new AbortController();
      aborters.add(controller);
      res.on("close", () => {
        controller.abort();
        aborters.delete(controller);
      });
      void ctx
        .asUser(s.userId, async () => {
          const path = providerPath(req.url ?? "/");
          const auth =
            req.headers.authorization === `Bearer ${token}` ||
            req.headers["x-api-key"] === token;
          if (!auth || !path || !["GET", "POST"].includes(req.method ?? "")) {
            res.writeHead(403).end();
            return;
          }
          if (!(await allowed(s))) {
            res.writeHead(403).end();
            stop(entry);
            return;
          }
          const current = await repository.findProviderWithSecret(
            s.providerId,
            s.userId,
          );
          if (!current?.enabled) {
            res.writeHead(403).end();
            return;
          }
          let body = "";
          for await (const chunk of req) {
            body += chunk.toString();
            if (Buffer.byteLength(body) > MAX_BODY) {
              res.writeHead(413).end();
              return;
            }
          }
          if (body) {
            const parsed = JSON.parse(body);
            if (parsed.model && parsed.model !== s.model) {
              res.writeHead(403).end();
              return;
            }
          }
          const base =
            current.baseUrl ||
            (current.providerType === "anthropic"
              ? "https://api.anthropic.com/v1"
              : "https://api.openai.com/v1");
          const headers: Record<string, string> = {
            "content-type": "application/json",
          };
          if (current.providerType === "anthropic") {
            headers["x-api-key"] = current.apiKey ?? "";
            headers["anthropic-version"] = "2023-06-01";
          } else if (current.apiKey)
            headers.authorization = `Bearer ${current.apiKey}`;
          const response = await createProviderFetch(
            ctx.fetch,
            await readPrivateAllowlist(ctx.settings),
          )(base.replace(/\/$/, "") + path, {
            method: req.method,
            headers,
            body: body || undefined,
            signal: controller.signal,
          });
          res.writeHead(response.status, {
            "Content-Type":
              response.headers.get("content-type") ?? "application/json",
            "Cache-Control": "no-store",
          });
          if (response.body)
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
              if (!res.write(chunk))
                await once(res, "drain", { signal: controller.signal });
            }
          res.end();
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(502);
          res.end('{"error":"Termix provider request failed"}');
        });
    });
    proxy.maxHeadersCount = 30;
    connection.client.on("tcp connection", (info, accept, reject) => {
      if (info.destPort !== port || info.destIP !== "127.0.0.1") {
        reject();
        return;
      }
      proxy.emit("connection", accept());
    });
    const startup = setTimeout(() => {
      if (entry.session.status === "starting") {
        event(entry, { kind: "error", text: "Agent startup timed out" });
        void stop(entry);
      }
    }, 60000);
    startup.unref();
    const expiry = setTimeout(() => stop(entry), 8 * 60 * 60 * 1000);
    expiry.unref();
    const accessTimer = setInterval(() => {
      void ctx
        .asUser(s.userId, async () => {
          if (!(await allowed(s))) stop(entry);
        })
        .catch(() => stop(entry));
    }, 30000);
    accessTimer.unref();
    entry.dispose = () => {
      clearTimeout(startup);
      clearTimeout(expiry);
      clearInterval(accessTimer);
      for (const c of aborters) c.abort();
      proxy.close();
      connection.dispose();
    };
    try {
      port = await new Promise<number>((resolve, reject) =>
        connection.client.forwardIn("127.0.0.1", 0, (err, p) =>
          err
            ? reject(
                Error(
                  "SSH remote forwarding was refused. Allow loopback remote forwarding for this SSH account (AllowTcpForwarding remote and PermitListen 127.0.0.1:*). Installing an agent does not change SSH policy.",
                ),
              )
            : resolve(p),
        ),
      );
      const source = Buffer.from(REMOTE_RUNNER).toString("base64");
      const command =
        'export PATH="$HOME/.local/share/termix-agent-runtime/node/bin:$PATH"; command -v node >/dev/null || { echo "Node.js is missing. Use Install runtime first." >&2; exit 1; }; exec node -e ' +
        shellQuote(`eval(Buffer.from('${source}','base64').toString())`);
      const channel = await new Promise<ClientChannel>((resolve, reject) =>
        connection.client.exec("sh -lc " + shellQuote(command), (err, ch) =>
          err ? reject(err) : resolve(ch),
        ),
      );
      entry.channel = channel;
      let buffer = "";
      channel.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.length > MAX_BODY) {
          event(entry, {
            kind: "error",
            text: "Agent output exceeded the protocol limit",
          });
          stop(entry);
          return;
        }
        let n: number;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, n);
          buffer = buffer.slice(n + 1);
          try {
            const m = JSON.parse(line);
            if (m.kind === "native" && typeof m.nativeId === "string") {
              entry.session.nativeId = m.nativeId;
              save(entry).catch(logFailure);
              continue;
            }
            if (
              !["text", "tool", "permission", "status", "error"].includes(
                m.kind,
              )
            )
              continue;
            if (
              m.kind === "status" &&
              ["ready", "running", "stopped"].includes(m.text)
            ) {
              if (entry.session.status === m.text) continue;
              entry.session.status = m.text;
            }
            if (m.kind === "error") entry.session.queuePaused = true;
            if (m.kind === "permission" && typeof m.requestId === "string")
              entry.approvals.add(m.requestId);
            event(entry, {
              kind: m.kind,
              text: String(m.text ?? "").replaceAll(token, "[session token]"),
              requestId: m.requestId,
              choices: m.choices,
            });
            if (m.kind === "status" && m.text === "ready") drain(entry);
          } catch {
            /* Ignore non-protocol startup chatter. */
          }
        }
      });
      channel.stderr.on("data", (d: Buffer) =>
        event(entry, {
          kind: "error",
          text: d.toString().replaceAll(token, "[session token]"),
        }),
      );
      channel.on("close", () => stop(entry));
      channel.write(
        JSON.stringify({
          type: "start",
          config: {
            ...s,
            userId: undefined,
            events: undefined,
            proxyUrl: `http://127.0.0.1:${port}`,
            token,
            providerType: provider.providerType,
          },
        }) + "\n",
      );
      await save(entry);
      await ctx.audit.record({
        action: "agent_start",
        resourceId: String(s.hostId),
        success: true,
        details: JSON.stringify({
          agent: s.agent,
          sessionId: s.id,
          providerId: s.providerId,
        }),
      });
      return entry;
    } catch (error) {
      stop(entry);
      throw error;
    }
  }

  const gate = createAiGate(ctx.settings, () => ctx.currentActor());
  router.use("/agents", ctx.rbac.require("agents") as never, gate as never);
  const mutations = new Map<string, Promise<unknown>>();
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response) => {
      const id = req.method !== "GET" ? String(req.params.id ?? "") : "";
      const previous = id ? mutations.get(id) : undefined;
      const operation = (previous ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => fn(req, res));
      if (id) mutations.set(id, operation);
      void operation
        .catch((error) => {
          if (!res.headersSent)
            res.status(400).json({
              error:
                error instanceof Error
                  ? error.message
                  : "Agent operation failed",
            });
        })
        .finally(() => {
          if (id && mutations.get(id) === operation) mutations.delete(id);
        });
    };
  registerInstallRoute(router, ctx, (hostId) =>
    [...live.values()].some((entry) => entry.session.hostId === hostId),
  );
  router.get(
    "/agents",
    route(async (_req, res) => {
      const sessions: AgentSession[] = [];
      for (const stored of await store.list(actor())) {
        if (await allowed(stored))
          sessions.push(
            live.get(stored.id)?.session ?? { ...stored, status: "stopped" },
          );
      }
      res.json({
        agents: AGENTS,
        sessions: sessions
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((s) => ({ ...s, events: undefined, userId: undefined })),
      });
    }),
  );
  router.post(
    "/agents",
    route(async (req, res) => {
      if (!validStart(req.body ?? {}))
        throw Error(
          "Choose an agent, host, provider, model and absolute working directory",
        );
      const s: AgentSession = {
        id: randomUUID(),
        userId: actor(),
        hostId: req.body.hostId,
        providerId: req.body.providerId,
        agent: req.body.agent,
        model: req.body.model,
        cwd: req.body.cwd,
        executable: req.body.executable || req.body.agent,
        status: "starting",
        events: [],
        updatedAt: new Date().toISOString(),
      };
      if (!(await allowed(s))) throw Error("SSH access is required");
      await start(s);
      res.status(201).json({ id: s.id });
    }),
  );
  router.post(
    "/agents/:id/workspace",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      const body = req.body ?? {};
      if (
        ["upload", "reference"].includes(body.operation) &&
        (s.attachments?.length ?? 0) >= 100
      )
        throw Error("Maximum 100 attachments per session");
      const result = await workspaceOperation(ctx, s, body);
      if (["upload", "reference"].includes(body.operation)) {
        s.attachments = [
          ...(s.attachments ?? []),
          result as unknown as AgentAttachment,
        ];
        await persist(s);
      }
      if (["upload", "worktree"].includes(body.operation))
        await ctx.audit.record({
          action: "agent_workspace_" + body.operation,
          resourceId: String(s.hostId),
          success: true,
          details: JSON.stringify({ sessionId: s.id }),
        });
      res.json(result);
    }),
  );
  router.patch(
    "/agents/:id",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      updateSession(s, req.body ?? {});
      if (s.archived) {
        s.queuePaused = true;
        const entry = live.get(s.id);
        if (entry) await stop(entry);
      }
      await persist(s);
      res.json(s);
    }),
  );
  router.post(
    "/agents/:id/queue",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      updateQueue(s, req.body ?? {});
      await persist(s);
      const entry = live.get(s.id);
      if (entry) drain(entry);
      res.json({ queue: s.queue ?? [], queuePaused: !!s.queuePaused });
    }),
  );
  router.get(
    "/agents/:id",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      res.json(live.has(s.id) ? s : { ...s, events: await store.events(s.id) });
    }),
  );
  router.get(
    "/agents/:id/events",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      const after = Number(
        req.headers["last-event-id"] || req.query.after || 0,
      );
      const entry = live.get(s.id);
      const history = entry
        ? s.events.filter((e) => e.seq > after)
        : await store.events(s.id, after);
      for (const e of history)
        res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
      if (!entry) {
        res.write(
          `event: snapshot\ndata: ${JSON.stringify({ status: "stopped" })}\n\n`,
        );
        res.end();
        return;
      }
      entry.subscribers.add(res);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        entry.subscribers.delete(res);
      });
    }),
  );
  router.post(
    "/agents/:id/resume",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      if (s.archived) throw Error("Restore the archived session first");
      await start(s);
      res.json({ id: s.id });
    }),
  );
  router.post(
    "/agents/:id/input",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      const entry = live.get(s.id);
      if (!entry?.channel) throw Error("Resume the agent first");
      const { type, text, requestId, allow, value } = req.body ?? {};
      if (type === "prompt") {
        if (s.archived) throw Error("Restore the archived session first");
        await dispatch(entry, promptInput(s, req.body));
        res.json({ ok: true });
        return;
      } else if (type === "answer") {
        if (
          !entry.approvals.has(requestId) ||
          typeof allow !== "boolean" ||
          (value !== undefined &&
            (typeof value !== "string" || value.length > 64000))
        )
          throw Error("Invalid approval response");
        entry.approvals.delete(requestId);
        await ctx.audit.record({
          action: "agent_approval",
          resourceId: String(s.hostId),
          success: true,
          details: JSON.stringify({ sessionId: s.id, requestId, allow }),
        });
      } else if (type === "cancel") {
        s.queuePaused = true;
        await persist(s);
      } else throw Error("Unknown input type");
      entry.channel.write(
        JSON.stringify({ type, text, requestId, allow, value }) + "\n",
      );
      res.json({ ok: true });
    }),
  );
  router.post(
    "/agents/:id/stop",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      const entry = live.get(s.id);
      if (entry) await stop(entry);
      res.json({ ok: true });
    }),
  );
  router.delete(
    "/agents/:id",
    route(async (req, res) => {
      const s = await find(String(req.params.id));
      const entry = live.get(s.id);
      if (entry) await stop(entry);
      await entry?.saved.catch(() => undefined);
      await store.delete(s.id);
      res.json({ ok: true });
    }),
  );
}
