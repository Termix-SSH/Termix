import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Loader2, Server } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@termix/plugin-sdk/ui";

export interface HostExecutionResult {
  hostId: number;
  hostLabel: string;
  /** Null while the command is still running on this host. */
  success: boolean | null;
  output: string;
  error?: string;
}

export function ExecutionResultsDialog({
  snippetName,
  results,
  onClose,
}: {
  snippetName: string;
  results: HostExecutionResult[];
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("executionResultTitle", { name: snippetName })}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("executionResultDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col border border-border max-h-96 overflow-y-auto">
          {results.map((result) => (
            <div
              key={result.hostId}
              className="flex flex-col gap-1.5 p-2.5 border-b border-border/40 last:border-b-0"
            >
              <div className="flex items-center gap-2">
                <Server className="size-3 shrink-0 text-muted-foreground" />
                <span className="text-xs font-semibold truncate flex-1">
                  {result.hostLabel}
                </span>
                {result.success === null ? (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <span
                    className={`text-[9px] px-1 py-px border uppercase tracking-wider shrink-0 ${
                      result.success
                        ? "border-green-500/30 bg-green-500/10 text-green-500"
                        : "border-destructive/30 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {t(result.success ? "executionSuccess" : "executionFailed")}
                  </span>
                )}
              </div>
              {(result.output || result.error) && (
                <pre className="text-[11px] bg-muted/30 p-2 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground max-h-40">
                  {result.error || result.output}
                </pre>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
