import React, { useState, useEffect } from "react";
import { GuacamoleDisplay } from "@/ui/desktop/apps/features/guacamole/GuacamoleDisplay.tsx";
import { FullScreenAppWrapper } from "@/ui/desktop/apps/FullScreenAppWrapper.tsx";
import { getGuacamoleTokenFromHost } from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import type { SSHHost } from "@/types";

interface GuacamoleAppProps {
  hostId?: string;
}

const GuacamoleApp: React.FC<GuacamoleAppProps> = ({ hostId }) => {
  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                <p className="text-muted-foreground">Loading host...</p>
              </div>
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-red-500 mb-4">Host not found</p>
              </div>
            </div>
          );
        }

        return (
          <GuacamoleAppInner
            hostId={parseInt(hostId!, 10)}
            hostConfig={hostConfig}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

interface GuacamoleAppInnerProps {
  hostId: number;
  hostConfig: Pick<SSHHost, "connectionType">;
}

const GuacamoleAppInner: React.FC<GuacamoleAppInnerProps> = ({
  hostId,
  hostConfig,
}) => {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGuacamoleTokenFromHost(hostId)
      .then((result) => setToken(result.token))
      .catch((err) => setError(err?.message || t("guacamole.failedToConnect")));
  }, [hostId]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
          <p className="text-muted-foreground">
            {t("guacamole.connecting", {
              type: (hostConfig.connectionType || "remote").toUpperCase(),
            })}
          </p>
        </div>
      </div>
    );
  }

  const protocol = hostConfig.connectionType as "rdp" | "vnc" | "telnet";

  return (
    <div className="relative w-full h-full">
      <GuacamoleDisplay
        connectionConfig={{ token, protocol, type: protocol }}
        isVisible={true}
      />
    </div>
  );
};

export default GuacamoleApp;
