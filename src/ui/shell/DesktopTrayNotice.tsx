import { useEffect } from "react";
import { useTranslation } from "react-i18next";

type TrayNoticeBridge = {
  setTrayNoticeText?: (text: { title: string; body: string }) => void;
};

/**
 * Desktop only: hands the main process the translated text it shows the
 * first time closing the window leaves the app in the tray.
 */
export function DesktopTrayNotice() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    const bridge = window.electronAPI as TrayNoticeBridge | undefined;
    bridge?.setTrayNoticeText?.({
      title: t("desktopTray.noticeTitle"),
      body: t("desktopTray.noticeBody"),
    });
  }, [t, i18n.language]);

  return null;
}
