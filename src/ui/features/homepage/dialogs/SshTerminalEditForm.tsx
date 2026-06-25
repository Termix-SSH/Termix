import { useTranslation } from "react-i18next";
import type {
  SshTerminalConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { SingleHostEditForm } from "./SingleHostEditForm";

export function SshTerminalEditForm({
  config,
  onChange,
}: WidgetEditFormProps<SshTerminalConfig>) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <SingleHostEditForm
        hostId={config.hostId}
        onChange={(hostId) => onChange({ ...config, hostId })}
        filter={(h) => !!(h.enableSsh && h.enableTerminal)}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.autoConnect}
          onChange={(e) =>
            onChange({ ...config, autoConnect: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.sshTerminalAutoConnect")}
      </label>
    </div>
  );
}
