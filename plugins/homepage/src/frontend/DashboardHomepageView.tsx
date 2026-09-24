import { useState } from "react";
import { Check, ExternalLink, Link } from "lucide-react";
import { useTranslation, type ShellApi } from "@termix/plugin-sdk/frontend";
import { HomepageCanvas } from "./HomepageCanvas.js";

/** The homepage plugin's contribution to the dashboard's "dashboard.secondaryView" slot. */
export function DashboardHomepageView({
  onOpenSingletonTab,
}: {
  onOpenSingletonTab: ShellApi["openSingletonTab"];
}) {
  const { t } = useTranslation();
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard
      .writeText(`${window.location.origin}?view=homepage`)
      .catch(() => {});
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  };

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0 bg-muted/20">
        <span className="text-[10px] text-muted-foreground/50 uppercase tracking-widest font-semibold">
          {t("nav.homepage")}
        </span>
        <div className="flex items-center gap-3">
          <button
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            onClick={handleCopyLink}
          >
            {linkCopied ? (
              <>
                <Check size={10} className="text-accent-brand" />
                <span className="text-accent-brand">
                  {t("homepage.linkCopied")}
                </span>
              </>
            ) : (
              <>
                <Link size={10} />
                {t("homepage.copyLink")}
              </>
            )}
          </button>
          <button
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            onClick={() => onOpenSingletonTab("homepage")}
          >
            <ExternalLink size={10} />
            {t("homepage.openFullView")}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <HomepageCanvas />
      </div>
    </>
  );
}
