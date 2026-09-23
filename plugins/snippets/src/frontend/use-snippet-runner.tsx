import { useCallback, useState } from "react";
import { useTranslation, invokeAction } from "@termix/plugin-sdk/frontend";
import { toast } from "sonner";
import { SnippetVariablesDialog } from "@termix/plugin-sdk/ui";
import {
  hasSnippetInputs,
  resolveSnippetContent,
  type SnippetHostContext,
} from "./snippet-variables";
import type { Snippet } from "./types";

export interface RunTarget {
  sessionId: string;
  host: SnippetHostContext | null;
}

/**
 * Shared "run this snippet against these terminal sessions" flow: resolves
 * $HOST-style vars per target, prompts once for $INPUT_n placeholders when
 * present, and gates on the confirm-before-running setting. Sends through
 * the ssh-terminal plugin's terminal.sendToActive/sendToSession actions
 * rather than touching a terminal ref directly, since core's tab state is
 * not part of the plugin surface.
 */
export function useSnippetRunner() {
  const { t } = useTranslation();
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
      toast(t("confirmRunMessage", { name: snippet.name }), {
        action: {
          label: t("confirmRunButton"),
          onClick: execute,
        },
        duration: 6000,
      });
    },
    [t],
  );

  async function sendResolvedToTarget(
    target: RunTarget,
    snippet: Snippet,
    inputValues: Record<string, string>,
  ) {
    const content = resolveSnippetContent(
      snippet.content,
      target.host,
      inputValues,
    );
    const run = !snippet.isNote;
    await invokeAction("terminal.sendToSession", target.sessionId, content, {
      run,
    });
  }

  const runSnippet = useCallback(
    (snippet: Snippet, targets: RunTarget[]) => {
      const runWithInputs = (inputValues: Record<string, string>) => {
        const doSend = () => {
          Promise.all(
            targets.map((target) =>
              sendResolvedToTarget(target, snippet, inputValues),
            ),
          )
            .then(() => {
              toast.success(
                t(snippet.isNote ? "pasteSuccess" : "runSuccess", {
                  name: snippet.name,
                  count: targets.length,
                }),
              );
            })
            .catch(() => {});
        };
        if (snippet.isNote) doSend();
        else handleConfirmRun(snippet, doSend);
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

  const runOnActive = useCallback(
    (snippet: Snippet, host: SnippetHostContext | null) => {
      const runWithInputs = (inputValues: Record<string, string>) => {
        const doSend = () => {
          const content = resolveSnippetContent(
            snippet.content,
            host,
            inputValues,
          );
          void invokeAction("terminal.sendToActive", content, {
            run: !snippet.isNote,
          }).then((sent) => {
            if (sent === false) {
              toast.error(t("noTerminalTabsOpen"));
              return;
            }
            toast.success(
              t(snippet.isNote ? "pasteSuccess" : "runSuccess", {
                name: snippet.name,
                count: 1,
              }),
            );
          });
        };
        if (snippet.isNote) doSend();
        else handleConfirmRun(snippet, doSend);
      };

      if (hasSnippetInputs(snippet.content)) {
        setRunningSnippet({
          snippet,
          host,
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
      snippet={runningSnippet.snippet as never}
      host={runningSnippet.host}
      onCancel={() => setRunningSnippet(null)}
      onConfirm={runningSnippet.onConfirm}
    />
  ) : null;

  return { runSnippet, runOnActive, handleConfirmRun, dialog };
}
