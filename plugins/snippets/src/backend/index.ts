import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { snippetAccess, snippetFolders, snippets } from "./tables.js";
import { createSnippetRepository } from "./repository.js";
import { registerSnippetRoutes } from "./routes.js";
import { resolveSnippetCommand } from "./execution.js";

/** What other plugins get from ctx.services.get("snippets.access", {userId}). */
export interface SnippetsService {
  /** The calling user's own snippets (not shared ones), full content included. */
  list: () => Promise<
    Array<{
      id: number;
      name: string;
      content: string;
      description: string | null;
      isNote: boolean;
      folder: string | null;
    }>
  >;
  /** A snippet the calling user owns or was shared with them. */
  get: (id: number) => Promise<{
    id: number;
    name: string;
    content: string;
    isNote: boolean;
  } | null>;
  resolveCommand: (
    id: number,
    vars: { ip?: string; username?: string; port?: number; name?: string },
    inputValues?: Record<string, string>,
  ) => Promise<string | null>;
  /** Creates a snippet owned by the calling user. */
  create: (input: {
    name: string;
    content: string;
    description?: string | null;
    folder?: string | null;
  }) => Promise<{ id: number; name: string }>;
  /** Updates a snippet the calling user owns. Throws if not found. */
  update: (
    id: number,
    changes: {
      name?: string;
      content?: string;
      description?: string | null;
      folder?: string | null;
    },
  ) => Promise<void>;
  /** Deletes a snippet the calling user owns. Returns whether one was deleted. */
  remove: (id: number) => Promise<boolean>;
}

export async function activate(ctx: PluginContext) {
  const snippetsTable = await ctx.db.define(snippets);
  const foldersTable = await ctx.db.define(snippetFolders);
  const accessTable = await ctx.db.define(snippetAccess);

  const repo = createSnippetRepository(
    ctx.db,
    snippetsTable,
    foldersTable,
    accessTable,
  );

  registerSnippetRoutes(ctx.http.router<Router>(), repo, ctx);

  ctx.sync.registerEntity({
    type: "snippetFolders",
    table: foldersTable,
    order: 40,
  });
  ctx.sync.registerEntity({
    type: "snippets",
    table: snippetsTable,
    order: 60,
  });

  // The user row survives a password-reset data wipe, so it never triggers
  // our refUser() cascade; this topic is core's way of telling us to drop
  // our copy of that user's data too.
  ctx.events.on("user.data_wiped", (payload) => {
    const userId = (payload as { userId?: string } | null)?.userId;
    if (userId) void repo.deleteByUserId(userId);
  });

  async function findAccessible(userId: string, id: number) {
    const owned = await repo.findOwnedById(userId, id);
    if (owned) return owned;
    const roleIds = await repo.listUserRoleIds(userId);
    return repo.findAccessibleSharedSnippet(id, userId, roleIds);
  }

  // The service is gated on snippets.view; a write also needs the same
  // permission its route requires, so a caller cannot write through here
  // what the user could not write in the panel.
  async function requirePermission(permission: string): Promise<void> {
    if (!(await ctx.rbac.has(permission))) {
      throw new Error(`Missing permission snippets.${permission}`);
    }
  }

  const service: SnippetsService = {
    list: async () => {
      const userId = ctx.currentActor();
      if (!userId) return [];
      const owned = await repo.listOwnedSnippets(userId);
      return owned.map((s) => ({
        id: s.id,
        name: s.name,
        content: s.content,
        description: s.description,
        isNote: s.isNote,
        folder: s.folder,
      }));
    },
    get: async (id) => {
      const userId = ctx.currentActor();
      if (!userId) return null;
      const snippet = await findAccessible(userId, id);
      if (!snippet) return null;
      return {
        id: snippet.id,
        name: snippet.name,
        content: snippet.content,
        isNote: snippet.isNote,
      };
    },
    resolveCommand: async (id, vars, inputValues = {}) => {
      const userId = ctx.currentActor();
      if (!userId) return null;
      const snippet = await findAccessible(userId, id);
      if (!snippet) return null;
      return resolveSnippetCommand(snippet.content, vars, inputValues);
    },
    create: async (input) => {
      const userId = ctx.currentActor();
      if (!userId) throw new Error("snippets.access.create needs an actor");
      await requirePermission("create");
      const created = await repo.createSnippet(userId, input);
      return { id: created.id, name: created.name };
    },
    update: async (id, changes) => {
      const userId = ctx.currentActor();
      if (!userId) throw new Error("snippets.access.update needs an actor");
      await requirePermission("edit");
      const result = await repo.updateSnippet(userId, id, changes);
      if (!result) throw new Error("Snippet not found");
    },
    remove: async (id) => {
      const userId = ctx.currentActor();
      if (!userId) throw new Error("snippets.access.remove needs an actor");
      await requirePermission("delete");
      const existing = await repo.deleteSnippet(userId, id);
      if (existing?.syncId) {
        await ctx.sync.recordTombstone(userId, "snippets", existing.syncId);
      }
      return !!existing;
    },
  };
  ctx.services.provide("snippets.access", service);

  ctx.log.info("Snippets routes mounted at /plugin-api/snippets");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
