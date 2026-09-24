import { Circle } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";

/** What ssh-terminal hands a "terminal.toolbarStatus" component. */
interface TerminalToolbarStatusProps {
  host?: { pluginSettings?: Record<string, Record<string, unknown>> };
  isConnected?: boolean;
}

export function RecordingStatus(props: Record<string, unknown>) {
  const { isConnected } = props as TerminalToolbarStatusProps;
  const { t } = useTranslation();
  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-1 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Circle className="size-2 fill-red-500 text-red-500" />
      {t("terminalStatus.recording")}
    </div>
  );
}
