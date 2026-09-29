import { Clipboard, Play } from "lucide-react";
import type {
  PaletteItem,
  PanelProps,
  PluginHostRecord,
  TermixApp,
} from "@termix/plugin-sdk/frontend";
import type { Snippet } from "./types";
import { SnippetsPanel } from "./SnippetsPanel";
import { createSnippetsApi } from "./snippets-api";
import {
  extractSnippetInputs,
  resolveSnippetContent,
  type SnippetHostContext,
} from "../shared/variables.js";
import {
  readStartupSnippetId,
  snippetHostSettings,
} from "../shared/host-settings.js";
import { AdminUserSnippets } from "./AdminUserSnippets";
import { SnippetOverlay } from "./SnippetOverlay";
import { HostSnippetsSection } from "./HostSnippetsSection";
import { QuickActionButtons } from "./QuickActionButtons";
import { resetPrompts } from "./prompt-store";
import { fetchSnippet, runInSession } from "./run-flows";
import {
  RUN_SNIPPET_ACTION,
  RunSnippetEditor,
  RunSnippetSummary,
  runSnippetBinding,
  validateRunSnippet,
} from "./keybinding";

function hostContext(host: unknown): SnippetHostContext | null {
  if (!host || typeof host !== "object") return null;
  const record = host as Record<string, unknown>;
  return {
    ip: typeof record.ip === "string" ? record.ip : undefined,
    username: typeof record.username === "string" ? record.username : undefined,
    port:
      typeof record.port === "number" || typeof record.port === "string"
        ? record.port
        : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
  };
}

export function activate(app: TermixApp): void {
  app.onDispose(resetPrompts);

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

  // Every snippet in the command palette, run in the terminal the user is
  // working in.
  app.registerPaletteGroup({
    id: "snippets",
    titleKey: "nav.snippets",
    order: 10,
    load: async (): Promise<PaletteItem[]> => {
      if (!(await app.hasPermission("view"))) return [];
      const snippets: Snippet[] = await createSnippetsApi(app.api)
        .list()
        .catch(() => []);
      return snippets.map((snippet) => ({
        id: String(snippet.id),
        title: snippet.name,
        description: snippet.content,
        icon: snippet.isNote ? Clipboard : Play,
        keywords: [snippet.description ?? ""],
        needsTarget: true,
        hint: app.t(snippet.isNote ? "paletteHintPaste" : "paletteHintRun"),
        run: ({ targetTab }) => {
          if (!targetTab) return;
          void runInSession(
            app,
            snippet,
            { sessionId: targetTab.id },
            hostContext(targetTab.host),
            { announce: true },
          );
        },
      }));
    },
  });

  // Keeps the input dialog and the confirm setting alive at the shell root.
  app.registerSlotContribution("shell.overlay", {
    actionId: "snippets.overlay",
    titleKey: "nav.snippets",
    kind: "component",
    component: SnippetOverlay as never,
  });

  app.registerKeybindingAction({
    id: RUN_SNIPPET_ACTION,
    titleKey: "keybindings.runSnippet",
    editor: RunSnippetEditor,
    summary: RunSnippetSummary,
    validate: validateRunSnippet,
    run: (action, context) => runSnippetBinding(app, action, context),
  });

  app.registerHostEditorSection({
    id: "snippets",
    group: "ssh",
    titleKey: "host.tabTitle",
    icon: Play,
    order: 15,
    component: HostSnippetsSection,
  });

  // Host Metrics shows a host's quick actions as toolbar buttons.
  app.registerSlotContribution("host-metrics.toolbar", {
    actionId: "snippets.quickActions",
    titleKey: "host.quickActionsTitle",
    kind: "component",
    component: QuickActionButtons,
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

  // The command a terminal types when it connects to a host: the host's
  // startup snippet with its variables filled in, or null.
  app.registerAction("snippets.startupCommand", (async (
    host: PluginHostRecord | null,
    vars?: SnippetHostContext,
  ) => {
    const id = readStartupSnippetId(snippetHostSettings(host).startupSnippetId);
    if (id === null) return null;
    const snippet = await fetchSnippet(app, id);
    if (!snippet) return null;
    return resolveSnippetContent(snippet.content, vars ?? hostContext(host));
  }) as never);

  // For pickers in other plugins (the AI assistant's @-mentions): id and name.
  app.registerAction("snippets.list", (async () => {
    const snippets = await createSnippetsApi(app.api)
      .list()
      .catch(() => []);
    return snippets.map((snippet) => ({ id: snippet.id, name: snippet.name }));
  }) as never);

  // Variable handling for commands other plugins run (fleets' run box).
  app.registerAction("snippets.extractInputs", ((content: string) =>
    extractSnippetInputs(typeof content === "string" ? content : "")) as never);
}
