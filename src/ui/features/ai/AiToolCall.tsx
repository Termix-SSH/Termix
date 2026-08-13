import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import type { ToolActivity } from "./use-ai-stream";
import { toolLabel } from "./labels";

/**
 * Every tool call is shown, so the user can always see what the assistant
 * looked at rather than having to trust the summary.
 */
export function AiToolCall({
  tool,
  streaming = false,
}: {
  tool: ToolActivity;
  /** False once the turn has ended, whatever ended it. */
  streaming?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // A tool can only still be running while the turn is. An aborted or failed
  // stream leaves calls without results, and treating those as pending left a
  // spinner running forever after the conversation had finished.
  const pending = !("result" in tool) && streaming;

  return (
    <div className="rounded-none border border-border bg-muted/50 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {pending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Wrench size={12} />
        )}
        <span className="truncate">{toolLabel(tool.name)}</span>
        {pending && (
          <span className="text-muted-foreground">{t("ai.running")}</span>
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-2 py-2">
          {/* The header reads as an action, so the actual tool id lives here. */}
          <div className="font-mono text-[10px] text-muted-foreground">
            {tool.name}
          </div>
          {Object.keys(tool.arguments).length > 0 && (
            <div>
              <div className="mb-1 text-muted-foreground">
                {t("ai.toolArguments")}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(tool.arguments, null, 2)}
              </pre>
            </div>
          )}
          {/*
            Gated on the result existing, not on !pending: an interrupted turn
            leaves a call with no result at all, which would otherwise print
            "undefined" under a Result heading.
          */}
          {"result" in tool && (
            <div>
              <div className="mb-1 text-muted-foreground">
                {t("ai.toolResult")}
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono">
                {JSON.stringify(tool.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
