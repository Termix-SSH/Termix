import React, { useState, useEffect } from "react";
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { getGuacamoleTokenFromHost } from "@/main-axios.ts";
import { useTranslation } from "react-i18next";
import { AlertCircle, RefreshCw } from "lucide-react";
import type { SSHHost } from "@/types";

interface GuacamoleAppProps {
  hostId?: string;
}

const GuacamoleApp: React.FC<GuacamoleAppProps> = ({ hostId }) => {
  const { t } = useTranslation();

  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="flex flex-col items-center justify-center h-full opacity-40 gap-4">
              <RefreshCw className="size-8 animate-spin" />
              <span className="text-sm font-semibold uppercase tracking-widest">
                {t("common.loading")}
              </span>
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div className="flex flex-col items-center justify-center h-full opacity-40 gap-4">
              <AlertCircle className="size-8 text-destructive" />
              <span className="text-sm font-semibold text-destructive">
                {t("guacamole.hostNotFound")}
              </span>
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
      <div className="flex flex-col items-center justify-center h-full opacity-40 gap-4">
        <AlertCircle className="size-8 text-destructive" />
        <span className="text-sm font-semibold text-destructive">{error}</span>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-40 gap-4">
        <RefreshCw className="size-8 animate-spin" />
        <span className="text-sm font-semibold uppercase tracking-widest">
          {t("guacamole.connecting", {
            type: (hostConfig.connectionType || "remote").toUpperCase(),
          })}
        </span>
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
