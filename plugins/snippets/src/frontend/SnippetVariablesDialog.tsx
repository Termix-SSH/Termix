import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@termix/plugin-sdk/ui";
import {
  extractSnippetInputs,
  resolveSnippetContent,
  type SnippetHostContext,
} from "../shared/variables.js";

/** Enough of a snippet to fill in its inputs. */
export interface VariablesDialogSnippet {
  name: string;
  content: string;
}

/**
 * Shown before running a snippet that contains $INPUT_n placeholders:
 * collects a value per placeholder and previews the fully resolved command
 * (host vars and inputs) before handing the result back to the caller.
 */
export function SnippetVariablesDialog({
  snippet,
  host,
  onCancel,
  onConfirm,
}: {
  snippet: VariablesDialogSnippet;
  host: SnippetHostContext | null;
  onCancel: () => void;
  onConfirm: (
    resolvedContent: string,
    inputValues: Record<string, string>,
  ) => void;
}) {
  const { t } = useTranslation();
  const inputs = useMemo(
    () => extractSnippetInputs(snippet.content),
    [snippet.content],
  );
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues({});
  }, [snippet]);

  const preview = resolveSnippetContent(snippet.content, host, values);

  return (
    <Dialog open onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("variablesDialogTitle", { name: snippet.name })}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("variablesDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          {inputs.map((input) => (
            <div key={input.key} className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold">{input.label}</label>
              <Input
                autoFocus={inputs[0]?.key === input.key}
                value={values[input.key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [input.key]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("variablesPreviewLabel")}
            </label>
            <span className="text-xs text-muted-foreground font-mono px-2.5 py-2 border border-border bg-muted/20 min-w-0 break-all whitespace-pre-wrap">
              {preview}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={() => onConfirm(preview, values)}
          >
            {t("variablesConfirmButton")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
