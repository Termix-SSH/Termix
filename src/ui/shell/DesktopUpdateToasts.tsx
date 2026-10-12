import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  desktopUpdates,
  updateToastFor,
  useDesktopUpdate,
} from "@/lib/desktop-updates";

const TOAST_ID = "desktop-update";
const LATER_KEY = "termix-desktop-update-later";

function readLater(): string | null {
  try {
    return localStorage.getItem(LATER_KEY);
  } catch {
    return null;
  }
}

function saveLater(value: string) {
  try {
    localStorage.setItem(LATER_KEY, value);
  } catch {
    // Only means the toast comes back next launch.
  }
}

/** Desktop only: tells the user about a new version and installs it. */
export function DesktopUpdateToasts() {
  const { t } = useTranslation();
  const state = useDesktopUpdate();
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const kind = updateToastFor(state);
    if (!state || !kind) return;
    const key = `${kind}:${state.version}`;
    if (shown.current === key || readLater() === key) return;
    shown.current = key;

    const version = state.version;
    const later = {
      label: t("desktopUpdates.later"),
      onClick: () => saveLater(key),
    };

    if (kind === "ready") {
      toast(t("desktopUpdates.ready", { version }), {
        id: TOAST_ID,
        duration: Infinity,
        description: t("desktopUpdates.readyHint"),
        action: {
          label: t("desktopUpdates.restart"),
          onClick: () => void desktopUpdates()?.install(),
        },
        cancel: later,
      });
    } else if (kind === "prompt") {
      toast(t("desktopUpdates.available", { version }), {
        id: TOAST_ID,
        duration: Infinity,
        action: {
          label: t("desktopUpdates.download"),
          onClick: () => void desktopUpdates()?.download(),
        },
        cancel: later,
      });
    } else {
      const url = state.releaseUrl;
      toast(t("desktopUpdates.available", { version }), {
        id: TOAST_ID,
        duration: Infinity,
        description: t("desktopUpdates.manualHint"),
        action: {
          label: t("desktopUpdates.download"),
          onClick: () => {
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          },
        },
        cancel: later,
      });
    }
  }, [state, t]);

  return null;
}
