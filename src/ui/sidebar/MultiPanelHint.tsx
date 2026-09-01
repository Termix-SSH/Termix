import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PanelRight, SquareArrowOutUpRight, X } from "lucide-react";

const STORAGE_KEY = "termix_multiPanelHintDismissed";

function multiPanelHintDismissed(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

/**
 * One-time nudge telling users a panel can leave the sidebar. Both actions are
 * otherwise only reachable through modifier clicks and the rail context menu,
 * which nobody finds on their own.
 */
export function MultiPanelHint({
  canPromote,
  canRightDock,
  onOpenAsTab,
  onOpenInRightDock,
}: {
  canPromote: boolean;
  canRightDock: boolean;
  onOpenAsTab: () => void;
  onOpenInRightDock: () => void;
}) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(multiPanelHintDismissed);

  if (dismissed || (!canPromote && !canRightDock)) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="relative shrink-0 border-b border-border bg-accent-brand/5 px-3 py-2.5">
      <button
        onClick={dismiss}
        title={t("common.dismiss")}
        aria-label={t("common.dismiss")}
        className="absolute right-1.5 top-1.5 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
      <p className="pr-5 text-xs font-semibold text-foreground">
        {t("nav.multiPanelHintTitle")}
      </p>
      <p className="mt-0.5 pr-5 text-[11px] leading-snug text-muted-foreground">
        {t("nav.multiPanelHintBody")}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {canPromote && (
          <div className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <SquareArrowOutUpRight className="mt-0.5 size-3 shrink-0 text-accent-brand" />
            <span>
              <button
                onClick={() => {
                  dismiss();
                  onOpenAsTab();
                }}
                className="font-medium text-foreground underline underline-offset-2 hover:text-accent-brand"
              >
                {t("nav.openAsTab")}
              </button>
              {": "}
              {t("nav.multiPanelHintTabHow")}
            </span>
          </div>
        )}
        {canRightDock && (
          <div className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <PanelRight className="mt-0.5 size-3 shrink-0 text-accent-brand" />
            <span>
              <button
                onClick={() => {
                  dismiss();
                  onOpenInRightDock();
                }}
                className="font-medium text-foreground underline underline-offset-2 hover:text-accent-brand"
              >
                {t("nav.openInRightDock")}
              </button>
              {": "}
              {t("nav.multiPanelHintDockHow")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
