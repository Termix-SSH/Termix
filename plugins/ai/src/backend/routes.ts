import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { buildSystemPrompt } from "./context.js";
import { runAgent } from "./engine.js";
import { getErrorMessage } from "./errors.js";
import {
  createAiGate,
  isAiGloballyEnabled,
  readPrivateAllowlist,
  resolveAiAccess,
} from "./gating.js";
import { createProviderFetch } from "./providers/http.js";
import {
  FALLBACK_MODELS,
  getAdapter,
  REQUIRES_API_KEY,
  REQUIRES_BASE_URL,
} from "./providers/registry.js";
import type {
  AiProviderType,
  ChatMessage,
  ProviderConfig,
} from "./providers/types.js";
import { isAiProviderType } from "./providers/types.js";
import type { AiRepository } from "./repository.js";
import { serviceAvailable } from "./services.js";
import { availableTools } from "./tools/catalog.js";
import { applyProposal } from "./tools/executor.js";
import type { ToolDeps } from "./tools/types.js";

function parseId(raw: unknown): number | null {
  const id = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function actor(ctx: PluginContext): string {
  // Core's plugin router authenticates every request and runs it as that user.
  return ctx.currentActor() as string;
}

/**
 * Mounts every assistant route on the plugin's router, served at
 * /plugin-api/ai. Everything but /status sits behind the AI gate: the admin
 * switch and the user's own opt-in.
 */
export function registerAiRoutes(
  router: Router,
  repository: AiRepository,
  ctx: PluginContext,
): void {
  const aiGate = createAiGate(ctx.settings, () => ctx.currentActor());
  const gate = aiGate as never;
  const toolDeps: ToolDeps = {
    hosts: ctx.hosts,
    services: ctx.services,
    notify: ctx.notify,
    rbac: ctx.rbac,
    ssh: ctx.ssh,
  };

  const logError = (message: string, error: unknown) =>
    ctx.log.error(
      message,
      error instanceof Error ? error : new Error(String(error)),
    );

  const audit = (entry: Parameters<PluginContext["audit"]["record"]>[0]) =>
    ctx.audit.record(entry).catch(() => undefined);

  /** The provider config for an outbound call, with the egress-checked fetch. */
  async function providerConfig(input: {
    providerType: string;
    baseUrl: string | null;
    apiKey: string | null;
  }): Promise<ProviderConfig> {
    const allowlist = await readPrivateAllowlist(ctx.settings);
    return {
      providerType: input.providerType as ProviderConfig["providerType"],
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      fetch: createProviderFetch(ctx.fetch, allowlist),
    };
  }

  /**
   * @openapi
   * /plugin-api/ai/status:
   *   get:
   *     summary: Whether the AI assistant is available to this user
   *     description: >
   *       Deliberately not behind the AI gate: the frontend calls this to decide
   *       whether to render any AI surface at all, and needs a plain answer rather
   *       than a 403 when the feature is off.
   *     tags:
   *       - AI
   *     responses:
   *       200:
   *         description: The effective enablement state.
   */
  router.get("/status", async (_req: Request, res: Response) => {
    const userId = actor(ctx);
    try {
      const [globallyEnabled, access] = await Promise.all([
        isAiGloballyEnabled(ctx.settings),
        resolveAiAccess(ctx.settings, userId),
      ]);
      res.json({
        globallyEnabled,
        enabled: access.enabled,
        allowReadOnlyCommands: access.allowReadOnlyCommands,
      });
    } catch (err) {
      logError("Failed to read AI status", err);
      res.status(500).json({ error: "Failed to read AI status" });
    }
  });

  /**
   * @openapi
   * /plugin-api/ai/opt-in:
   *   put:
   *     summary: Turn the assistant on or off for the current user
   *     description: >
   *       The same value as the user setting "enabled", for the onboarding
   *       step and the panel, which set it outside the settings form. Refused
   *       while the assistant is off for the whole server.
   *     tags:
   *       - AI
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The user's new choice.
   *       400:
   *         description: enabled is not a boolean.
   *       403:
   *         description: The assistant is off for the whole server.
   */
  router.put(
    "/opt-in",
    ctx.rbac.require("use") as never,
    async (req: Request, res: Response) => {
      const { enabled } = req.body ?? {};
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      try {
        // Turning it off is always allowed; turning it on needs the switch.
        if (enabled && !(await isAiGloballyEnabled(ctx.settings))) {
          return res
            .status(403)
            .json({ error: "The AI assistant is not enabled" });
        }
        await ctx.settings.setUser(actor(ctx), "enabled", enabled);
        res.json({ enabled });
      } catch (err) {
        logError("Failed to save the AI opt-in", err);
        res.status(500).json({ error: "Failed to save the setting" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/providers:
   *   get:
   *     summary: List the user's configured AI providers
   *     tags:
   *       - AI
   *     responses:
   *       200:
   *         description: Providers, with API keys masked.
   *       403:
   *         description: The AI assistant is not enabled.
   */
  router.get(
    "/providers",
    ctx.rbac.require("use") as never,
    gate,
    async (_req: Request, res: Response) => {
      try {
        const providers = await repository.listProviders(actor(ctx));
        res.json({ providers });
      } catch (err) {
        logError("Failed to list AI providers", err);
        res.status(500).json({ error: "Failed to list providers" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/providers:
   *   post:
   *     summary: Add an AI provider
   *     tags:
   *       - AI
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               providerType:
   *                 type: string
   *               label:
   *                 type: string
   *               baseUrl:
   *                 type: string
   *               apiKey:
   *                 type: string
   *               defaultModel:
   *                 type: string
   *     responses:
   *       201:
   *         description: Provider created.
   *       400:
   *         description: Invalid request body.
   */
  router.post(
    "/providers",
    ctx.rbac.require("manage_providers") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { providerType, label, baseUrl, apiKey, defaultModel } =
        req.body ?? {};

      if (!isAiProviderType(providerType)) {
        return res.status(400).json({ error: "Unknown provider type" });
      }
      if (typeof label !== "string" || !label.trim()) {
        return res.status(400).json({ error: "label is required" });
      }
      if (REQUIRES_BASE_URL.includes(providerType) && !baseUrl?.trim()) {
        return res
          .status(400)
          .json({ error: "This provider needs a base URL" });
      }
      if (REQUIRES_API_KEY.includes(providerType) && !apiKey?.trim()) {
        return res
          .status(400)
          .json({ error: "This provider needs an API key" });
      }

      try {
        const created = await repository.createProvider(userId, {
          providerType,
          label: label.trim(),
          baseUrl: typeof baseUrl === "string" ? baseUrl.trim() : null,
          apiKey: typeof apiKey === "string" ? apiKey.trim() : null,
          defaultModel:
            typeof defaultModel === "string" ? defaultModel.trim() : null,
        });

        await audit({
          action: "create_ai_provider",
          resourceType: "ai_provider",
          resourceId: String(created.id),
          resourceName: created.label,
          success: true,
        });

        res.status(201).json({ provider: created });
      } catch (err) {
        logError("Failed to create AI provider", err);
        res.status(500).json({ error: "Failed to create provider" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/providers/{id}:
   *   patch:
   *     summary: Update an AI provider
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Provider updated.
   *       404:
   *         description: Provider not found.
   */
  router.patch(
    "/providers/:id",
    ctx.rbac.require("manage_providers") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid provider id" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      if (
        body.providerType !== undefined &&
        !isAiProviderType(body.providerType)
      ) {
        return res.status(400).json({ error: "Unknown provider type" });
      }

      const text = (value: unknown) =>
        typeof value === "string" ? value.trim() : undefined;

      try {
        const updated = await repository.updateProvider(id, userId, {
          providerType: body.providerType as string | undefined,
          label: text(body.label) || undefined,
          baseUrl:
            body.baseUrl === null ? null : (text(body.baseUrl) ?? undefined),
          apiKey: body.apiKey === null ? "" : text(body.apiKey),
          defaultModel:
            body.defaultModel === null
              ? null
              : (text(body.defaultModel) ?? undefined),
          enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        });
        if (!updated)
          return res.status(404).json({ error: "Provider not found" });

        await audit({
          action: "update_ai_provider",
          resourceType: "ai_provider",
          resourceId: String(id),
          resourceName: updated.label,
          success: true,
        });

        res.json({ provider: updated });
      } catch (err) {
        logError("Failed to update AI provider", err);
        res.status(500).json({ error: "Failed to update provider" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/providers/{id}:
   *   delete:
   *     summary: Delete an AI provider
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Provider deleted.
   *       404:
   *         description: Provider not found.
   */
  router.delete(
    "/providers/:id",
    ctx.rbac.require("manage_providers") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid provider id" });

      try {
        const deleted = await repository.deleteProvider(id, userId);
        if (!deleted)
          return res.status(404).json({ error: "Provider not found" });

        await audit({
          action: "delete_ai_provider",
          resourceType: "ai_provider",
          resourceId: String(id),
          success: true,
        });

        res.json({ success: true });
      } catch (err) {
        logError("Failed to delete AI provider", err);
        res.status(500).json({ error: "Failed to delete provider" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/probe-models:
   *   post:
   *     summary: List models for a provider that has not been saved yet
   *     description: >
   *       Lets the add-provider form fill its model picker before the provider
   *       exists, so nobody has to go and look up model names by hand.
   *     tags:
   *       - AI
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               providerType:
   *                 type: string
   *               baseUrl:
   *                 type: string
   *               apiKey:
   *                 type: string
   *               providerId:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Model ids, possibly a curated fallback list.
   *       400:
   *         description: Unknown provider type.
   */
  router.post(
    "/probe-models",
    ctx.rbac.require("manage_providers") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { providerType, baseUrl, apiKey, providerId } = req.body ?? {};

      if (!isAiProviderType(providerType)) {
        return res.status(400).json({ error: "Unknown provider type" });
      }

      try {
        // Editing an existing provider sends no key, so fall back to the
        // stored one rather than making the user retype it.
        let resolvedKey =
          typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
        const storedId = parseId(providerId);
        if (!resolvedKey && storedId) {
          const stored = await repository.findProviderWithSecret(
            storedId,
            userId,
          );
          resolvedKey = stored?.apiKey ?? null;
        }

        const models = await getAdapter(providerType).listModels(
          await providerConfig({
            providerType,
            baseUrl: typeof baseUrl === "string" ? baseUrl.trim() : null,
            apiKey: resolvedKey,
          }),
        );

        res.json({ models, source: "live" });
      } catch (err) {
        // A provider that cannot be reached yet still gets a usable list, so
        // the form is never a blank text box the user has to guess into.
        const fallback = FALLBACK_MODELS[providerType as AiProviderType] ?? [];
        res.json({
          models: fallback,
          source: fallback.length ? "fallback" : "none",
          warning: err instanceof Error ? err.message : undefined,
        });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/providers/{id}/models:
   *   get:
   *     summary: List models available from a provider
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Model ids.
   *       502:
   *         description: The provider could not be reached.
   */
  router.get(
    "/providers/:id/models",
    ctx.rbac.require("use") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid provider id" });

      try {
        const provider = await repository.findProviderWithSecret(id, userId);
        if (!provider)
          return res.status(404).json({ error: "Provider not found" });

        const models = await getAdapter(provider.providerType).listModels(
          await providerConfig(provider),
        );
        res.json({ models });
      } catch (err) {
        // The message can carry the allowlist hint, which the user needs.
        const message = getErrorMessage(err, "Could not reach the provider");
        ctx.log.warn(`Failed to list provider models: ${message}`);
        res.status(502).json({ error: message });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/conversations:
   *   get:
   *     summary: List the user's AI conversations
   *     tags:
   *       - AI
   *     responses:
   *       200:
   *         description: Conversations, newest first.
   */
  router.get(
    "/conversations",
    ctx.rbac.require("use") as never,
    gate,
    async (_req: Request, res: Response) => {
      try {
        const conversations = await repository.listConversations(actor(ctx));
        res.json({ conversations });
      } catch (err) {
        logError("Failed to list AI conversations", err);
        res.status(500).json({ error: "Failed to list conversations" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/conversations/{id}:
   *   get:
   *     summary: Get one conversation with its messages and proposals
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: The conversation.
   *       404:
   *         description: Conversation not found.
   */
  router.get(
    "/conversations/:id",
    ctx.rbac.require("use") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = parseId(req.params.id);
      if (!id)
        return res.status(400).json({ error: "Invalid conversation id" });

      try {
        const conversation = await repository.findConversation(id, userId);
        if (!conversation) {
          return res.status(404).json({ error: "Conversation not found" });
        }

        const [messages, proposals] = await Promise.all([
          repository.listMessages(id),
          repository.listProposals(userId, id),
        ]);

        res.json({ conversation, messages, proposals });
      } catch (err) {
        logError("Failed to load AI conversation", err);
        res.status(500).json({ error: "Failed to load conversation" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/conversations/{id}:
   *   delete:
   *     summary: Delete a conversation
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Conversation deleted.
   */
  router.delete(
    "/conversations/:id",
    ctx.rbac.require("use") as never,
    gate,
    async (req: Request, res: Response) => {
      const id = parseId(req.params.id);
      if (!id)
        return res.status(400).json({ error: "Invalid conversation id" });

      try {
        const deleted = await repository.deleteConversation(id, actor(ctx));
        if (!deleted) {
          return res.status(404).json({ error: "Conversation not found" });
        }
        res.json({ success: true });
      } catch (err) {
        logError("Failed to delete AI conversation", err);
        res.status(500).json({ error: "Failed to delete conversation" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/chat/stream:
   *   post:
   *     summary: Send a message and stream the assistant's reply
   *     description: >
   *       Server-sent events. Emits conversation, token, tool_call,
   *       tool_result, proposal, done and error frames.
   *     tags:
   *       - AI
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               conversationId:
   *                 type: integer
   *               providerId:
   *                 type: integer
   *               model:
   *                 type: string
   *               message:
   *                 type: string
   *               activeTab:
   *                 type: string
   *     responses:
   *       200:
   *         description: An event stream.
   *       400:
   *         description: Invalid request body.
   */
  router.post(
    "/chat/stream",
    ctx.rbac.require("use") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const { conversationId, providerId, model, message, activeTab } =
        req.body ?? {};

      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "message is required" });
      }

      const resolvedProviderId = parseId(providerId);
      if (!resolvedProviderId) {
        return res.status(400).json({ error: "providerId is required" });
      }

      try {
        const provider = await repository.findProviderWithSecret(
          resolvedProviderId,
          userId,
        );
        if (!provider) {
          return res.status(404).json({ error: "Provider not found" });
        }

        const chosenModel =
          (typeof model === "string" && model.trim()) ||
          provider.defaultModel ||
          "";
        if (!chosenModel) {
          return res.status(400).json({ error: "No model selected" });
        }

        // Resolve or create the conversation before the stream opens, so a
        // failure here is still a normal JSON error the client can render.
        let conversation = conversationId
          ? await repository.findConversation(Number(conversationId), userId)
          : null;
        if (!conversation) {
          conversation = await repository.createConversation({
            userId,
            title: message.trim().slice(0, 60),
            providerId: resolvedProviderId,
            model: chosenModel,
          });
        }

        const history = await repository.listMessages(conversation.id);
        await repository.appendMessage({
          conversationId: conversation.id,
          role: "user",
          content: message.trim(),
        });

        const access = (
          req as Request & { aiAccess?: { allowReadOnlyCommands: boolean } }
        ).aiAccess ?? { allowReadOnlyCommands: false };
        const hosts = await ctx.hosts.list();
        const config = await providerConfig(provider);
        const tools = availableTools((service) =>
          serviceAvailable(ctx.services, service),
        );

        // no-transform keeps core's compression from buffering the stream,
        // and X-Accel-Buffering does the same for nginx.
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders?.();

        const heartbeat = setInterval(() => {
          try {
            res.write(": keepalive\n\n");
          } catch {
            clearInterval(heartbeat);
          }
        }, 30000);

        const abort = new AbortController();
        req.on("close", () => {
          clearInterval(heartbeat);
          abort.abort();
        });

        const send = (event: unknown) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        send({ type: "conversation", conversationId: conversation.id });

        const chatHistory: ChatMessage[] = history.map((entry) => ({
          role: entry.role as ChatMessage["role"],
          content: entry.content,
          ...(entry.toolCalls
            ? { toolCalls: JSON.parse(entry.toolCalls) }
            : {}),
        }));
        chatHistory.push({ role: "user", content: message.trim() });

        let assistantText = "";
        let assistantToolCalls: unknown[] = [];

        try {
          for await (const event of runAgent({
            config,
            model: chosenModel,
            system: buildSystemPrompt({
              hostCount: hosts.length,
              activeTab: typeof activeTab === "string" ? activeTab : null,
              allowReadOnlyCommands: access.allowReadOnlyCommands,
            }),
            history: chatHistory,
            context: {
              userId,
              conversationId: conversation.id,
              allowReadOnlyCommands: access.allowReadOnlyCommands,
              deps: toolDeps,
            },
            tools,
            signal: abort.signal,
          })) {
            if (event.type === "assistant_message") {
              assistantText = event.content;
              // Kept so the next message replays them verbatim. Gemini rejects
              // a turn whose functionCall parts lost their thoughtSignature.
              assistantToolCalls = event.toolCalls;
              continue;
            }

            if (event.type === "proposal") {
              const stored = await repository.createProposal({
                conversationId: conversation.id,
                userId,
                kind: event.draft.kind,
                summary: event.draft.summary,
                payload: JSON.stringify(event.draft.payload),
              });

              await audit({
                action: "ai_proposal_created",
                resourceType: "ai_proposal",
                resourceId: String(stored.id),
                resourceName: event.draft.kind,
                success: true,
              });

              send({ type: "proposal", proposal: stored });
              continue;
            }

            send(event);
          }
        } finally {
          clearInterval(heartbeat);
        }

        if (assistantText || assistantToolCalls.length) {
          await repository.appendMessage({
            conversationId: conversation.id,
            role: "assistant",
            content: assistantText,
            toolCalls: assistantToolCalls.length
              ? JSON.stringify(assistantToolCalls)
              : null,
          });
        }
        await repository.touchConversation(conversation.id);

        send({ type: "done" });
        res.end();
      } catch (err) {
        logError("AI chat stream failed", err);
        if (res.headersSent) {
          res.write(
            `data: ${JSON.stringify({ type: "error", message: "The assistant stopped unexpectedly" })}\n\n`,
          );
          res.end();
        } else {
          res.status(500).json({ error: "Failed to start the assistant" });
        }
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/proposals/{id}/apply:
   *   post:
   *     summary: Apply a pending proposal
   *     description: >
   *       Re-validates the stored payload and applies it as the approving user,
   *       through the same core APIs and plugin services a manual action uses.
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Proposal applied.
   *       400:
   *         description: The proposal could not be applied.
   *       404:
   *         description: Proposal not found.
   */
  router.post(
    "/proposals/:id/apply",
    ctx.rbac.require("apply_proposals") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid proposal id" });

      try {
        const stored = await repository.findProposal(id, userId);
        if (!stored)
          return res.status(404).json({ error: "Proposal not found" });
        if (stored.status !== "pending") {
          return res
            .status(400)
            .json({ error: `This proposal was already ${stored.status}` });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(stored.payload) as Record<string, unknown>;
        } catch {
          return res
            .status(400)
            .json({ error: "The proposal payload is invalid" });
        }

        const result = await applyProposal(stored.kind, payload, toolDeps);
        await repository.setProposalStatus(
          id,
          userId,
          "applied",
          result.summary,
        );

        await audit({
          action: "ai_proposal_applied",
          resourceType: "ai_proposal",
          resourceId: String(id),
          resourceName: stored.kind,
          success: true,
        });

        res.json({ success: result.ok, summary: result.summary });
      } catch (err) {
        const message = getErrorMessage(err, "Failed to apply the proposal");
        logError("Failed to apply AI proposal", err);

        await audit({
          action: "ai_proposal_applied",
          resourceType: "ai_proposal",
          resourceId: String(id),
          success: false,
          errorMessage: message,
        });

        res.status(400).json({ error: message });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/proposals/{id}/mark-run-in-terminal:
   *   post:
   *     summary: Record that a run_command proposal was executed in an open terminal
   *     description: >
   *       For the terminal-docked assistant only. The command is typed into the
   *       user's already-open SSH session client-side, not re-run over a pooled
   *       connection here; this just marks the proposal applied with the output
   *       the client captured, so the card and the /apply path stay in sync
   *       without running the command twice.
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hostId:
   *                 type: integer
   *               summary:
   *                 type: string
   *     responses:
   *       200:
   *         description: Proposal marked applied.
   *       400:
   *         description: The proposal is not a run_command proposal, or the hostId does not match.
   *       404:
   *         description: Proposal not found.
   */
  router.post(
    "/proposals/:id/mark-run-in-terminal",
    ctx.rbac.require("apply_proposals") as never,
    gate,
    async (req: Request, res: Response) => {
      const userId = actor(ctx);
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid proposal id" });

      const { hostId, summary } = req.body ?? {};
      const resolvedHostId = parseId(hostId);
      if (!resolvedHostId) {
        return res.status(400).json({ error: "hostId is required" });
      }

      try {
        const stored = await repository.findProposal(id, userId);
        if (!stored)
          return res.status(404).json({ error: "Proposal not found" });
        if (stored.kind !== "propose_run_command") {
          return res.status(400).json({
            error: "Only run_command proposals can be marked this way",
          });
        }
        if (stored.status !== "pending") {
          return res
            .status(400)
            .json({ error: `This proposal was already ${stored.status}` });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(stored.payload) as Record<string, unknown>;
        } catch {
          return res
            .status(400)
            .json({ error: "The proposal payload is invalid" });
        }
        if (parseId(payload.hostId) !== resolvedHostId) {
          return res
            .status(400)
            .json({ error: "This proposal is for a different host" });
        }

        const resultSummary =
          typeof summary === "string" && summary.trim()
            ? summary.trim().slice(0, 2000)
            : "Run in the open terminal session";
        await repository.setProposalStatus(
          id,
          userId,
          "applied",
          resultSummary,
        );

        await audit({
          action: "ai_proposal_applied",
          resourceType: "ai_proposal",
          resourceId: String(id),
          resourceName: stored.kind,
          success: true,
        });

        res.json({ success: true, summary: resultSummary });
      } catch (err) {
        logError("Failed to mark AI proposal applied in terminal", err);
        res.status(400).json({
          error: getErrorMessage(err, "Failed to mark the proposal applied"),
        });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/ai/proposals/{id}/reject:
   *   post:
   *     summary: Reject a pending proposal
   *     tags:
   *       - AI
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Proposal rejected.
   *       404:
   *         description: Proposal not found.
   */
  router.post(
    "/proposals/:id/reject",
    ctx.rbac.require("use") as never,
    gate,
    async (req: Request, res: Response) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid proposal id" });

      try {
        const updated = await repository.setProposalStatus(
          id,
          actor(ctx),
          "rejected",
        );
        if (!updated) {
          return res
            .status(404)
            .json({ error: "Proposal not found or already resolved" });
        }

        await audit({
          action: "ai_proposal_rejected",
          resourceType: "ai_proposal",
          resourceId: String(id),
          success: true,
        });

        res.json({ success: true });
      } catch (err) {
        logError("Failed to reject AI proposal", err);
        res.status(500).json({ error: "Failed to reject the proposal" });
      }
    },
  );
}
