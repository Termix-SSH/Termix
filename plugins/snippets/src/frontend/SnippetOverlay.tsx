import { useEffect } from "react";
import { useSettings } from "@termix/plugin-sdk/frontend";
import { SnippetVariablesDialog } from "./SnippetVariablesDialog";
import { readSnippetSettings } from "./settings";
import { setConfirmExecution, usePendingPrompt } from "./prompt-store";

/**
 * Always mounted at the shell's root (the shell.overlay slot), so a snippet
 * started from the command palette, a keybinding or a host button can ask
 * for its inputs after whatever started it has closed.
 */
export function SnippetOverlay() {
  const settings = useSettings("user");
  const prompt = usePendingPrompt();
  const confirmExecution = readSnippetSettings(
    settings.values,
  ).confirmExecution;

  useEffect(() => {
    setConfirmExecution(confirmExecution);
  }, [confirmExecution]);

  if (!prompt) return null;
  return (
    <SnippetVariablesDialog
      snippet={prompt.snippet}
      host={prompt.host}
      onCancel={() => prompt.settle(null)}
      onConfirm={(_resolved, values) => prompt.settle(values)}
    />
  );
}
