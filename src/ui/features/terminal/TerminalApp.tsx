import React from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "@/features/terminal/Terminal.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";

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
      {(hostConfig, phase) => {
        if (phase === "loading") {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="connecting"
                message={t("hosts.loadingHost")}
              />
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="relative h-full w-full">
              <ConnectionScreen
                status="disconnected"
                message={t("hosts.hostNotFound")}
              />
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
