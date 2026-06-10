import React from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "@/features/terminal/Terminal.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";

interface TerminalAppProps {
  hostId?: string;
  /** tmux session to attach to once the shell is ready (tmux monitor "Attach"). */
  tmuxSession?: string;
}

// Only the session name travels in the URL (never a raw command), so a crafted
// link cannot execute arbitrary input. `=` forces exact-name matching in tmux.
function tmuxAttachCommand(session: string): string {
  return `tmux attach-session -t '=${session.replace(/'/g, "'\\''")}'`;
}

const TerminalApp: React.FC<TerminalAppProps> = ({ hostId, tmuxSession }) => {
  const { t } = useTranslation();
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                <p className="text-muted-foreground">
                  {t("hosts.loadingHost")}
                </p>
              </div>
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-red-500 mb-4">{t("hosts.hostNotFound")}</p>
              </div>
            </div>
          );
        }

        return (
          <Terminal
            hostConfig={hostConfig}
            isVisible={true}
            title={hostConfig.name || `${hostConfig.username}@${hostConfig.ip}`}
            showTitle={false}
            splitScreen={false}
            onClose={() => {}}
            executeCommand={
              tmuxSession ? tmuxAttachCommand(tmuxSession) : undefined
            }
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

export default TerminalApp;
