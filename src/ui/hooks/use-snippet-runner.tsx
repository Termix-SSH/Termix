import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import { invokeAction } from "@/shell/action-registry";
import { SnippetVariablesDialog } from "@/components/SnippetVariablesDialog";
import type { Snippet, Tab } from "@/types/ui-types";

interface ResolvedForTerminal {
  needsInputs: boolean;
  content: string;
  isNote: boolean;
}

/**
 * Shared "run this snippet against these terminal tabs" flow, for the few
 * core surfaces (the command palette) that still reach for a snippet
 * directly rather than through the snippets plugin's own panel. Variable
 * resolution runs through the snippets plugin's "snippet.resolveForTerminal"
 * action, and sending runs through ssh-terminal's "terminal.sendToSession",
 * since core no longer owns snippet content or a terminal ref.
 */
export function useSnippetRunner() {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const [runningSnippet, setRunningSnippet] = useState<{
    snippet: Snippet;
    host: Tab["host"] | null;
    onConfirm: (
      resolvedContent: string,
      inputValues: Record<string, string>,
    ) => void;
  } | null>(null);

  const handleConfirmRun = useCallback(
    (snippet: Snippet, execute: () => void) => {
      const shouldConfirm =
        localStorage.getItem("confirmSnippetExecution") === "true";
      if (!shouldConfirm) {
        execute();
        return;
      }
      confirmWithToast(
        t("newUi.sidebar.snippets.confirmRunMessage", { name: snippet.name }),
        execute,
        t("newUi.sidebar.snippets.confirmRunButton"),
        t("newUi.sidebar.snippets.cancel"),
        { confirmOnEnter: true, duration: 6000 },
      );
    },
    [confirmWithToast, t],
  );

  async function sendResolvedToTerminal(
    tab: Tab,
    snippet: Snippet,
    inputValues: Record<string, string>,
  ) {
    const resolved = (await invokeAction(
      "snippet.resolveForTerminal",
      snippet.id,
      tab.host ?? null,
      inputValues,
    )) as ResolvedForTerminal | null | undefined;
    if (!resolved || resolved.needsInputs) return;
    await invokeAction("terminal.sendToSession", tab.id, resolved.content, {
      run: !resolved.isNote,
    });
  }

  const runSnippet = useCallback(
    (snippet: Snippet, targets: Tab[]) => {
      const runWithInputs = (inputValues: Record<string, string>) => {
        const doSend = () => {
          void Promise.all(
            targets.map((tab) =>
              sendResolvedToTerminal(tab, snippet, inputValues),
            ),
          ).then(() => {
            toast.success(
              t(
                snippet.isNote
                  ? "newUi.sidebar.snippets.pasteSuccess"
                  : "newUi.sidebar.snippets.runSuccess",
                { name: snippet.name, count: targets.length },
              ),
            );
          });
        };
        if (snippet.isNote) {
          doSend();
        } else {
          handleConfirmRun(snippet, doSend);
        }
      };

      void invokeAction(
        "snippet.resolveForTerminal",
        snippet.id,
        targets[0]?.host ?? null,
      ).then((result) => {
        const resolved = result as ResolvedForTerminal | null | undefined;
        if (resolved?.needsInputs) {
          setRunningSnippet({
            snippet,
            host: targets[0]?.host ?? null,
            onConfirm: (_resolvedContent, inputValues) => {
              setRunningSnippet(null);
              runWithInputs(inputValues);
            },
          });
          return;
        }
        runWithInputs({});
      });
    },
    [handleConfirmRun, t],
  );

  const dialog = runningSnippet ? (
    <SnippetVariablesDialog
      snippet={runningSnippet.snippet}
      host={runningSnippet.host}
      onCancel={() => setRunningSnippet(null)}
      onConfirm={runningSnippet.onConfirm}
    />
  ) : null;

  return { runSnippet, handleConfirmRun, dialog };
}
