import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useLookState } from "@/look/look-store";

const TOAST_ID = "safe-mode";

/** Tells everyone the server runs in safe mode, until they close it. */
export function SafeModeNotice() {
  const { t } = useTranslation();
  const safeMode = useLookState().response?.safeMode === true;

  useEffect(() => {
    if (!safeMode) return;
    toast.warning(t("safeMode.title"), {
      id: TOAST_ID,
      description: t("safeMode.description"),
      duration: Infinity,
      closeButton: true,
    });
  }, [safeMode, t]);

  return null;
}
