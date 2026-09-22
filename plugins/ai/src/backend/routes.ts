import { getErrorMessage } from "../../../../src/backend/utils/error-message.js";
import express from "express";
import {
  registerAiRouter,
  unregisterAiRouter,
} from "../../../../src/backend/database/routes/ai-dispatch.js";
import type { AuthenticatedRequest } from "../../../../src/types/index.js";
import { PermissionManager } from "../../../../src/backend/utils/permission-manager.js";
import { AuthManager } from "../../../../src/backend/utils/auth-manager.js";
import { databaseLogger } from "../../../../src/backend/utils/logger.js";
import {
  getAuditUsername,
  getRequestMeta,
  logAudit,
} from "../../../../src/backend/utils/audit-logger.js";
import {
  createCurrentAiRepository,
  createCurrentHostRepository,
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../../../../src/backend/database/repositories/factory.js";
import type { UserRecord } from "../../../../src/backend/database/repositories/user-repository.js";
import { buildSystemPrompt } from "./context.js";
import { AI_PRIVATE_ALLOWLIST_KEY, parseAllowlist } from "./egress.js";
import { runAgent } from "./engine.js";
import {
  AI_GLOBAL_ENABLED_KEY,
  createAiGate,
  isAiGloballyEnabled,
  resolveAiAccess,
} from "./gating.js";
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
import { applyProposal } from "./tools/executor.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();
const aiGate = createAiGate();

function parseId(raw: unknown): number | null {
  const id = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getAdminActor(
  userId: string | undefined,
): Promise<UserRecord | null> {
  if (!userId) return null;
  const user = await createCurrentUserRepository().findById(userId);
  return user?.isAdmin ? user : null;
}

/**
 * @openapi
 * /ai/enabled:
 *   get:
 *     summary: Get whether the AI assistant is enabled instance-wide
 *     tags:
 *       - AI
 *     responses:
 *       200:
 *         description: AI enabled status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 */
router.get("/enabled", authenticateJWT, async (_req, res) => {
  try {
    res.json({
      // Defaults to false so upgrading an install never turns the assistant
      // on without an admin deciding to.
      enabled: await createCurrentSettingsRepository().getBoolean(
        AI_GLOBAL_ENABLED_KEY,
        false,
      ),
    });
  } catch (err) {
    databaseLogger.error("Failed to get AI enabled setting", err, {
      operation: "ai_enabled_get_failed",
    });
    res.status(500).json({ error: "Failed to get AI enabled setting" });
  }
});

/**
 * @openapi
 * /ai/enabled:
 *   patch:
 *     summary: Update the instance-wide AI assistant setting (admin only)
 *     description: Turning this off hides and blocks the assistant for every user, whatever their own preference says.
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
 *         description: Setting updated.
 *       403:
 *         description: Not authorized.
 */
router.patch("/enabled", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const actor = await getAdminActor(userId);
    if (!actor) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }
    await createCurrentSettingsRepository().set(
      AI_GLOBAL_ENABLED_KEY,
      enabled ? "true" : "false",
    );

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId: userId as string,
      username: actor.username ?? (userId as string),
      action: "update_ai_enabled",
      resourceType: "setting",
      details: JSON.stringify({ enabled }),
      ipAddress,
      userAgent,
      success: true,
    });

    res.json({ enabled });
  } catch (err) {
    databaseLogger.error("Failed to update AI enabled setting", err, {
      operation: "ai_enabled_update_failed",
    });
    res.status(500).json({ error: "Failed to update AI enabled setting" });
  }
});

/**
 * @openapi
 * /ai/private-endpoints:
 *   get:
 *     summary: Get the allowlist of private AI endpoint hosts
 *     tags:
 *       - AI
 *     responses:
 *       200:
 *         description: Allowed hosts.
 */
router.get("/private-endpoints", authenticateJWT, async (_req, res) => {
  try {
    const raw = await createCurrentSettingsRepository().get(
      AI_PRIVATE_ALLOWLIST_KEY,
    );
    res.json({ hosts: parseAllowlist(raw) });
  } catch (err) {
    databaseLogger.error("Failed to get AI private endpoint allowlist", err, {
      operation: "ai_private_endpoints_get_failed",
    });
    res.status(500).json({ error: "Failed to get the allowlist" });
  }
});

/**
 * @openapi
 * /ai/private-endpoints:
 *   patch:
 *     summary: Replace the allowlist of private AI endpoint hosts (admin only)
 *     description: >
 *       Providers on private or loopback addresses, such as a self-hosted
 *       Ollama, are refused unless their host appears here. Without this an
 *       ordinary user could point a provider at an internal service and use
 *       the server as a probe of its own network.
 *     tags:
 *       - AI
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hosts:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Allowlist updated.
 *       403:
 *         description: Not authorized.
 */
router.patch("/private-endpoints", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const actor = await getAdminActor(userId);
    if (!actor) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { hosts } = req.body ?? {};
    if (!Array.isArray(hosts)) {
      return res.status(400).json({ error: "hosts must be an array" });
    }
    if (hosts.length > 50) {
      return res.status(400).json({ error: "At most 50 hosts are allowed" });
    }

    const cleaned: string[] = [];
    for (const entry of hosts) {
      if (typeof entry !== "string") {
        return res.status(400).json({ error: "Each host must be a string" });
      }
      const host = entry.trim().toLowerCase();
      if (!host) continue;
      // A bare host, not a URL: no scheme, path, port or whitespace.
      if (!/^[a-z0-9._:-]+$/.test(host)) {
        return res
          .status(400)
          .json({ error: `${entry} is not a valid hostname` });
      }
      if (!cleaned.includes(host)) cleaned.push(host);
    }

    await createCurrentSettingsRepository().set(
      AI_PRIVATE_ALLOWLIST_KEY,
      JSON.stringify(cleaned),
    );

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId: userId as string,
      username: actor.username ?? (userId as string),
      action: "update_ai_private_endpoints",
      resourceType: "setting",
      details: JSON.stringify({ hosts: cleaned }),
      ipAddress,
      userAgent,
      success: true,
    });

    res.json({ hosts: cleaned });
  } catch (err) {
    databaseLogger.error(
      "Failed to update AI private endpoint allowlist",
      err,
      {
        operation: "ai_private_endpoints_update_failed",
      },
    );
    res.status(500).json({ error: "Failed to update the allowlist" });
  }
});

/**
 * @openapi
 * /ai/status:
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
router.get("/status", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId as string;
  try {
    const [globalEnabled, access] = await Promise.all([
      isAiGloballyEnabled(),
      resolveAiAccess(userId),
    ]);
    res.json({
      globallyEnabled: globalEnabled,
      enabled: access.enabled,
      allowReadOnlyCommands: access.allowReadOnlyCommands,
    });
  } catch (err) {
    databaseLogger.error("Failed to read AI status", err, {
      operation: "ai_status_failed",
      userId,
    });
    res.status(500).json({ error: "Failed to read AI status" });
  }
});

/**
 * @openapi
 * /ai/providers:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.use"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    try {
      const providers = await createCurrentAiRepository().listProviders(userId);
      res.json({ providers });
    } catch (err) {
      databaseLogger.error("Failed to list AI providers", err, {
        operation: "ai_providers_list_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to list providers" });
    }
  },
);

/**
 * @openapi
 * /ai/providers:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.manage_providers"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const { providerType, label, baseUrl, apiKey, defaultModel } =
      req.body ?? {};

    if (!isAiProviderType(providerType)) {
      return res.status(400).json({ error: "Unknown provider type" });
    }
    if (typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ error: "label is required" });
    }
    if (REQUIRES_BASE_URL.includes(providerType) && !baseUrl?.trim()) {
      return res.status(400).json({ error: "This provider needs a base URL" });
    }
    if (REQUIRES_API_KEY.includes(providerType) && !apiKey?.trim()) {
      return res.status(400).json({ error: "This provider needs an API key" });
    }

    try {
      const created = await createCurrentAiRepository().createProvider({
        userId,
        providerType,
        label: label.trim(),
        baseUrl: typeof baseUrl === "string" ? baseUrl.trim() : null,
        apiKey: typeof apiKey === "string" ? apiKey.trim() : null,
        defaultModel:
          typeof defaultModel === "string" ? defaultModel.trim() : null,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "create_ai_provider",
        resourceType: "ai_provider",
        resourceId: String(created.id),
        resourceName: created.label,
        ipAddress,
        userAgent,
        success: true,
      });

      res.status(201).json({ provider: created });
    } catch (err) {
      databaseLogger.error("Failed to create AI provider", err, {
        operation: "ai_provider_create_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to create provider" });
    }
  },
);

/**
 * @openapi
 * /ai/providers/{id}:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.manage_providers"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid provider id" });

    try {
      const updated = await createCurrentAiRepository().updateProvider(
        id,
        userId,
        req.body ?? {},
      );
      if (!updated)
        return res.status(404).json({ error: "Provider not found" });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "update_ai_provider",
        resourceType: "ai_provider",
        resourceId: String(id),
        resourceName: updated.label,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ provider: updated });
    } catch (err) {
      databaseLogger.error("Failed to update AI provider", err, {
        operation: "ai_provider_update_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to update provider" });
    }
  },
);

/**
 * @openapi
 * /ai/providers/{id}:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.manage_providers"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid provider id" });

    try {
      const deleted = await createCurrentAiRepository().deleteProvider(
        id,
        userId,
      );
      if (!deleted)
        return res.status(404).json({ error: "Provider not found" });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "delete_ai_provider",
        resourceType: "ai_provider",
        resourceId: String(id),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to delete AI provider", err, {
        operation: "ai_provider_delete_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to delete provider" });
    }
  },
);

/**
 * @openapi
 * /ai/probe-models:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.manage_providers"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const { providerType, baseUrl, apiKey, providerId } = req.body ?? {};

    if (!isAiProviderType(providerType)) {
      return res.status(400).json({ error: "Unknown provider type" });
    }

    try {
      // Editing an existing provider sends no key, so fall back to the stored
      // one rather than making the user retype it just to refresh the list.
      let resolvedKey =
        typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
      if (!resolvedKey && parseId(providerId)) {
        const stored = await createCurrentAiRepository().findProviderWithSecret(
          parseId(providerId) as number,
          userId,
        );
        resolvedKey = stored?.apiKey ?? null;
      }

      const models = await getAdapter(providerType).listModels({
        providerType,
        baseUrl: typeof baseUrl === "string" ? baseUrl.trim() : null,
        apiKey: resolvedKey,
      });

      res.json({ models, source: "live" });
    } catch (err) {
      // A provider that cannot be reached yet still gets a usable list, so the
      // form is never a blank text box the user has to guess into.
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
 * /ai/providers/{id}/models:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.use"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid provider id" });

    try {
      const provider = await createCurrentAiRepository().findProviderWithSecret(
        id,
        userId,
      );
      if (!provider)
        return res.status(404).json({ error: "Provider not found" });

      const models = await getAdapter(provider.providerType).listModels({
        providerType: provider.providerType as ProviderConfig["providerType"],
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
      });
      res.json({ models });
    } catch (err) {
      // The message can carry the allowlist hint, which the user needs to act on.
      const message = getErrorMessage(err, "Could not reach the provider");
      databaseLogger.warn("Failed to list provider models", {
        operation: "ai_provider_models_failed",
        userId,
      });
      res.status(502).json({ error: message });
    }
  },
);

/**
 * @openapi
 * /ai/conversations:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.use"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    try {
      const conversations =
        await createCurrentAiRepository().listConversations(userId);
      res.json({ conversations });
    } catch (err) {
      databaseLogger.error("Failed to list AI conversations", err, {
        operation: "ai_conversations_list_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to list conversations" });
    }
  },
);

/**
 * @openapi
 * /ai/conversations/{id}:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.use"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid conversation id" });

    try {
      const repository = createCurrentAiRepository();
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
      databaseLogger.error("Failed to load AI conversation", err, {
        operation: "ai_conversation_load_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to load conversation" });
    }
  },
);

/**
 * @openapi
 * /ai/conversations/{id}:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.use"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid conversation id" });

    try {
      const deleted = await createCurrentAiRepository().deleteConversation(
        id,
        userId,
      );
      if (!deleted) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to delete AI conversation", err, {
        operation: "ai_conversation_delete_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  },
);

/**
 * @openapi
 * /ai/chat/stream:
 *   post:
 *     summary: Send a message and stream the assistant's reply
 *     description: >
 *       Server-sent events. Emits token, tool_call, tool_result, proposal,
 *       done and error frames.
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
  authenticateJWT,
  permissionManager.requirePermission("ai.use"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const { conversationId, providerId, model, message, activeTab } =
      req.body ?? {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const resolvedProviderId = parseId(providerId);
    if (!resolvedProviderId) {
      return res.status(400).json({ error: "providerId is required" });
    }

    const repository = createCurrentAiRepository();

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

      const access = await resolveAiAccess(userId);
      const hosts = await createCurrentHostRepository().listByUserId(userId);

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
        ...(entry.toolCalls ? { toolCalls: JSON.parse(entry.toolCalls) } : {}),
      }));
      chatHistory.push({ role: "user", content: message.trim() });

      let assistantText = "";
      let assistantToolCalls: unknown[] = [];

      try {
        for await (const event of runAgent({
          config: {
            providerType:
              provider.providerType as ProviderConfig["providerType"],
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
          },
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
          },
          signal: abort.signal,
        })) {
          if (event.type === "assistant_message") {
            assistantText = event.content;
            // Kept so the next message replays them verbatim. Gemini rejects a
            // turn whose functionCall parts lost their thoughtSignature, so
            // dropping these breaks the second message in every conversation.
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

            const { ipAddress, userAgent } = getRequestMeta(req);
            await logAudit({
              userId,
              username: await getAuditUsername(userId),
              action: "ai_proposal_created",
              resourceType: "ai_proposal",
              resourceId: String(stored.id),
              resourceName: event.draft.kind,
              ipAddress,
              userAgent,
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
      databaseLogger.error("AI chat stream failed", err, {
        operation: "ai_chat_stream_failed",
        userId,
      });
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
 * /ai/proposals/{id}/apply:
 *   post:
 *     summary: Apply a pending proposal
 *     description: >
 *       Re-validates the stored payload and dispatches it through the same
 *       repository logic a manual action uses.
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
  authenticateJWT,
  permissionManager.requirePermission("ai.apply_proposals"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid proposal id" });

    const repository = createCurrentAiRepository();

    try {
      const stored = await repository.findProposal(id, userId);
      if (!stored) return res.status(404).json({ error: "Proposal not found" });
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

      const result = await applyProposal(stored.kind, payload, userId);
      await repository.setProposalStatus(id, userId, "applied", result.summary);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "ai_proposal_applied",
        resourceType: "ai_proposal",
        resourceId: String(id),
        resourceName: stored.kind,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: result.ok, summary: result.summary });
    } catch (err) {
      const message = getErrorMessage(err, "Failed to apply the proposal");
      databaseLogger.error("Failed to apply AI proposal", err, {
        operation: "ai_proposal_apply_failed",
        userId,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "ai_proposal_applied",
        resourceType: "ai_proposal",
        resourceId: String(id),
        ipAddress,
        userAgent,
        success: false,
        errorMessage: message,
      });

      res.status(400).json({ error: message });
    }
  },
);

/**
 * @openapi
 * /ai/proposals/{id}/mark-run-in-terminal:
 *   post:
 *     summary: Record that a run_command proposal was executed in an open terminal
 *     description: >
 *       For the terminal-docked assistant only. The command is typed into the
 *       user's already-open SSH session client-side, not re-run over a pooled
 *       connection here; this just marks the proposal applied with the output
 *       the client captured, so the card and the pooled-connection /apply path
 *       stay in sync without running the command twice.
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
  authenticateJWT,
  permissionManager.requirePermission("ai.apply_proposals"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid proposal id" });

    const { hostId, summary } = req.body ?? {};
    const resolvedHostId = parseId(hostId);
    if (!resolvedHostId) {
      return res.status(400).json({ error: "hostId is required" });
    }

    const repository = createCurrentAiRepository();

    try {
      const stored = await repository.findProposal(id, userId);
      if (!stored) return res.status(404).json({ error: "Proposal not found" });
      if (stored.kind !== "propose_run_command") {
        return res
          .status(400)
          .json({ error: "Only run_command proposals can be marked this way" });
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
      await repository.setProposalStatus(id, userId, "applied", resultSummary);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "ai_proposal_applied",
        resourceType: "ai_proposal",
        resourceId: String(id),
        resourceName: stored.kind,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true, summary: resultSummary });
    } catch (err) {
      const message = getErrorMessage(
        err,
        "Failed to mark the proposal applied",
      );
      databaseLogger.error(
        "Failed to mark AI proposal applied in terminal",
        err,
        {
          operation: "ai_proposal_mark_run_in_terminal_failed",
          userId,
        },
      );
      res.status(400).json({ error: message });
    }
  },
);

/**
 * @openapi
 * /ai/proposals/{id}/reject:
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
  authenticateJWT,
  permissionManager.requirePermission("ai.use"),
  requireDataAccess,
  aiGate,
  async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId as string;
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid proposal id" });

    try {
      const updated = await createCurrentAiRepository().setProposalStatus(
        id,
        userId,
        "rejected",
      );
      if (!updated) {
        return res
          .status(404)
          .json({ error: "Proposal not found or already resolved" });
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "ai_proposal_rejected",
        resourceType: "ai_proposal",
        resourceId: String(id),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ success: true });
    } catch (err) {
      databaseLogger.error("Failed to reject AI proposal", err, {
        operation: "ai_proposal_reject_failed",
        userId,
      });
      res.status(500).json({ error: "Failed to reject the proposal" });
    }
  },
);

/** Called from activate(). Mounts this router at /ai via the shared dispatcher. */
export function startAiService(): void {
  registerAiRouter(router);
}

/** Called from deactivate(). /ai/* falls back to 404 until reactivated. */
export function stopAiService(): void {
  unregisterAiRouter();
}
