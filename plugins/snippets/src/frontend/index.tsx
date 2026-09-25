import { Play } from "lucide-react";
import type { PanelProps, TermixApp } from "@termix/plugin-sdk/frontend";
import { SnippetsPanel } from "./SnippetsPanel";
import { createSnippetsApi } from "./snippets-api";
import { resolveSnippetContent, hasSnippetInputs } from "./snippet-variables";
import {
  AdminUserSnippets,
  adminOptions,
  mapSnippets,
} from "./AdminUserSnippets";

export function activate(app: TermixApp): void {
  app.registerRailItem({
    id: "snippets",
    icon: Play,
    titleKey: "nav.snippets",
    permission: "view",
    // The most approachable power feature, so Simple keeps it.
    simplePreset: true,
  });

  app.registerPanel("snippets", (props: PanelProps) => (
    <SnippetsPanel {...props} />
  ));

  app.registerPaletteEntry({
    id: "snippets.run",
    titleKey: "nav.snippets",
    scope: "global",
    icon: Play,
    run: async (shell) => {
      shell.openRailView("snippets");
    },
  });

  app.registerSlotContribution("onboarding.features", {
    actionId: "snippets.feature",
    titleKey: "onboarding.feature_snippets",
    descriptionKey: "onboarding.feature_snippets_desc",
    icon: Play,
  });

  // The admin "manage user" panel's Snippets tab.
  app.registerSlotContribution("admin.userTabs", {
    actionId: "snippets.adminUserTab",
    titleKey: "admin.tabTitle",
    kind: "component",
    component: AdminUserSnippets as never,
    order: 10,
  });

  // Core's snippet pickers (the host editor's startup snippet, keybindings,
  // the command palette) read the list through this. An admin editing
  // another user's host passes that user's id.
  app.registerAction("snippet.list", (async (options?: {
    targetUserId?: string;
  }) => {
    const response = options?.targetUserId
      ? await app.api.get("/", adminOptions(options.targetUserId))
      : await app.api.get("/");
    const raw = response.data as unknown;
    const list = Array.isArray(raw)
      ? raw
      : ((raw as { snippets?: unknown[] })?.snippets ?? []);
    return (list as Record<string, unknown>[]).map((row) => ({
      ...mapSnippets([row])[0],
      isNote: row.isNote === true,
    }));
  }) as never);

  // Resolves a snippet by id for a terminal (startup snippet, custom
  // keybindings, the command palette), so core never imports snippet code.
  const resolveForTerminal = async (
    snippetId: number,
    host: {
      ip?: string;
      username?: string;
      port?: number;
      name?: string;
    } | null,
    inputValues?: Record<string, string>,
  ) => {
    const api = createSnippetsApi(app.api);
    const snippet = await api.get(snippetId).catch(() => null);
    if (!snippet) return null;
    if (
      hasSnippetInputs(snippet.content) &&
      (!inputValues || Object.keys(inputValues).length === 0)
    ) {
      return {
        needsInputs: true,
        content: snippet.content,
        isNote: snippet.isNote,
      };
    }
    return {
      needsInputs: false,
      content: resolveSnippetContent(snippet.content, host, inputValues ?? {}),
      isNote: snippet.isNote,
    };
  };
  app.registerAction("snippet.resolveForTerminal", resolveForTerminal as never);
  app.registerAction(
    "snippets.resolveForTerminal",
    resolveForTerminal as never,
  );

  // For other plugins' quick actions (host metrics): the snippet's content,
  // so the caller can ask for $INPUT_n values, and a run on a host.
  app.registerAction("snippets.get", (async (snippetId: number) => {
    const snippet = await createSnippetsApi(app.api)
      .get(snippetId)
      .catch(() => null);
    return snippet
      ? { id: snippet.id, name: snippet.name, content: snippet.content }
      : null;
  }) as never);

  // For pickers in other plugins (the AI assistant's @-mentions): id and name.
  app.registerAction("snippets.list", (async () => {
    const snippets = await createSnippetsApi(app.api)
      .list()
      .catch(() => []);
    return snippets.map((snippet) => ({ id: snippet.id, name: snippet.name }));
  }) as never);

  app.registerAction("snippets.execute", (async (
    snippetId: number,
    hostId: number,
    inputValues?: Record<string, string>,
  ) =>
    createSnippetsApi(app.api).execute(
      snippetId,
      hostId,
      inputValues,
    )) as never);
}
