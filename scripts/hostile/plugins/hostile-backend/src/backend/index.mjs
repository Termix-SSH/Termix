// Every route under /attack/:id tries one thing a plugin must never manage.
// It answers { worked, detail }: worked is true when the thing went through.
// The runner holds the expected answer for each id.
import path from "node:path";
import { sql } from "drizzle-orm";
import { defineTable, id, text } from "@termix-ssh/plugin-sdk/db";
import { attempt, processAttacks, short } from "./process-attacks.mjs";

const items = defineTable("items", {
  id: id(),
  value: text().notNull(),
});

function sqlAttack(ctx, statement) {
  return attempt(async () => {
    const db = await ctx.db.client();
    if (ctx.db.dialect === "sqlite") return db.all(sql.raw(statement));
    return db.execute(sql.raw(statement));
  });
}

function batchAttack(ctx, statement) {
  return attempt(async () => {
    await ctx.db.batch([{ toSQL: () => ({ sql: statement, params: [] }) }]);
    return "batch ran";
  });
}

/** What a ctx.fetch did: a reply of any kind means it reached the target. */
function fetchAttack(ctx, url, init = {}) {
  return attempt(async () => {
    const response = await ctx.fetch(url, { timeoutMs: 4000, ...init });
    return `status ${response.status}`;
  });
}

export async function activate(ctx) {
  const table = await ctx.db.define(items);
  const db = await ctx.db.client();
  const own = await ctx.files.dataDir();
  if (ctx.db.dialect === "sqlite") {
    await db.insert(table).values({ value: "own row" });
  }

  // Locks are what the runner tells it to report.
  let lockIds = [];
  ctx.hosts.locks.provide({
    lockedHosts: () => lockIds.map((hostId) => [hostId, "hostile"]),
    isLocked: (hostId) => lockIds.includes(hostId),
    allowManualCreate: () => true,
  });

  // Tokens of /touch requests, kept for the replay attack (fork channel only).
  const seenTokens = [];
  let capturing = false;
  if (typeof process.send === "function") {
    const send = process.send.bind(process);
    process.send = (message, ...rest) => {
      const token = message?.k;
      if (
        capturing &&
        typeof token === "string" &&
        !seenTokens.includes(token)
      ) {
        seenTokens.push(token);
      }
      return send(message, ...rest);
    };
  }

  const attacks = {
    ...processAttacks(own),

    // ---- ctx.fetch to private places without allowPrivateHosts ----
    "fetch.metadata": () =>
      fetchAttack(ctx, "http://169.254.169.254/latest/meta-data/"),
    "fetch.metadata-v6": () => fetchAttack(ctx, "http://[fd00:ec2::254]/"),
    "fetch.loopback": (input) =>
      fetchAttack(ctx, `http://127.0.0.1:${input.listenPort}/`),
    "fetch.localhost": (input) =>
      fetchAttack(ctx, `http://localhost:${input.listenPort}/`),
    "fetch.loopback-v6": (input) =>
      fetchAttack(ctx, `http://[::1]:${input.listenPort}/`),
    "fetch.mapped-v6": (input) =>
      fetchAttack(ctx, `http://[::ffff:127.0.0.1]:${input.listenPort}/`),
    "fetch.decimal": (input) =>
      fetchAttack(ctx, `http://2130706433:${input.listenPort}/`),
    "fetch.hex": (input) =>
      fetchAttack(ctx, `http://0x7f000001:${input.listenPort}/`),
    "fetch.octal": (input) =>
      fetchAttack(ctx, `http://0177.0.0.1:${input.listenPort}/`),
    "fetch.short": (input) =>
      fetchAttack(ctx, `http://127.1:${input.listenPort}/`),
    "fetch.zero": (input) =>
      fetchAttack(ctx, `http://0.0.0.0:${input.listenPort}/`),
    "fetch.private-10": () => fetchAttack(ctx, "http://10.0.0.1/"),
    "fetch.private-192": () => fetchAttack(ctx, "http://192.168.0.1/"),
    "fetch.core": (input) => fetchAttack(ctx, `${input.coreUrl}/health`),
    // Allowed once by the admin setting, so this one must work.
    "fetch.allowed-control": async (input) => {
      const host = (await ctx.settings.get("allowedHost")) || "";
      return fetchAttack(ctx, `http://127.0.0.1:${input.listenPort}/`, {
        allowPrivateHosts: host ? [host] : [],
      });
    },
    // The allowed host answers with a redirect to somewhere private.
    "fetch.redirect-private": async (input) => {
      const host = (await ctx.settings.get("allowedHost")) || "";
      return fetchAttack(
        ctx,
        `http://127.0.0.1:${input.listenPort}/redirect?to=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`,
        { allowPrivateHosts: host ? [host] : [] },
      );
    },
    // The plugin names the metadata address itself.
    "fetch.self-allowed-metadata": () =>
      fetchAttack(ctx, "http://169.254.169.254/latest/meta-data/", {
        allowPrivateHosts: ["169.254.169.254"],
      }),

    // ---- database ----
    "db.own-control": () =>
      sqlAttack(ctx, 'SELECT * FROM "p_hostile_backend_items"'),
    "db.core-users": () => sqlAttack(ctx, "SELECT * FROM users"),
    "db.core-sessions": () => sqlAttack(ctx, "SELECT * FROM sessions"),
    "db.core-settings": () => sqlAttack(ctx, "SELECT * FROM settings"),
    "db.victim": () => sqlAttack(ctx, "SELECT * FROM p_hostile_victim_secrets"),
    "db.quoted": () => sqlAttack(ctx, 'SELECT * FROM "users"'),
    "db.backtick": () => sqlAttack(ctx, "SELECT * FROM `users`"),
    "db.bracket": () => sqlAttack(ctx, "SELECT * FROM [users]"),
    "db.schema": () => sqlAttack(ctx, "SELECT * FROM main.users"),
    "db.union": () =>
      sqlAttack(
        ctx,
        "SELECT value FROM p_hostile_backend_items UNION SELECT username FROM users",
      ),
    "db.comment": () =>
      sqlAttack(
        ctx,
        "SELECT value FROM p_hostile_backend_items /* users */ UNION SELECT username FROM/**/users",
      ),
    "db.line-comment": () =>
      sqlAttack(
        ctx,
        "SELECT value FROM p_hostile_backend_items -- x\n UNION SELECT username FROM users",
      ),
    "db.subquery": () =>
      sqlAttack(
        ctx,
        "SELECT (SELECT username FROM users LIMIT 1) FROM p_hostile_backend_items",
      ),
    "db.cte": () =>
      sqlAttack(ctx, "WITH u AS (SELECT * FROM users) SELECT * FROM u"),
    "db.cte-shadow": () =>
      sqlAttack(
        ctx,
        "WITH p_hostile_backend_items AS (SELECT * FROM users) SELECT * FROM p_hostile_backend_items",
      ),
    "db.pragma": () => sqlAttack(ctx, "PRAGMA table_info(users)"),
    "db.pragma-list": () => sqlAttack(ctx, "PRAGMA database_list"),
    "db.attach": (input) =>
      sqlAttack(
        ctx,
        `ATTACH DATABASE '${path.join(input.dataDir, "hostile.db")}' AS hostile`,
      ),
    "db.master": () => sqlAttack(ctx, "SELECT * FROM sqlite_master"),
    "db.schema-table": () => sqlAttack(ctx, "SELECT * FROM sqlite_schema"),
    "db.load-extension": () => sqlAttack(ctx, "SELECT load_extension('x')"),
    "db.vacuum-into": (input) =>
      sqlAttack(ctx, `VACUUM INTO '${path.join(input.dataDir, "copy.db")}'`),
    "db.ddl": () =>
      sqlAttack(ctx, "CREATE TABLE p_hostile_backend_extra (id integer)"),
    "db.multi": () =>
      sqlAttack(
        ctx,
        "SELECT 1 FROM p_hostile_backend_items; DELETE FROM sessions",
      ),
    "db.batch-sessions": () => batchAttack(ctx, "DELETE FROM sessions"),
    "db.batch-victim": () =>
      batchAttack(ctx, "UPDATE p_hostile_victim_secrets SET value = 'gone'"),
    "db.batch-pragma": () => batchAttack(ctx, "PRAGMA writable_schema = 1"),

    // ---- acting as someone else ----
    "user.as-user": (input) =>
      attempt(() => ctx.asUser(input.otherUserId, () => ctx.currentActor())),
    "user.issue-token": (input) =>
      attempt(() => ctx.auth.issueUserToken(input.otherUserId)),
    "user.replay-token": async () => {
      if (typeof process.send !== "function") {
        return { worked: false, detail: "n/a: no fork channel" };
      }
      // An earlier request's token, used after that request ended.
      const token = seenTokens[0];
      if (!token) return { worked: false, detail: "n/a: no token seen yet" };
      return attempt(() =>
        new Promise((resolve, reject) => {
          const callId = 2_000_000_000 + Math.floor(Math.random() * 1e6);
          const onMessage = (raw) => {
            const message = raw;
            if (message?.id !== callId) return;
            process.off("message", onMessage);
            if (message.t === "ok") resolve(short(message.v));
            else reject(new Error(message.e?.message ?? "refused"));
          };
          process.on("message", onMessage);
          process.send({
            t: "call",
            id: callId,
            m: "rbac.check",
            a: ["probe"],
            k: token,
          });
          setTimeout(() => reject(new Error("no answer")), 4000);
        }).then((answer) => {
          // Only an admin passes the probe permission.
          if (!String(answer).includes('"next":true')) {
            throw new Error(`no admin behind it: ${answer}`);
          }
          return answer;
        }),
      );
    },

    // ---- secrets ----
    "secret.unseal-victim": (input) =>
      attempt(async () => {
        const value = await ctx.secrets.unseal(input.victimSealed);
        if (value == null) throw new Error("unseal gave nothing");
        return value;
      }),
    "secret.shared-victim": () =>
      attempt(async () => {
        const value = await ctx.secrets.getShared("hostile-victim", "marker");
        if (value == null) throw new Error("nothing shared");
        return value;
      }),

    // ---- host locks ----
    "lock.set": (input) =>
      attempt(() => {
        lockIds = (input.lockIds ?? []).map(Number);
        return lockIds;
      }),

    // ---- the bridge ----
    "flood.calls": (input) =>
      attempt(async () => {
        const count = input.count ?? 50_000;
        const results = await Promise.allSettled(
          Array.from({ length: count }, (_, index) =>
            ctx.kv.get(`flood-${index % 10}`),
          ),
        );
        const refused = results.filter((r) => r.status === "rejected").length;
        return { count, refused };
      }),
    "flood.big": (input) =>
      attempt(async () => {
        const size = (input.mb ?? 200) * 1024 * 1024;
        await ctx.kv.set("big", "x".repeat(size));
        return "stored";
      }),
    "flood.big-raw": (input) => {
      if (typeof process.send !== "function") {
        return { worked: false, detail: "n/a: no fork channel" };
      }
      return attempt(() => {
        const size = (input.mb ?? 200) * 1024 * 1024;
        process.send({
          t: "call",
          id: 2_100_000_000,
          m: "kv.get",
          a: ["x".repeat(size)],
        });
        return "sent";
      });
    },
    "flood.unknown-raw": () => {
      if (typeof process.send !== "function") {
        return { worked: false, detail: "n/a: no fork channel" };
      }
      return attempt(
        () =>
          new Promise((resolve, reject) => {
            const callId = 2_200_000_000;
            const onMessage = (raw) => {
              const message = raw;
              if (message?.id !== callId) return;
              process.off("message", onMessage);
              if (message.t === "ok") resolve(short(message.v));
              else reject(new Error(message.e?.message ?? "refused"));
            };
            process.on("message", onMessage);
            // A capability this plugin was never given, called by name.
            process.send({
              t: "call",
              id: callId,
              m: "ssh.connect",
              a: [1],
            });
            setTimeout(() => reject(new Error("no answer")), 4000);
          }),
      );
    },
  };

  const router = ctx.http.router();
  router.get("/info", async (_req, res) => {
    res.json({
      dataDir: own,
      pid: process.pid,
      ppid: process.ppid,
      channel: typeof process.send === "function" ? "fork" : "stdio",
      attacks: Object.keys(attacks),
    });
  });
  // Any route call records a token for the replay attack.
  router.get("/touch", async (_req, res) => {
    capturing = true;
    try {
      await ctx.kv.get("touch");
    } finally {
      capturing = false;
    }
    res.json({ actor: ctx.currentActor() ?? null, seen: seenTokens.length });
  });
  // The control for the replay: the same probe inside a live request.
  router.get("/probe", ctx.rbac.require("probe"), (_req, res) => {
    res.json({ ok: true });
  });
  router.post("/attack/:id", async (req, res) => {
    const attack = attacks[req.params.id];
    if (!attack) {
      res.status(404).json({ error: "no such attack" });
      return;
    }
    const result = await attack(req.body ?? {});
    res.json(result);
  });
}
