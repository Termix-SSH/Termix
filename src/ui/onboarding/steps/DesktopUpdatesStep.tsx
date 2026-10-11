import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, Download, PauseCircle } from "lucide-react";
import {
  desktopUpdates,
  useDesktopUpdate,
  type DesktopUpdateMode,
} from "@/lib/desktop-updates";

/**
 * Desktop only: how the app updates itself. Can be changed later in
 * Settings, Updates.
 */
export function DesktopUpdatesStep() {
  const { t } = useTranslation();
  const state = useDesktopUpdate();
  const [picked, setPicked] = useState<DesktopUpdateMode | null>(null);
  const mode = picked ?? state?.mode ?? "prompt";

  const choose = (next: DesktopUpdateMode) => {
    setPicked(next);
    void desktopUpdates()
      ?.setMode(next)
      .catch(() => {});
  };

  const options = [
    {
      id: "automatic" as const,
      icon: Download,
      title: t("desktopUpdates.modeAutomatic"),
      body: t("desktopUpdates.automaticBody"),
    },
    {
      id: "prompt" as const,
      icon: BellRing,
      title: t("desktopUpdates.modePrompt"),
      body: t("desktopUpdates.promptBody"),
    },
    {
      id: "never" as const,
      icon: PauseCircle,
      title: t("desktopUpdates.modeNever"),
      body: t("desktopUpdates.neverBody"),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {state?.kind === "manual"
          ? t("desktopUpdates.onboardingManual")
          : t("desktopUpdates.onboardingBody")}
      </p>
      <div className="flex flex-col gap-1.5">
        {options.map(({ id, icon: Icon, title, body }) => (
          <button
            key={id}
            type="button"
            onClick={() => choose(id)}
            className={`flex items-start gap-2.5 border p-2.5 text-left transition-colors ${
              mode === id
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
    </div>
  );
}
