import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  useSettings,
  useTabs,
  useTranslation,
} from "@termix/plugin-sdk/frontend";
import { shouldPopUp, type PopupLevel } from "./popups";
import type { AlertsStore } from "./store";

/** Pops up alerts as they arrive, as far as the user's setting allows. */
export function AlertToaster({
  store,
  viewId,
}: {
  store: AlertsStore;
  viewId: string;
}) {
  const { t } = useTranslation();
  const tabs = useTabs();
  const { values } = useSettings("user");
  const level = useRef<PopupLevel>("warning");
  level.current = (values.popups as PopupLevel | undefined) ?? "warning";

  useEffect(
    () =>
      store.onItem((item, isNew) => {
        if (!isNew || !shouldPopUp(item, level.current)) return;
        const show =
          item.severity === "critical"
            ? toast.error
            : item.severity === "warning"
              ? toast.warning
              : item.severity === "success"
                ? toast.success
                : toast.info;
        show(item.title, {
          description: item.body ? item.body.slice(0, 200) : undefined,
          action: {
            label: t("inbox.view"),
            onClick: () => tabs.openRailView(viewId),
          },
        });
      }),
    [store, t, tabs, viewId],
  );

  return null;
}
