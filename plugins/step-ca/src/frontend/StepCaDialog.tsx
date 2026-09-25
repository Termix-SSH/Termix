import { Shield, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button } from "@termix/plugin-sdk/ui";

export type SignInStage = "chooser" | "waiting" | "authenticating" | "error";

interface StepCaDialogProps {
  stage: SignInStage;
  error?: string;
  onCancel: () => void;
  onOpenUrl: () => void;
  backgroundColor?: string;
}

const actionButton =
  "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest w-full flex items-center gap-2";
const footerButton =
  "rounded-none text-[10px] font-bold uppercase tracking-widest";

/** The browser sign-in the terminal shows while Step CA waits. */
export function StepCaDialog({
  stage,
  error,
  onCancel,
  onOpenUrl,
  backgroundColor,
}: StepCaDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-card border border-border w-full max-w-md mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-accent-brand" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {t("dialog.title")}
            </h3>
          </div>
          {stage === "chooser" && (
            <p className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground mt-1">
              {t("dialog.description")}
            </p>
          )}
        </div>
        <div className="p-4 flex flex-col gap-4">
          {stage === "chooser" && (
            <Button
              type="button"
              variant="outline"
              onClick={onOpenUrl}
              className={actionButton}
            >
              <ExternalLink className="size-3.5" />
              {t("dialog.openBrowser")}
            </Button>
          )}

          {(stage === "waiting" || stage === "authenticating") && (
            <div className="flex items-center gap-3 py-2">
              <Loader2 className="size-4 animate-spin text-accent-brand shrink-0" />
              <p className="text-xs text-muted-foreground">
                {stage === "waiting"
                  ? t("dialog.waiting")
                  : t("dialog.authenticating")}
              </p>
            </div>
          )}

          {stage === "error" && error && (
            <div className="flex items-start gap-3 p-3 border border-destructive/20 bg-destructive/10">
              <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">
                  {t("common.error")}
                </p>
                <p className="text-xs text-destructive/90 mt-1 whitespace-pre-wrap break-words">
                  {error}
                </p>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className={footerButton}
            >
              {stage === "error" ? t("common.close") : t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
