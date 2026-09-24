import { Play } from "lucide-react";
import type { PanelProps, TermixApp } from "@termix/plugin-sdk/frontend";
import { SnippetsPanel } from "./SnippetsPanel";
import { createSnippetsApi } from "./snippets-api";
import { resolveSnippetContent, hasSnippetInputs } from "./snippet-variables";

export function activate(app: TermixApp): void {
  app.registerRailItem({
    id: "snippets",
    icon: Play,
    titleKey: "nav.snippets",
    permission: "view",
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

  // Resolves a snippet by id for core's terminal (startup snippet, custom
  // keybindings), so core never imports snippet code or data directly.
  app.registerAction("snippets.resolveForTerminal", (async (
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
  }) as never);

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
