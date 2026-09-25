import { FolderSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHost } from "@termix/plugin-sdk/frontend";
import { WidgetTitle } from "@termix/plugin-sdk/ui";
import type {
  FileManagerWidgetConfig,
  WidgetComponentProps,
} from "./homepage.js";
import type { SSHHost } from "../host-types";
import { FileManager } from "../FileManager";

export function FileManagerWidget({
  widget,
  config,
}: WidgetComponentProps<FileManagerWidgetConfig>) {
  const { t } = useTranslation();
  const host = useHost(config.hostId || undefined);

  if (!config.hostId) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/60">
        <FolderSearch size={20} />
        <span className="text-xs">{t("common.noHostConfigured")}</span>
      </div>
    );
  }

  if (!host) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/60">
        {t("common.noHostConfigured")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<FolderSearch size={11} />} />
      <div
        className="flex-1 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <FileManager initialHost={host as unknown as SSHHost} />
      </div>
    </div>
  );
}
