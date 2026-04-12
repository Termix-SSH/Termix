import { Button } from "@/components/ui/button.tsx";
import { Terminal, Monitor, Users, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TmuxSessionInfo {
  name: string;
  created: number;
  lastActivity: number;
  windows: number;
  attachedClients: number;
}

interface TmuxSessionPickerProps {
  isOpen: boolean;
  sessions: TmuxSessionInfo[];
  onSelect: (sessionName: string) => void;
  onCreateNew: () => void;
  onCancel: () => void;
  backgroundColor?: string;
}

function formatTimestamp(
  unix: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!unix) return "---";
  const date = new Date(unix * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMin < 1) return t("terminal.tmuxTimeJustNow");
  if (diffMin < 60) return t("terminal.tmuxTimeMinutes", { count: diffMin });
  if (diffHr < 24) return t("terminal.tmuxTimeHours", { count: diffHr });
  if (diffDays < 7) return t("terminal.tmuxTimeDays", { count: diffDays });
  return date.toLocaleDateString();
}

export function TmuxSessionPicker({
  isOpen,
  sessions,
  onSelect,
  onCreateNew,
  onCancel,
  backgroundColor,
}: TmuxSessionPickerProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-canvas rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-elevated border-2 border-edge rounded-lg p-6 max-w-md w-full mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">
              {t("terminal.tmuxSessionPickerTitle")}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {t("terminal.tmuxSessionPickerDesc")}
          </p>
        </div>
        <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
          {sessions.map((session) => (
            <button
              key={session.name}
              onClick={() => onSelect(session.name)}
              className="w-full text-left px-3 py-3 rounded-md border border-edge hover:bg-muted transition-colors"
            >
              <div className="font-mono text-sm font-medium">
                {session.name}
              </div>
              <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                <span
                  className="flex items-center gap-1"
                  title={t("terminal.tmuxWindows")}
                >
                  <Monitor className="w-3 h-3" />
                  {t("terminal.tmuxWindowCount", { count: session.windows })}
                </span>
                {session.attachedClients > 0 && (
                  <span
                    className="flex items-center gap-1"
                    title={t("terminal.tmuxAttached")}
                  >
                    <Users className="w-3 h-3" />
                    {t("terminal.tmuxAttachedCount", {
                      count: session.attachedClients,
                    })}
                  </span>
                )}
                <span
                  className="flex items-center gap-1"
                  title={t("terminal.tmuxLastActivity")}
                >
                  <Clock className="w-3 h-3" />
                  {formatTimestamp(session.lastActivity, t)}
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={onCreateNew} variant="outline" className="flex-1">
            {t("terminal.tmuxCreateNew")}
          </Button>
          <Button onClick={onCancel} variant="outline" className="flex-1">
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
