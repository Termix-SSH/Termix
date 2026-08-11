import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  hasSnippetInputs,
  resolveSnippetContent,
  type SnippetHostContext,
} from "@/lib/snippet-variables";
import { SnippetVariablesDialog } from "@/components/SnippetVariablesDialog";
import type { Snippet, Tab } from "@/types/ui-types";

/**
 * Shared "run this snippet against these terminal tabs" flow: resolves
 * $HOST-style vars per target, prompts once for $INPUT_n placeholders when
 * present, and gates on the confirm-before-running setting. Used by both the
 * Snippets sidebar panel and the command palette's snippet entries so the
 * behavior (and the dialog) is identical everywhere a snippet gets sent to a
 * terminal.
 */
export function useSnippetRunner() {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const [runningSnippet, setRunningSnippet] = useState<{
    snippet: Snippet;
    host: SnippetHostContext | null;
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

  function sendResolvedToTerminal(
    tab: Tab,
    snippet: Snippet,
    inputValues: Record<string, string>,
  ) {
    const content = resolveSnippetContent(
      snippet.content,
      tab.host ?? null,
      inputValues,
    );
    if (snippet.isNote) {
      tab.terminalRef?.current?.paste?.(content);
    } else {
      tab.terminalRef?.current?.sendInput?.(content + "\r");
    }
  }

  const runSnippet = useCallback(
    (snippet: Snippet, targets: Tab[]) => {
      const runWithInputs = (inputValues: Record<string, string>) => {
        const doSend = () => {
          targets.forEach((tab) =>
            sendResolvedToTerminal(tab, snippet, inputValues),
          );
          toast.success(
            t(
              snippet.isNote
                ? "newUi.sidebar.snippets.pasteSuccess"
                : "newUi.sidebar.snippets.runSuccess",
              { name: snippet.name, count: targets.length },
            ),
          );
        };
        if (snippet.isNote) {
          doSend();
        } else {
          handleConfirmRun(snippet, doSend);
        }
      };

      if (hasSnippetInputs(snippet.content)) {
        setRunningSnippet({
          snippet,
          host: targets[0]?.host ?? null,
          onConfirm: (_resolvedContent, inputValues) => {
            setRunningSnippet(null);
            runWithInputs(inputValues);
          },
        });
      } else {
        runWithInputs({});
      }
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
