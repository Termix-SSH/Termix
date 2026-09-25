import type { Request, Response, Router } from "express";
// ssh2 is CommonJS and its `utils` named export is not visible to ESM, so it
// is read off the default import.
import ssh2 from "ssh2";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { parsePublicKey } from "./keys.js";
import {
  ed25519RawFromLine,
  generateCa,
  signUserCertificate,
} from "./certificate.js";
import {
  asError,
  clampValidityDays,
  cleanDescription,
  cleanLabel,
  isUniqueViolation,
  isUserIdViolation,
  isValidHandle,
} from "./handles.js";
import { createResolver, resolverPath } from "./resolver.js";
import type { IdentityRow, Store } from "./store.js";

const ALREADY_HAVE_ONE =
  "You already have a Termix ID. Use update to rename it.";

function parseId(value: unknown): number | null {
  const id = Number.parseInt(String(value), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerRoutes(
  ctx: PluginContext,
  router: Router,
  store: Store,
): void {
  const resolver = createResolver(ctx, store);

  const userId = () => {
    const actor = ctx.currentActor();
    if (!actor) throw new Error("No acting user");
    return actor;
  };

  const withUrls = (req: Request, handle: string, suffix = "") => {
    const path = `${resolverPath(handle)}${suffix}`;
    return {
      resolverPath: path,
      resolverUrl: `${ctx.http.baseUrl(req)}${path}`,
    };
  };

  const fail = (res: Response, message: string, error: unknown) => {
    ctx.log.error(message, asError(error));
    res.status(500).json({ error: message });
  };

  /**
   * @openapi
   * /plugin-api/termix-identity/u/{handle}/ca:
   *   get:
   *     summary: Public CA key for a handle
   *     description: Public. The certificate authority's public key, for TrustedUserCAKeys or an @cert-authority line. The 2.8 URL /termix-id/u/{handle}/ca redirects here.
   *     tags: [Termix ID]
   *     parameters:
   *       - in: path
   *         name: handle
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The CA public key as text.
   *       404:
   *         description: No such handle, or it has no CA.
   */
  router.get("/u/:handle/ca", resolver.caKey);

  /**
   * @openapi
   * /plugin-api/termix-identity/u/{handle}:
   *   get:
   *     summary: Published keys for a handle
   *     description: Public. authorized_keys lines for every enabled key, or an HTML viewer when the client accepts text/html. Never cached. The 2.8 URL /termix-id/u/{handle} redirects here.
   *     tags: [Termix ID]
   *     parameters:
   *       - in: path
   *         name: handle
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The keys as text or HTML.
   *       404:
   *         description: No such handle.
   */
  router.get("/u/:handle", resolver.keys);

  /**
   * @openapi
   * /plugin-api/termix-identity/u/{handle}/{algo}:
   *   get:
   *     summary: Published keys of one algorithm for a handle
   *     description: Public. Like /u/{handle}, keeping only keys whose algorithm group matches (RSA, ED25519, ECDSA and so on). The 2.8 URL /termix-id/u/{handle}/{algo} redirects here.
   *     tags: [Termix ID]
   *     parameters:
   *       - in: path
   *         name: handle
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: algo
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The matching keys as text or HTML.
   *       404:
   *         description: No such handle.
   */
  router.get("/u/:handle/:algo", resolver.keys);

  // Everything below needs a signed-in user holding termix-identity.use.
  router.use(ctx.rbac.require("use") as never);

  /**
   * @openapi
   * /plugin-api/termix-identity/me:
   *   get:
   *     summary: Get the current user's Termix ID and keys
   *     tags: [Termix ID]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Identity and keys (identity may be null)
   */
  router.get("/me", async (req, res) => {
    try {
      const identity = await store.identityForUser(userId());
      if (!identity) return res.json({ identity: null, keys: [] });
      res.json({
        identity: { ...identity, ...withUrls(req, identity.handle) },
        keys: await store.keysForIdentity(identity.id),
      });
    } catch (error) {
      fail(res, "Failed to fetch Termix ID", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/check/{handle}:
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
  router.get("/check/:handle", async (req, res) => {
    const handle = String(req.params.handle || "").toLowerCase();
    if (!isValidHandle(handle)) {
      return res.json({ available: false, valid: false });
    }
    try {
      res.json({
        available: !(await store.isHandleTaken(handle)),
        valid: true,
      });
    } catch (error) {
      fail(res, "Failed to check handle", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity:
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
   *       400:
   *         description: Invalid handle
   *       409:
   *         description: Handle taken or user already has an identity
   */
  router.post("/", async (req, res) => {
    const handle = String(req.body?.handle || "").toLowerCase();
    if (!isValidHandle(handle)) {
      return res.status(400).json({ error: "Invalid handle" });
    }
    try {
      const owner = userId();
      if (await store.identityForUser(owner)) {
        return res.status(409).json({ error: ALREADY_HAVE_ONE });
      }
      if (await store.isHandleTaken(handle)) {
        return res.status(409).json({ error: "Handle already taken" });
      }
      const identity = await store.createIdentity({
        userId: owner,
        handle,
        description: cleanDescription(req.body?.description),
      });
      await ctx.audit.record({
        action: "create_termix_id",
        resourceType: "termix_id",
        resourceId: String(identity.id),
        resourceName: handle,
        success: true,
      });
      res.status(201).json(identity);
    } catch (error) {
      // The checks above race a double submit; the UNIQUE constraints on
      // handle and user_id are the real guard.
      if (isUniqueViolation(error)) {
        return res.status(409).json({
          error: isUserIdViolation(error)
            ? ALREADY_HAVE_ONE
            : "Handle already taken",
        });
      }
      fail(res, "Failed to create Termix ID", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity:
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
   *       404:
   *         description: No Termix ID
   *       409:
   *         description: Handle taken
   */
  router.put("/", async (req, res) => {
    try {
      const owner = userId();
      const identity = await store.identityForUser(owner);
      if (!identity)
        return res.status(404).json({ error: "No Termix ID found" });

      const update: { handle?: string; description?: string | null } = {};
      if (req.body?.handle !== undefined) {
        const handle = String(req.body.handle || "").toLowerCase();
        if (!isValidHandle(handle)) {
          return res.status(400).json({ error: "Invalid handle" });
        }
        if (handle !== identity.handle && (await store.isHandleTaken(handle))) {
          return res.status(409).json({ error: "Handle already taken" });
        }
        update.handle = handle;
      }
      if (req.body?.description !== undefined) {
        update.description = cleanDescription(req.body.description);
      }

      const updated = await store.updateIdentity(owner, update);
      await ctx.audit.record({
        action: "update_termix_id",
        resourceType: "termix_id",
        resourceId: String(identity.id),
        resourceName: updated?.handle ?? identity.handle,
        details:
          update.handle && update.handle !== identity.handle
            ? `renamed ${identity.handle} -> ${update.handle}`
            : undefined,
        success: true,
      });
      res.json(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: "Handle already taken" });
      }
      fail(res, "Failed to update Termix ID", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity:
   *   delete:
   *     summary: Delete Termix ID with its keys and CA
   *     tags: [Termix ID]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Deleted
   *       404:
   *         description: No Termix ID
   */
  router.delete("/", async (_req, res) => {
    try {
      const identity = await store.identityForUser(userId());
      if (!identity)
        return res.status(404).json({ error: "No Termix ID found" });
      await store.deleteIdentity(identity);
      await ctx.audit.record({
        action: "delete_termix_id",
        resourceType: "termix_id",
        resourceId: String(identity.id),
        resourceName: identity.handle,
        success: true,
      });
      res.json({ success: true });
    } catch (error) {
      fail(res, "Failed to delete Termix ID", error);
    }
  });

  const needIdentity = async (res: Response): Promise<IdentityRow | null> => {
    const identity = await store.identityForUser(userId());
    if (!identity) {
      res
        .status(400)
        .json({ error: "Create a Termix ID handle before adding keys" });
    }
    return identity;
  };

  /**
   * @openapi
   * /plugin-api/termix-identity/keys:
   *   post:
   *     summary: Publish a public key
   *     description: Publishes a pasted key, or the public half of one of the user's saved SSH key credentials.
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
   *       400:
   *         description: No identity, or the key is invalid
   *       404:
   *         description: Credential not found
   *       409:
   *         description: Already published
   */
  router.post("/keys", async (req, res) => {
    const credentialId =
      req.body?.credentialId != null ? parseId(req.body.credentialId) : null;
    try {
      const identity = await needIdentity(res);
      if (!identity) return;

      let rawPublicKey: string | null = null;
      let source = "manual";
      let label = cleanLabel(req.body?.label);

      if (credentialId) {
        const credential = (await ctx.credentials.listSshKeys()).find(
          (key) => key.id === credentialId,
        );
        if (!credential) {
          return res.status(404).json({ error: "Credential not found" });
        }
        if (!credential.publicKey) {
          return res.status(400).json({
            error:
              "This credential has no public key and one could not be derived. Paste the public key manually.",
          });
        }
        source = "credential";
        label = label || credential.name || null;
        rawPublicKey = credential.publicKey;
      } else if (typeof req.body?.publicKey === "string") {
        rawPublicKey = req.body.publicKey;
      }

      const parsed = parsePublicKey(rawPublicKey);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid SSH public key" });
      }

      const existing = await store.keysForIdentity(identity.id);
      if (existing.some((key) => key.publicKey === parsed.normalized)) {
        return res.status(409).json({ error: "This key is already published" });
      }

      const key = await store.createKey({
        identityId: identity.id,
        userId: identity.userId,
        publicKey: parsed.normalized,
        keyType: parsed.type,
        algorithm: parsed.algorithm,
        label,
        comment: parsed.comment || null,
        source,
        credentialId: credentialId || null,
      });
      await ctx.audit.record({
        action: "add_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(key.id),
        resourceName: identity.handle,
        details: `${parsed.algorithm} (${source})`,
        success: true,
      });
      res.status(201).json(key);
    } catch (error) {
      fail(res, "Failed to add key", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/keys/generate:
   *   post:
   *     summary: Generate a new key pair and publish the public key
   *     description: The private key is returned once. With saveCredential (the default) the pair is also saved as an SSH key credential.
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
   *         description: Generated key info with the private key (shown once)
   */
  router.post("/keys/generate", async (req, res) => {
    const keyType = req.body?.type === "rsa" ? "rsa" : "ed25519";
    const saveCredential = req.body?.saveCredential !== false;
    const username =
      typeof req.body?.username === "string" ? req.body.username.trim() : null;
    try {
      const identity = await needIdentity(res);
      if (!identity) return;

      const comment = `termix-${identity.handle}`;
      const pair =
        keyType === "rsa"
          ? ssh2.utils.generateKeyPairSync("rsa", { bits: 4096, comment })
          : ssh2.utils.generateKeyPairSync("ed25519", { comment });
      const parsed = parsePublicKey(pair.public);
      if (!parsed) {
        return res.status(500).json({ error: "Key generation failed" });
      }

      // The published row only ever holds the public key; the pair goes to
      // the user's encrypted credentials. Publish first so a failed save can
      // be undone here, since the plugin cannot delete credentials.
      const key = await store.createKey({
        identityId: identity.id,
        userId: identity.userId,
        publicKey: parsed.normalized,
        keyType: parsed.type,
        algorithm: parsed.algorithm,
        label: cleanLabel(req.body?.label) || `Generated ${parsed.algorithm}`,
        comment: parsed.comment || null,
        source: "generated",
        credentialId: null,
      });

      let credentialId: number | null = null;
      if (saveCredential) {
        try {
          ({ id: credentialId } = await ctx.credentials.createSshKey({
            name: `Termix ID @${identity.handle} (${parsed.algorithm})`,
            description: "Auto-generated by Termix ID",
            username,
            privateKey: pair.private,
            publicKey: parsed.normalized,
            keyType: parsed.type,
          }));
          await store.updateKey(identity.userId, key.id, { credentialId });
        } catch (error) {
          await store.deleteKey(identity.userId, key.id);
          throw error;
        }
      }

      await ctx.audit.record({
        action: "generate_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(key.id),
        resourceName: identity.handle,
        details: `${parsed.algorithm}${credentialId !== null ? " (saved to credentials)" : ""}`,
        success: true,
      });
      res.status(201).json({
        key: { ...key, credentialId },
        privateKey: pair.private,
        publicKey: parsed.normalized,
        credentialId,
      });
    } catch (error) {
      fail(res, "Failed to generate key", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/keys/{id}:
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
   *       404:
   *         description: Key not found
   */
  router.patch("/keys/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid key id" });
    try {
      const update: { enabled?: boolean; label?: string | null } = {};
      if (req.body?.enabled !== undefined) update.enabled = !!req.body.enabled;
      if (req.body?.label !== undefined)
        update.label = cleanLabel(req.body.label);
      const key = await store.updateKey(userId(), id, update);
      if (!key) return res.status(404).json({ error: "Key not found" });
      await ctx.audit.record({
        action: "update_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(id),
        resourceName: key.label ?? key.algorithm,
        details:
          update.enabled !== undefined
            ? `enabled: ${update.enabled}`
            : "label updated",
        success: true,
      });
      res.json(key);
    } catch (error) {
      fail(res, "Failed to update key", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/keys/{id}:
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
   *       404:
   *         description: Key not found
   */
  router.delete("/keys/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid key id" });
    try {
      const deleted = await store.deleteKey(userId(), id);
      if (!deleted) return res.status(404).json({ error: "Key not found" });
      await ctx.audit.record({
        action: "delete_termix_id_key",
        resourceType: "termix_id_key",
        resourceId: String(id),
        resourceName: deleted.algorithm,
        success: true,
      });
      res.json({ success: true });
    } catch (error) {
      fail(res, "Failed to delete key", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/ca:
   *   get:
   *     summary: Get the current user's certificate authority
   *     tags: [Termix ID]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: CA info or null
   */
  router.get("/ca", async (req, res) => {
    try {
      const identity = await store.identityForUser(userId());
      if (!identity) return res.json({ ca: null });
      const ca = await store.caForIdentity(identity.id);
      if (!ca) return res.json({ ca: null });
      res.json({
        ca: {
          publicKey: ca.publicKey,
          validityDays: ca.validityDays,
          ...withUrls(req, identity.handle, "/ca"),
        },
      });
    } catch (error) {
      fail(res, "Failed to fetch CA", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/ca:
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
   *       409:
   *         description: CA already exists
   */
  router.post("/ca", async (req, res) => {
    try {
      const identity = await store.identityForUser(userId());
      if (!identity) {
        return res
          .status(400)
          .json({ error: "Create a Termix ID handle first" });
      }
      if (await store.caForIdentity(identity.id)) {
        return res.status(409).json({ error: "CA already exists" });
      }
      const validityDays = clampValidityDays(req.body?.validityDays, 90);
      const generated = generateCa();
      await store.createCa({
        identityId: identity.id,
        userId: identity.userId,
        publicKey: generated.publicKeyLine,
        privateKey: await ctx.secrets.seal(generated.privateKeyPem),
        validityDays,
      });
      await ctx.audit.record({
        action: "create_termix_id_ca",
        resourceType: "termix_id_ca",
        resourceName: identity.handle,
        success: true,
      });
      res.status(201).json({
        publicKey: generated.publicKeyLine,
        validityDays,
        ...withUrls(req, identity.handle, "/ca"),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: "CA already exists" });
      }
      fail(res, "Failed to create CA", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/ca/rotate:
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
   *       404:
   *         description: No Termix ID or no CA
   */
  router.post("/ca/rotate", async (req, res) => {
    try {
      const identity = await store.identityForUser(userId());
      if (!identity)
        return res.status(404).json({ error: "No Termix ID found" });
      const existing = await store.caForIdentity(identity.id);
      if (!existing) return res.status(404).json({ error: "No CA to rotate" });

      const validityDays = clampValidityDays(
        req.body?.validityDays,
        existing.validityDays,
      );
      // A new key invalidates every certificate the old one signed: this is
      // the revocation mechanism.
      const generated = generateCa();
      await store.replaceCa(identity.id, {
        publicKey: generated.publicKeyLine,
        privateKey: await ctx.secrets.seal(generated.privateKeyPem),
        validityDays,
      });
      await ctx.audit.record({
        action: "rotate_termix_id_ca",
        resourceType: "termix_id_ca",
        resourceName: identity.handle,
        success: true,
      });
      res.json({
        publicKey: generated.publicKeyLine,
        validityDays,
        ...withUrls(req, identity.handle, "/ca"),
      });
    } catch (error) {
      fail(res, "Failed to rotate CA", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/ca:
   *   delete:
   *     summary: Delete the certificate authority
   *     tags: [Termix ID]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Deleted
   *       404:
   *         description: No Termix ID or no CA
   */
  router.delete("/ca", async (_req, res) => {
    try {
      const identity = await store.identityForUser(userId());
      if (!identity)
        return res.status(404).json({ error: "No Termix ID found" });
      if (!(await store.deleteCa(identity.id))) {
        return res.status(404).json({ error: "No CA to delete" });
      }
      await ctx.audit.record({
        action: "delete_termix_id_ca",
        resourceType: "termix_id_ca",
        resourceName: identity.handle,
        success: true,
      });
      res.json({ success: true });
    } catch (error) {
      fail(res, "Failed to delete CA", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/keys/{id}/certificate:
   *   post:
   *     summary: Issue an SSH certificate for a key (Ed25519 only)
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
   *       400:
   *         description: Not an Ed25519 key, or no CA
   *       404:
   *         description: Key not found
   */
  router.post("/keys/:id/certificate", async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid key id" });
    try {
      const owner = userId();
      const key = await store.keyForUser(owner, id);
      if (!key) return res.status(404).json({ error: "Key not found" });
      if (!ed25519RawFromLine(key.publicKey)) {
        return res
          .status(400)
          .json({ error: "Certificates are only supported for Ed25519 keys" });
      }
      const identity = await store.identityForUser(owner);
      if (!identity)
        return res.status(404).json({ error: "No Termix ID found" });
      const ca = await store.caForIdentity(identity.id);
      const caPrivateKey = ca ? await ctx.secrets.unseal(ca.privateKey) : null;
      if (!ca || !caPrivateKey) {
        return res
          .status(400)
          .json({ error: "Enable a certificate authority first" });
      }

      const validityDays = clampValidityDays(
        req.body?.validityDays,
        ca.validityDays,
      );
      const principals: string[] = Array.isArray(req.body?.principals)
        ? req.body.principals
            .filter((p: unknown) => typeof p === "string" && p.trim())
            .map((p: string) => p.trim())
            .slice(0, 32)
        : [];

      const now = Math.floor(Date.now() / 1000);
      const validBefore = now + validityDays * 86400;
      const keyId = `termix:@${identity.handle}:${id}`;
      const certificate = signUserCertificate({
        userPublicKeyLine: key.publicKey,
        caPrivateKeyPem: caPrivateKey,
        caPublicKeyLine: ca.publicKey,
        keyId,
        principals,
        validAfter: now - 60,
        validBefore,
      });
      if (!certificate) {
        return res.status(500).json({ error: "Failed to sign certificate" });
      }

      await ctx.audit.record({
        action: "issue_termix_id_certificate",
        resourceType: "termix_id_key",
        resourceId: String(id),
        resourceName: identity.handle,
        details: `validity ${validityDays}d${principals.length ? `, principals: ${principals.join(",")}` : ""}`,
        success: true,
      });
      res.json({ certificate, keyId, validBefore, principals, validityDays });
    } catch (error) {
      fail(res, "Failed to issue certificate", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/linked-credentials:
   *   get:
   *     summary: Credential ids with at least one enabled published key
   *     tags: [Termix ID]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of credential ids
   */
  router.get("/linked-credentials", async (_req, res) => {
    try {
      const identity = await store.identityForUser(userId());
      if (!identity) return res.json({ credentialIds: [] });
      res.json({
        credentialIds: await store.linkedCredentialIds(identity.id),
      });
    } catch (error) {
      fail(res, "Failed to fetch linked credentials", error);
    }
  });

  /**
   * @openapi
   * /plugin-api/termix-identity/credentials:
   *   get:
   *     summary: The user's SSH key credentials that can be published
   *     description: Id and name of each saved SSH key credential, for the import picker. No key material.
   *     tags: [Termix ID]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: List of key credentials
   */
  router.get("/credentials", async (_req, res) => {
    try {
      const keys = await ctx.credentials.listSshKeys();
      res.json({
        credentials: keys.map((key) => ({ id: key.id, name: key.name })),
      });
    } catch (error) {
      fail(res, "Failed to fetch credentials", error);
    }
  });
}
