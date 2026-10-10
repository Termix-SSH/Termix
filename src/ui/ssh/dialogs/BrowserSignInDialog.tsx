import { useState } from "react";
import { Input } from "@/components/input.tsx";
import { PanePrompt } from "@/components/surface/surface-scope";
import {
  PROMPT_BUTTON,
  PROMPT_PRIMARY_BUTTON,
} from "@/components/surface/prompt-styles";
import { Shield, Copy, ExternalLink, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

interface BrowserSignInDialogProps {
  isOpen: boolean;
  /** Who is asking, e.g. the product name of an SSH gateway. */
  label: string;
  url: string;
  /** A code to compare in the browser; "N/A" or empty hides it. */
  code: string;
  onContinue: () => void;
  onCancel: () => void;
  onOpenUrl: () => void;
  backgroundColor?: string;
}

/**
 * A keyboard-interactive round finished in a browser: open the URL, compare
 * the code there, then continue.
 */
export function BrowserSignInDialog({
  isOpen,
  label,
  url,
  code,
  onContinue,
  onCancel,
  onOpenUrl,
  backgroundColor,
}: BrowserSignInDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyUrl = async () => {
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t("common.copyFailed"));
    }
  };

  return (
    <PanePrompt
      open
      layer="connection"
      backgroundColor={backgroundColor}
      icon={<Shield className="size-4" />}
      title={t("sshAuth.browserSignInRequired", { provider: label })}
      className="max-w-md"
    >
      <div className="flex flex-col gap-3">
        {code && code !== "N/A" && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("sshAuth.browserSignInCode")}
            </p>
            <div className="border border-border bg-muted/10 p-4 text-center">
              <div className="text-2xl font-mono font-bold tracking-wider text-accent-brand">
                {code}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("sshAuth.browserSignInUrl")}
          </p>
          <div className="flex gap-2">
            <Input
              type="text"
              value={url}
              readOnly
              className="rounded-none bg-muted/50 border-border text-xs font-mono flex-1"
            />
            <button
              type="button"
              onClick={handleCopyUrl}
              className={`${PROMPT_BUTTON} h-9 w-9 shrink-0 px-0`}
              title={t("common.copy")}
              aria-label={t("common.copy")}
            >
              {copied ? (
                <Check className="size-4 text-accent-brand" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={`${PROMPT_BUTTON} sm:mr-auto`}
          >
            {t("common.cancel")}
          </button>
          <button type="button" onClick={onContinue} className={PROMPT_BUTTON}>
            {t("sshAuth.browserSignInContinue")}
          </button>
          <button
            type="button"
            onClick={onOpenUrl}
            className={PROMPT_PRIMARY_BUTTON}
          >
            <ExternalLink className="size-3.5" />
            {t("sshAuth.browserSignInOpen")}
          </button>
        </div>
      </div>
    </PanePrompt>
  );
}
