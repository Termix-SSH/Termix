import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Cloud, Laptop } from "lucide-react";
import { LinkServerDialog } from "@/settings/sync/LinkServerDialog";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { setSyncStatus } from "@/lib/sync-status";
import { notifySyncChanged } from "@/lib/linked-server";

/**
 * Desktop only: use Termix on this device alone, or link it to a server.
 * Either choice can be changed later from Sync.
 */
export function DesktopSyncStep() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const [linkOpen, setLinkOpen] = useState(false);
  const linked = !!status?.linked;

  const options = [
    {
      id: "local",
      icon: Laptop,
      title: t("onboarding.desktopLocalTitle"),
      body: t("onboarding.desktopLocalBody"),
      selected: !linked,
      onClick: () => {},
    },
    {
      id: "link",
      icon: Cloud,
      title: t("onboarding.desktopLinkTitle"),
      body: linked
        ? t("onboarding.desktopLinked", {
            server: status?.serverName || status?.serverUrl,
          })
        : t("onboarding.desktopLinkBody"),
      selected: linked,
      onClick: () => !linked && setLinkOpen(true),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.desktopBody")}
      </p>
      <div className="flex flex-col gap-1.5">
        {options.map(({ id, icon: Icon, title, body, selected, onClick }) => (
          <button
            key={id}
            type="button"
            onClick={onClick}
            className={`flex items-start gap-2.5 border p-2.5 text-left transition-colors ${
              selected
                ? "border-accent-brand bg-accent-brand/10"
                : "border-border bg-card hover:bg-muted/40"
            }`}
          >
            <Icon size={14} className="mt-0.5 shrink-0 text-accent-brand" />
            <span className="flex flex-col gap-1">
              <span className="text-xs font-medium">{title}</span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {body}
              </span>
            </span>
          </button>
        ))}
      </div>
      <LinkServerDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onLinked={(next) => {
          setSyncStatus(next);
          notifySyncChanged();
        }}
      />
    </div>
  );
}
