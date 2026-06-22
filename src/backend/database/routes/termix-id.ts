import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/index.js";
import {
  termixIdentities,
  termixIdentityKeys,
  sshCredentials,
  termixIdentityCa,
  users,
} from "../db/schema.js";
import { and, eq, asc } from "drizzle-orm";
// ssh2 is CommonJS; Node's cjs-module-lexer does not surface its `utils` named
// export, so we use a default import (esModuleInterop) and read `.utils` off it.
import ssh2 from "ssh2";
import { authLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import { parsePublicKey, matchesAlgoFilter } from "./termix-id-keys.js";
import {
  generateCa,
  signUserCertificate,
  ed25519RawFromLine,
} from "./ssh-certificate.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Handle: github-like public namespace. lowercase, starts alphanumeric,
// 1-39 chars of [a-z0-9_-].
const HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{0,38}$/;
const RESERVED_HANDLES = new Set(["u", "me", "keys", "check", "admin", "api"]);

// Max stored length for a free-text description.
const MAX_DESCRIPTION_LENGTH = 500;

// Decrypted ssh_credentials fields this route reads. A type alias (not an
// interface) so it satisfies the generic bound on SimpleDBOps.select.
type CredentialRow = {
  name?: string | null;
  authType?: string | null;
  publicKey?: string | null;
  privateKey?: string | null;
  key?: string | null;
  keyPassword?: string | null;
};

function cleanDescription(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH) || null;
}

// True when a write failed because of a UNIQUE constraint (handle / one-per-user),
// so the handler can return a clean 409 instead of a generic 500.
function isUniqueConstraintError(err: {
  code?: string;
  message?: string;
}): boolean {
  return (
    err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    (typeof err?.message === "string" &&
      err.message.includes("UNIQUE constraint failed"))
  );
}

// A create can violate either the handle or the one-per-user (user_id) UNIQUE
// constraint in a concurrent double-submit; report the right 409 for each.
function uniqueConstraintMessage(err: { message?: string }): string {
  return typeof err?.message === "string" && err.message.includes("user_id")
    ? "You already have a Termix ID. Use update to rename it."
    : "Handle already taken";
}

/**
 * Best-effort derivation of a public key from a private key using ssh2, used
 * when importing a credential that only stored a private key.
 */
async function derivePublicFromPrivate(
  privateKey: string,
  passphrase?: string,
): Promise<string | null> {
  try {
    const parsed = ssh2.utils.parseKey(privateKey, passphrase || undefined);
    if (!parsed || parsed instanceof Error) return null;
    return `${parsed.type} ${parsed.getPublicSSH().toString("base64")}`;
  } catch {
    return null;
  }
}

async function getIdentityForUser(userId: string) {
  const rows = await db
    .select()
    .from(termixIdentities)
    .where(eq(termixIdentities.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

// Resolve the real username for audit_logs (the column expects a username, not
// the user id), matching how the credentials/snippets routes log.
async function getActorUsername(userId: string): Promise<string> {
  const rows = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.username ?? userId;
}

// ---------------------------------------------------------------------------
// Public resolver — UNAUTHENTICATED. Serves authorized_keys (text/plain) or a
// small HTML viewer for browsers, keyed by handle, with optional /<ALGO> filter.
// ---------------------------------------------------------------------------

// Never let an intermediary/CDN cache a public resolver feed (a disabled/removed
// key could keep being served after revocation), and keep it out of search
// indexes. Applied to EVERY response — including early 404s.
function setResolverHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

async function resolveHandle(req: Request, res: Response) {
  setResolverHeaders(res);
  const handle = String(req.params.handle || "").toLowerCase();
  const algoFilter = req.params.algo
    ? String(req.params.algo).toUpperCase()
    : null;

  if (!HANDLE_REGEX.test(handle)) {
    return res.status(404).type("text/plain").send("Not found\n");
  }

  try {
    const identity = await db
      .select()
      .from(termixIdentities)
      .where(eq(termixIdentities.handle, handle))
      .limit(1);

    if (identity.length === 0) {
      return res.status(404).type("text/plain").send("Not found\n");
    }

    let keys = await db
      .select()
      .from(termixIdentityKeys)
      .where(
        and(
          eq(termixIdentityKeys.identityId, identity[0].id),
          eq(termixIdentityKeys.enabled, true),
        ),
      )
      .orderBy(asc(termixIdentityKeys.id));

    if (algoFilter) {
      keys = keys.filter((k) => matchesAlgoFilter(k.algorithm, algoFilter));
    }

    const wantsHtml = (req.headers.accept || "").includes("text/html");

    if (wantsHtml) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(renderHtml(handle, keys));
    }

    const body = keys
      .map((k) => `${k.publicKey} #termix-id @${handle}`)
      .join("\n");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.send(body ? `${body}\n` : "");
  } catch (err) {
    authLogger.error("Termix ID resolve failed", err);
    return res.status(500).type("text/plain").send("Internal Server Error\n");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(
  handle: string,
  keys: Array<{ algorithm: string; comment: string | null; publicKey: string }>,
): string {
  const keyRows = keys.length
    ? keys
        .map(
          (k) =>
            `<div class="key"><span class="algo">${escapeHtml(
              k.algorithm,
            )}</span><code>${escapeHtml(k.publicKey)}</code></div>`,
        )
        .join("")
    : `<p class="empty">No public keys published yet.</p>`;

  // Standalone page (not the React app), so the Termix dark theme is inlined.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="color-scheme" content="dark" />
<title>Termix ID — @${escapeHtml(handle)}</title>
<style>
  :root {
    --bg: #0c0d0b; --panel: #141614; --panel-2: #181a17; --border: rgba(255,255,255,.12);
    --fg: #f8f8f6; --muted: #8f9189; --accent: #f59145;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); line-height: 1.5;
         font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 32px 16px 48px; }
  .card { background: var(--panel); border: 1px solid var(--border); }
  header.card { padding: 16px 18px; display: flex; align-items: center; gap: 10px; }
  h1 { font-size: 1.05rem; font-weight: 700; margin: 0; letter-spacing: .02em; color: var(--fg); }
  h1 .handle { color: var(--accent); }
  .label { font-size: 10px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase;
           color: var(--muted); margin: 22px 0 8px; }
  pre.cmd { margin: 0; background: var(--panel-2); border: 1px solid var(--border); color: var(--muted);
            padding: 12px 14px; overflow-x: auto; font-size: 12px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .keys { display: flex; flex-direction: column; gap: 8px; }
  .key { background: var(--panel); border: 1px solid var(--border); padding: 10px 12px;
         display: flex; align-items: center; gap: 10px; overflow-x: auto; }
  .algo { flex: 0 0 auto; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
          color: var(--accent); border: 1px solid rgba(245,145,69,.4); padding: 1px 5px; line-height: 1.4; }
  code { white-space: pre; word-break: break-all; font-size: 12px; color: var(--muted);
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty { color: var(--muted); font-size: 13px; }
  footer { margin-top: 28px; color: var(--muted); font-size: 11px; letter-spacing: .04em; }
</style>
</head>
<body>
  <div class="wrap">
    <header class="card">
      <h1>Termix ID <span class="handle">@${escapeHtml(handle)}</span></h1>
    </header>

    <div class="label">Provision a server</div>
    <pre class="cmd">curl -fsSL https://your-termix-host/termix-id/u/${escapeHtml(
      handle,
    )} >> ~/.ssh/authorized_keys</pre>
    <script>
      (function () {
        var el = document.querySelector("pre.cmd");
        if (el) el.textContent =
          "curl -fsSL " + location.origin + "/termix-id/u/${escapeHtml(
            handle,
          )} >> ~/.ssh/authorized_keys";
      })();
    </script>

    <div class="label">Published keys</div>
    <div class="keys">${keyRows}</div>

    <footer>Served by Termix</footer>
  </div>
</body>
</html>`;
}

// Public CA key — for `TrustedUserCAKeys` or an `@cert-authority` line. Must be
// registered before `/u/:handle/:algo` so "ca" is not treated as an algo filter.
async function caResolver(req: Request, res: Response) {
  setResolverHeaders(res);
  const handle = String(req.params.handle || "").toLowerCase();
  if (!HANDLE_REGEX.test(handle)) {
    return res.status(404).type("text/plain").send("Not found\n");
  }
  try {
    const identity = await db
      .select({ id: termixIdentities.id })
      .from(termixIdentities)
      .where(eq(termixIdentities.handle, handle))
      .limit(1);
    if (identity.length === 0) {
      return res.status(404).type("text/plain").send("Not found\n");
    }
    const ca = await db
      .select({ publicKey: termixIdentityCa.publicKey })
      .from(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identity[0].id))
      .limit(1);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (ca.length === 0) {
      return res.status(404).send("No CA configured\n");
    }
    return res.send(`${ca[0].publicKey} termix-id-ca@${handle}\n`);
  } catch (err) {
    authLogger.error("Termix ID CA resolve failed", err);
    return res.status(500).type("text/plain").send("Internal Server Error\n");
  }
}

router.get("/u/:handle/ca", caResolver);
router.get("/u/:handle", resolveHandle);
router.get("/u/:handle/:algo", resolveHandle);

// ---------------------------------------------------------------------------
// Authenticated management API.
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /termix-id/me:
 *   get:
 *     summary: Get current user's Termix ID and keys
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Identity and keys (identity may be null)
 */
router.get("/me", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const identity = await getIdentityForUser(userId);
    if (!identity) {
      return res.json({ identity: null, keys: [] });
    }
    const keys = await db
      .select()
      .from(termixIdentityKeys)
      .where(eq(termixIdentityKeys.identityId, identity.id))
      .orderBy(asc(termixIdentityKeys.id));
    res.json({
      identity: {
        ...identity,
        resolverPath: `/termix-id/u/${identity.handle}`,
      },
      keys,
    });
  } catch (err) {
    authLogger.error("Failed to fetch Termix ID", err);
    res.status(500).json({ error: "Failed to fetch Termix ID" });
  }
});

/**
 * @openapi
 * /termix-id/check/{handle}:
 *   get:
 *     summary: Check if a handle is available
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: handle
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Availability and validity status
 */
router.get(
  "/check/:handle",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const handle = String(req.params.handle || "").toLowerCase();
    if (!HANDLE_REGEX.test(handle) || RESERVED_HANDLES.has(handle)) {
      return res.json({ available: false, valid: false });
    }
    try {
      const existing = await db
        .select({ id: termixIdentities.id })
        .from(termixIdentities)
        .where(eq(termixIdentities.handle, handle))
        .limit(1);
      res.json({ available: existing.length === 0, valid: true });
    } catch (err) {
      authLogger.error("Failed to check Termix ID handle", err);
      res.status(500).json({ error: "Failed to check handle" });
    }
  },
);

/**
 * @openapi
 * /termix-id:
 *   post:
 *     summary: Create a Termix ID
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [handle]
 *             properties:
 *               handle:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Created identity
 *       409:
 *         description: Handle taken or user already has an identity
 */
router.post("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const handle = String(req.body?.handle || "").toLowerCase();
  const description = cleanDescription(req.body?.description);

  if (!HANDLE_REGEX.test(handle) || RESERVED_HANDLES.has(handle)) {
    return res.status(400).json({ error: "Invalid handle" });
  }

  try {
    const owned = await getIdentityForUser(userId);
    if (owned) {
      return res.status(409).json({
        error: "You already have a Termix ID. Use update to rename it.",
      });
    }

    const taken = await db
      .select({ id: termixIdentities.id })
      .from(termixIdentities)
      .where(eq(termixIdentities.handle, handle))
      .limit(1);
    if (taken.length > 0) {
      return res.status(409).json({ error: "Handle already taken" });
    }

    const inserted = await db
      .insert(termixIdentities)
      .values({ userId, handle, description })
      .returning();

    databaseLogger.info("Termix ID created", {
      operation: "termix_id_create",
      userId,
      handle,
    });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId,
      username: await getActorUsername(userId),
      action: "create_termix_id",
      resourceType: "termix_id",
      resourceId: String(inserted[0].id),
      resourceName: handle,
      ipAddress,
      userAgent,
      success: true,
    });

    res.status(201).json(inserted[0]);
  } catch (err) {
    // The check-then-insert above is not atomic; the UNIQUE constraints on
    // handle and user_id are the real guard, so map a violation to 409.
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: uniqueConstraintMessage(err) });
    }
    authLogger.error("Failed to create Termix ID", err);
    res.status(500).json({ error: "Failed to create Termix ID" });
  }
});

/**
 * @openapi
 * /termix-id:
 *   put:
 *     summary: Update Termix ID handle or description
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               handle:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated identity
 */
router.put("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const identity = await getIdentityForUser(userId);
    if (!identity) {
      return res.status(404).json({ error: "No Termix ID found" });
    }

    const updates: { handle?: string; description?: string | null } = {};

    if (req.body?.handle !== undefined) {
      const handle = String(req.body.handle || "").toLowerCase();
      if (!HANDLE_REGEX.test(handle) || RESERVED_HANDLES.has(handle)) {
        return res.status(400).json({ error: "Invalid handle" });
      }
      if (handle !== identity.handle) {
        const taken = await db
          .select({ id: termixIdentities.id })
          .from(termixIdentities)
          .where(eq(termixIdentities.handle, handle))
          .limit(1);
        if (taken.length > 0) {
          return res.status(409).json({ error: "Handle already taken" });
        }
      }
      updates.handle = handle;
    }

    if (req.body?.description !== undefined) {
      updates.description = cleanDescription(req.body.description);
    }

    const updated = await db
      .update(termixIdentities)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(termixIdentities.userId, userId))
      .returning();

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId,
      username: await getActorUsername(userId),
      action: "update_termix_id",
      resourceType: "termix_id",
      resourceId: String(identity.id),
      resourceName: updated[0]?.handle ?? identity.handle,
      details:
        updates.handle && updates.handle !== identity.handle
          ? `renamed ${identity.handle} -> ${updates.handle}`
          : undefined,
      ipAddress,
      userAgent,
      success: true,
    });

    res.json(updated[0]);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: "Handle already taken" });
    }
    authLogger.error("Failed to update Termix ID", err);
    res.status(500).json({ error: "Failed to update Termix ID" });
  }
});

/**
 * @openapi
 * /termix-id:
 *   delete:
 *     summary: Delete Termix ID and all associated keys
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deleted
 */
router.delete("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const identity = await getIdentityForUser(userId);
    if (!identity) {
      return res.status(404).json({ error: "No Termix ID found" });
    }
    await db
      .delete(termixIdentities)
      .where(eq(termixIdentities.userId, userId));

    databaseLogger.info("Termix ID deleted", {
      operation: "termix_id_delete",
      userId,
      handle: identity.handle,
    });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId,
      username: await getActorUsername(userId),
      action: "delete_termix_id",
      resourceType: "termix_id",
      resourceId: String(identity.id),
      resourceName: identity.handle,
      ipAddress,
      userAgent,
      success: true,
    });

    res.json({ success: true });
  } catch (err) {
    authLogger.error("Failed to delete Termix ID", err);
    res.status(500).json({ error: "Failed to delete Termix ID" });
  }
});

/**
 * @openapi
 * /termix-id/keys:
 *   post:
 *     summary: Publish a public key
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               publicKey:
 *                 type: string
 *               credentialId:
 *                 type: integer
 *               label:
 *                 type: string
 *     responses:
 *       201:
 *         description: Published key
 */
router.post(
  "/keys",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const label =
      typeof req.body?.label === "string"
        ? req.body.label.trim() || null
        : null;
    const credentialId = req.body?.credentialId
      ? parseInt(String(req.body.credentialId), 10)
      : null;

    try {
      const identity = await getIdentityForUser(userId);
      if (!identity) {
        return res
          .status(400)
          .json({ error: "Create a Termix ID handle before adding keys" });
      }

      let rawPublicKey: string | null = null;
      let source = "manual";
      let resolvedLabel = label;

      if (credentialId) {
        const credResult = await SimpleDBOps.select<CredentialRow>(
          db
            .select()
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, credentialId),
                eq(sshCredentials.userId, userId),
              ),
            ),
          "ssh_credentials",
          userId,
        );
        if (credResult.length === 0) {
          return res.status(404).json({ error: "Credential not found" });
        }
        const cred = credResult[0];
        // The UI only offers key credentials, but the UI is not authoritative —
        // reject non-key credentials server-side before treating cred.key as a
        // private key.
        if (cred.authType !== "key") {
          return res
            .status(400)
            .json({ error: "Selected credential is not an SSH key" });
        }
        source = "credential";
        resolvedLabel = resolvedLabel || cred.name || null;

        if (cred.publicKey && typeof cred.publicKey === "string") {
          rawPublicKey = cred.publicKey;
        } else {
          const priv = cred.privateKey || cred.key || undefined;
          if (priv) {
            rawPublicKey = await derivePublicFromPrivate(
              priv,
              cred.keyPassword || undefined,
            );
          }
          if (!rawPublicKey) {
            return res.status(400).json({
              error:
                "This credential has no public key and one could not be derived. Paste the public key manually.",
            });
          }
        }
      } else {
        rawPublicKey =
          typeof req.body?.publicKey === "string" ? req.body.publicKey : null;
      }

      const parsed = parsePublicKey(rawPublicKey);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid SSH public key" });
      }

      // Dedupe within this identity by normalized "<type> <blob>".
      const existing = await db
        .select({
          id: termixIdentityKeys.id,
          publicKey: termixIdentityKeys.publicKey,
        })
        .from(termixIdentityKeys)
        .where(eq(termixIdentityKeys.identityId, identity.id));
      if (existing.some((k) => k.publicKey === parsed.normalized)) {
        return res.status(409).json({ error: "This key is already published" });
      }

      const inserted = await db
        .insert(termixIdentityKeys)
        .values({
          identityId: identity.id,
          userId,
          publicKey: parsed.normalized,
          keyType: parsed.type,
          algorithm: parsed.algorithm,
          label: resolvedLabel,
          comment: parsed.comment || null,
          source,
          credentialId: credentialId || null,
        })
        .returning();

      databaseLogger.info("Termix ID key added", {
        operation: "termix_id_key_add",
        userId,
        algorithm: parsed.algorithm,
        source,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "add_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(inserted[0].id),
        resourceName: identity.handle,
        details: `${parsed.algorithm} (${source})`,
        ipAddress,
        userAgent,
        success: true,
      });

      res.status(201).json(inserted[0]);
    } catch (err) {
      authLogger.error("Failed to add Termix ID key", err);
      res.status(500).json({ error: "Failed to add key" });
    }
  },
);

/**
 * @openapi
 * /termix-id/keys/generate:
 *   post:
 *     summary: Generate a new key pair and publish the public key
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [ed25519, rsa]
 *               label:
 *                 type: string
 *               saveCredential:
 *                 type: boolean
 *               username:
 *                 type: string
 *     responses:
 *       201:
 *         description: Generated key info with private key (shown once)
 */
router.post(
  "/keys/generate",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const keyType = req.body?.type === "rsa" ? "rsa" : "ed25519";
    const label =
      typeof req.body?.label === "string"
        ? req.body.label.trim() || null
        : null;
    // Default to saving the generated key pair into the encrypted credential
    // vault so it can be used to connect from Termix (opt out with false).
    const saveCredential = req.body?.saveCredential !== false;
    const credentialUsername =
      typeof req.body?.username === "string" ? req.body.username.trim() : null;

    try {
      const identity = await getIdentityForUser(userId);
      if (!identity) {
        return res
          .status(400)
          .json({ error: "Create a Termix ID handle before adding keys" });
      }

      const comment = `termix-${identity.handle}`;
      const pair =
        keyType === "rsa"
          ? ssh2.utils.generateKeyPairSync("rsa", { bits: 4096, comment })
          : ssh2.utils.generateKeyPairSync("ed25519", { comment });

      const parsed = parsePublicKey(pair.public);
      if (!parsed) {
        return res.status(500).json({ error: "Key generation failed" });
      }

      // Optionally persist the FULL key pair (incl. private key) into the
      // encrypted ssh_credentials vault — the same secure, per-user-encrypted
      // store used for host credentials. The Termix ID tables themselves only ever
      // hold the public key, because the resolver endpoint is unauthenticated.
      let credentialId: number | null = null;
      if (saveCredential) {
        const credData = {
          userId,
          name: `Termix ID @${identity.handle} (${parsed.algorithm})`,
          description: "Auto-generated by Termix ID",
          folder: null,
          tags: "",
          authType: "key",
          username: credentialUsername || null,
          password: null,
          key: pair.private,
          privateKey: pair.private,
          publicKey: parsed.normalized,
          keyPassword: null,
          keyType: null,
          detectedKeyType: parsed.type,
          usageCount: 0,
          lastUsed: null,
        };
        const created = (await SimpleDBOps.insert(
          sshCredentials,
          "ssh_credentials",
          credData,
          userId,
        )) as typeof credData & { id: number };
        credentialId = created.id;
      }

      // There is no single transaction here (SimpleDBOps.insert is async and
      // better-sqlite3 transactions are sync), so if publishing the key fails
      // after the vault credential was created, compensate by deleting it to
      // avoid leaving an orphaned credential behind.
      const runInsert = () =>
        db
          .insert(termixIdentityKeys)
          .values({
            identityId: identity.id,
            userId,
            publicKey: parsed.normalized,
            keyType: parsed.type,
            algorithm: parsed.algorithm,
            label: label || `Generated ${parsed.algorithm}`,
            comment: parsed.comment || null,
            source: "generated",
            credentialId,
          })
          .returning();

      let inserted: Awaited<ReturnType<typeof runInsert>>;
      try {
        inserted = await runInsert();
      } catch (insertErr) {
        if (credentialId !== null) {
          try {
            await db
              .delete(sshCredentials)
              .where(
                and(
                  eq(sshCredentials.id, credentialId),
                  eq(sshCredentials.userId, userId),
                ),
              );
          } catch {
            // best-effort cleanup
          }
        }
        throw insertErr;
      }

      databaseLogger.info("Termix ID key generated", {
        operation: "termix_id_key_generate",
        userId,
        algorithm: parsed.algorithm,
        savedCredential: credentialId !== null,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "generate_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(inserted[0].id),
        resourceName: identity.handle,
        details: `${parsed.algorithm}${credentialId !== null ? " (saved to credentials)" : ""}`,
        ipAddress,
        userAgent,
        success: true,
      });

      // The private key is also returned once so the user can download it; when
      // saveCredential is true it additionally lives (encrypted) in the vault.
      res.status(201).json({
        key: inserted[0],
        privateKey: pair.private,
        publicKey: parsed.normalized,
        credentialId,
      });
    } catch (err) {
      authLogger.error("Failed to generate Termix ID key", err);
      res.status(500).json({ error: "Failed to generate key" });
    }
  },
);

/**
 * @openapi
 * /termix-id/keys/{id}:
 *   patch:
 *     summary: Update key metadata (enabled state or label)
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *               label:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated key
 */
router.patch(
  "/keys/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid key id" });
    }
    try {
      const updates: { enabled?: boolean; label?: string | null } = {};
      if (req.body?.enabled !== undefined) {
        updates.enabled = !!req.body.enabled;
      }
      if (req.body?.label !== undefined) {
        updates.label =
          typeof req.body.label === "string"
            ? req.body.label.trim() || null
            : null;
      }
      const updated = await db
        .update(termixIdentityKeys)
        .set(updates)
        .where(
          and(
            eq(termixIdentityKeys.id, id),
            eq(termixIdentityKeys.userId, userId),
          ),
        )
        .returning();
      if (updated.length === 0) {
        return res.status(404).json({ error: "Key not found" });
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "update_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(id),
        resourceName: String(updated[0].label ?? updated[0].algorithm),
        details:
          updates.enabled !== undefined
            ? `enabled: ${updates.enabled}`
            : "label updated",
        ipAddress,
        userAgent,
        success: true,
      });

      res.json(updated[0]);
    } catch (err) {
      authLogger.error("Failed to update Termix ID key", err);
      res.status(500).json({ error: "Failed to update key" });
    }
  },
);

/**
 * @openapi
 * /termix-id/keys/{id}:
 *   delete:
 *     summary: Revoke and delete a published key
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Deleted
 */
router.delete(
  "/keys/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid key id" });
    }
    try {
      const deleted = await db
        .delete(termixIdentityKeys)
        .where(
          and(
            eq(termixIdentityKeys.id, id),
            eq(termixIdentityKeys.userId, userId),
          ),
        )
        .returning();
      if (deleted.length === 0) {
        return res.status(404).json({ error: "Key not found" });
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "delete_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(id),
        resourceName: deleted[0].algorithm,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete Termix ID key", err);
      res.status(500).json({ error: "Failed to delete key" });
    }
  },
);

// ---------------------------------------------------------------------------
// Certificate authority — central revocation (rotate) + expiry (validity).
// ---------------------------------------------------------------------------

type CaRow = {
  id: number;
  publicKey: string;
  privateKey: string;
  validityDays: number;
};

function clampValidityDays(
  value: number | string | null | undefined,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 3650);
}

async function getCaForUser(
  userId: string,
  identityId: number,
): Promise<CaRow | undefined> {
  const rows = await SimpleDBOps.select<CaRow>(
    db
      .select()
      .from(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identityId)),
    "termix_identity_ca",
    userId,
  );
  return rows[0];
}

/**
 * @openapi
 * /termix-id/ca:
 *   get:
 *     summary: Get current user's certificate authority
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: CA info or null
 */
router.get("/ca", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const identity = await getIdentityForUser(userId);
    if (!identity) return res.json({ ca: null });
    const ca = await db
      .select({
        publicKey: termixIdentityCa.publicKey,
        validityDays: termixIdentityCa.validityDays,
      })
      .from(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identity.id))
      .limit(1);
    if (ca.length === 0) return res.json({ ca: null });
    res.json({
      ca: {
        publicKey: ca[0].publicKey,
        validityDays: ca[0].validityDays,
        resolverPath: `/termix-id/u/${identity.handle}/ca`,
      },
    });
  } catch (err) {
    authLogger.error("Failed to fetch Termix ID CA", err);
    res.status(500).json({ error: "Failed to fetch CA" });
  }
});

/**
 * @openapi
 * /termix-id/ca:
 *   post:
 *     summary: Create a certificate authority
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               validityDays:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Created CA
 */
router.post(
  "/ca",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const identity = await getIdentityForUser(userId);
      if (!identity) {
        return res
          .status(400)
          .json({ error: "Create a Termix ID handle first" });
      }
      const existing = await db
        .select({ id: termixIdentityCa.id })
        .from(termixIdentityCa)
        .where(eq(termixIdentityCa.identityId, identity.id))
        .limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "CA already exists" });
      }

      const validityDays = clampValidityDays(req.body?.validityDays, 90);
      const generated = generateCa();
      await SimpleDBOps.insert(
        termixIdentityCa,
        "termix_identity_ca",
        {
          identityId: identity.id,
          userId,
          publicKey: generated.publicKeyLine,
          privateKey: generated.privateKeyPem,
          validityDays,
        },
        userId,
      );

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "create_termix_id_ca",
        resourceType: "termix_id_ca",
        resourceName: identity.handle,
        ipAddress,
        userAgent,
        success: true,
      });

      res.status(201).json({
        publicKey: generated.publicKeyLine,
        validityDays,
        resolverPath: `/termix-id/u/${identity.handle}/ca`,
      });
    } catch (err) {
      authLogger.error("Failed to create Termix ID CA", err);
      res.status(500).json({ error: "Failed to create CA" });
    }
  },
);

/**
 * @openapi
 * /termix-id/ca/rotate:
 *   post:
 *     summary: Rotate the certificate authority (revokes all issued certificates)
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               validityDays:
 *                 type: integer
 *     responses:
 *       200:
 *         description: New CA public key
 */
router.post(
  "/ca/rotate",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const identity = await getIdentityForUser(userId);
      if (!identity)
        return res.status(404).json({ error: "No Termix ID found" });
      const existing = await db
        .select({
          id: termixIdentityCa.id,
          validityDays: termixIdentityCa.validityDays,
        })
        .from(termixIdentityCa)
        .where(eq(termixIdentityCa.identityId, identity.id))
        .limit(1);
      if (existing.length === 0) {
        return res.status(404).json({ error: "No CA to rotate" });
      }

      const validityDays = clampValidityDays(
        req.body?.validityDays,
        existing[0].validityDays,
      );
      const generated = generateCa();
      // Rotating invalidates every previously issued certificate — this IS the
      // central revocation mechanism.
      await SimpleDBOps.update(
        termixIdentityCa,
        "termix_identity_ca",
        eq(termixIdentityCa.identityId, identity.id),
        {
          publicKey: generated.publicKeyLine,
          privateKey: generated.privateKeyPem,
          validityDays,
          updatedAt: new Date().toISOString(),
        },
        userId,
      );

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "rotate_termix_id_ca",
        resourceType: "termix_id_ca",
        resourceName: identity.handle,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({
        publicKey: generated.publicKeyLine,
        validityDays,
        resolverPath: `/termix-id/u/${identity.handle}/ca`,
      });
    } catch (err) {
      authLogger.error("Failed to rotate Termix ID CA", err);
      res.status(500).json({ error: "Failed to rotate CA" });
    }
  },
);

/**
 * @openapi
 * /termix-id/ca:
 *   delete:
 *     summary: Delete the certificate authority
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Deleted
 */
router.delete("/ca", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const identity = await getIdentityForUser(userId);
    if (!identity) return res.status(404).json({ error: "No Termix ID found" });
    const deleted = await db
      .delete(termixIdentityCa)
      .where(eq(termixIdentityCa.identityId, identity.id))
      .returning();
    if (deleted.length === 0) {
      return res.status(404).json({ error: "No CA to delete" });
    }

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId,
      username: await getActorUsername(userId),
      action: "delete_termix_id_ca",
      resourceType: "termix_id_ca",
      resourceName: identity.handle,
      ipAddress,
      userAgent,
      success: true,
    });

    res.json({ success: true });
  } catch (err) {
    authLogger.error("Failed to delete Termix ID CA", err);
    res.status(500).json({ error: "Failed to delete CA" });
  }
});

/**
 * @openapi
 * /termix-id/keys/{id}/certificate:
 *   post:
 *     summary: Issue an SSH certificate for a key (ed25519 only)
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               validityDays:
 *                 type: integer
 *               principals:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Issued certificate
 */
router.post(
  "/keys/:id/certificate",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = parseInt(String(req.params.id), 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid key id" });
    }
    try {
      const keyRows = await db
        .select()
        .from(termixIdentityKeys)
        .where(
          and(
            eq(termixIdentityKeys.id, id),
            eq(termixIdentityKeys.userId, userId),
          ),
        )
        .limit(1);
      if (keyRows.length === 0) {
        return res.status(404).json({ error: "Key not found" });
      }
      const key = keyRows[0];
      if (!ed25519RawFromLine(key.publicKey)) {
        return res.status(400).json({
          error: "Certificates are only supported for Ed25519 keys",
        });
      }

      const identity = await getIdentityForUser(userId);
      if (!identity)
        return res.status(404).json({ error: "No Termix ID found" });
      const ca = await getCaForUser(userId, identity.id);
      if (!ca) {
        return res
          .status(400)
          .json({ error: "Enable a certificate authority first" });
      }

      const validityDays = clampValidityDays(
        req.body?.validityDays,
        ca.validityDays,
      );
      const principals = Array.isArray(req.body?.principals)
        ? req.body.principals
            .filter((p: string) => typeof p === "string" && p.trim())
            .map((p: string) => p.trim())
            .slice(0, 32)
        : [];

      const now = Math.floor(Date.now() / 1000);
      const validBefore = now + validityDays * 86400;
      const keyId = `termix:@${identity.handle}:${id}`;
      const certificate = signUserCertificate({
        userPublicKeyLine: key.publicKey,
        caPrivateKeyPem: ca.privateKey,
        caPublicKeyLine: ca.publicKey,
        keyId,
        principals,
        validAfter: now - 60,
        validBefore,
      });
      if (!certificate) {
        return res.status(500).json({ error: "Failed to sign certificate" });
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getActorUsername(userId),
        action: "issue_termix_id_certificate",
        resourceType: "termix_id_key",
        resourceId: String(id),
        resourceName: identity.handle,
        details: `validity ${validityDays}d${principals.length ? `, principals: ${principals.join(",")}` : ""}`,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ certificate, keyId, validBefore, principals, validityDays });
    } catch (err) {
      authLogger.error("Failed to issue Termix ID certificate", err);
      res.status(500).json({ error: "Failed to issue certificate" });
    }
  },
);

/**
 * @openapi
 * /termix-id/linked-credentials:
 *   get:
 *     summary: Get credential IDs that have at least one enabled published Termix ID key
 *     tags: [Termix ID]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of credential IDs
 */
router.get(
  "/linked-credentials",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const identity = await getIdentityForUser(userId);
      if (!identity) return res.json({ credentialIds: [] });
      const keys = await db
        .select({ credentialId: termixIdentityKeys.credentialId })
        .from(termixIdentityKeys)
        .where(
          and(
            eq(termixIdentityKeys.identityId, identity.id),
            eq(termixIdentityKeys.enabled, true),
          ),
        );
      const credentialIds = [
        ...new Set(
          keys
            .map((k) => k.credentialId)
            .filter((cid): cid is number => cid !== null),
        ),
      ];
      res.json({ credentialIds });
    } catch (err) {
      authLogger.error("Failed to fetch linked credential IDs", err);
      res.status(500).json({ error: "Failed to fetch linked credentials" });
    }
  },
);

export default router;
