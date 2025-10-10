import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { snippets } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// Get all snippets for the authenticated user
// GET /snippets
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      authLogger.warn("Invalid userId for snippets fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const result = await db
        .select()
        .from(snippets)
        .where(eq(snippets.userId, userId))
        .orderBy(desc(snippets.updatedAt));

      res.json(result);
    } catch (err) {
      authLogger.error("Failed to fetch snippets", err);
      res.status(500).json({ error: "Failed to fetch snippets" });
    }
  },
);

// Get a specific snippet by ID
// GET /snippets/:id
router.get(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;
    const snippetId = parseInt(id, 10);

    if (!isNonEmptyString(userId) || isNaN(snippetId)) {
      authLogger.warn("Invalid request for snippet fetch: invalid ID", {
        userId,
        id,
      });
      return res.status(400).json({ error: "Invalid request parameters" });
    }

    try {
      const result = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      if (result.length === 0) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      res.json(result[0]);
    } catch (err) {
      authLogger.error("Failed to fetch snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to fetch snippet",
      });
    }
  },
);

// Create a new snippet
// POST /snippets
router.post(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, content, description } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(name) ||
      !isNonEmptyString(content)
    ) {
      authLogger.warn("Invalid snippet creation data validation failed", {
        operation: "snippet_create",
        userId,
        hasName: !!name,
        hasContent: !!content,
      });
      return res.status(400).json({ error: "Name and content are required" });
    }

    try {
      const insertData = {
        userId,
        name: name.trim(),
        content: content.trim(),
        description: description?.trim() || null,
      };

      const result = await db.insert(snippets).values(insertData).returning();

      authLogger.success(`Snippet created: ${name} by user ${userId}`, {
        operation: "snippet_create_success",
        userId,
        snippetId: result[0].id,
        name,
      });

      res.status(201).json(result[0]);
    } catch (err) {
      authLogger.error("Failed to create snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to create snippet",
      });
    }
  },
);

// Update a snippet
// PUT /snippets/:id
router.put(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;
    const updateData = req.body;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for snippet update");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      if (existing.length === 0) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      const updateFields: Partial<{
        updatedAt: ReturnType<typeof sql.raw>;
        name: string;
        content: string;
        description: string | null;
      }> = {
        updatedAt: sql`CURRENT_TIMESTAMP`,
      };

      if (updateData.name !== undefined)
        updateFields.name = updateData.name.trim();
      if (updateData.content !== undefined)
        updateFields.content = updateData.content.trim();
      if (updateData.description !== undefined)
        updateFields.description = updateData.description?.trim() || null;

      await db
        .update(snippets)
        .set(updateFields)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      const updated = await db
        .select()
        .from(snippets)
        .where(eq(snippets.id, parseInt(id)));

      authLogger.success(
        `Snippet updated: ${updated[0].name} by user ${userId}`,
        {
          operation: "snippet_update_success",
          userId,
          snippetId: parseInt(id),
          name: updated[0].name,
        },
      );

      res.json(updated[0]);
    } catch (err) {
      authLogger.error("Failed to update snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to update snippet",
      });
    }
  },
);

// Delete a snippet
// DELETE /snippets/:id
router.delete(
  "/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;

    if (!isNonEmptyString(userId) || !id) {
      authLogger.warn("Invalid request for snippet delete");
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const existing = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      if (existing.length === 0) {
        return res.status(404).json({ error: "Snippet not found" });
      }

      await db
        .delete(snippets)
        .where(and(eq(snippets.id, parseInt(id)), eq(snippets.userId, userId)));

      authLogger.success(
        `Snippet deleted: ${existing[0].name} by user ${userId}`,
        {
          operation: "snippet_delete_success",
          userId,
          snippetId: parseInt(id),
          name: existing[0].name,
        },
      );

      res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete snippet", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to delete snippet",
      });
    }
  },
);

export default router;
