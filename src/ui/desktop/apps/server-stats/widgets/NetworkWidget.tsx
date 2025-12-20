import React from "react";
import { Network, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";

interface NetworkWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function NetworkWidget({ metrics }: NetworkWidgetProps) {
  const { t } = useTranslation();

  const metricsWithNetwork = metrics as ServerMetrics & {
    network?: {
      interfaces?: Array<{
        name: string;
        state: string;
        ip: string;
      }>;
    };
  };
  const network = metricsWithNetwork?.network;
  const interfaces = network?.interfaces || [];

  return (
    <div className="h-full w-full p-4 rounded-lg bg-dark-bg-darker border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <Network className="h-5 w-5 text-indigo-400" />
        <h3 className="font-semibold text-lg text-white">
          {t("serverStats.networkInterfaces")}
        </h3>
      </div>

      <div className="space-y-2.5 overflow-auto flex-1">
        {interfaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <WifiOff className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm">{t("serverStats.noInterfacesFound")}</p>
          </div>
        ) : (
          interfaces.map((iface, index: number) => (
            <div
              key={index}
              className="p-3 rounded-lg bg-dark-bg/50 border border-dark-border/30 hover:bg-dark-bg/60 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wifi
                    className={`h-4 w-4 ${iface.state === "UP" ? "text-green-400" : "text-gray-500"}`}
                  />
                  <span className="text-sm font-semibold text-white font-mono">
                    {iface.name}
                  </span>
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    iface.state === "UP"
                      ? "bg-green-500/20 text-green-400"
                      : "bg-gray-500/20 text-gray-500"
                  }`}
                >
                  {iface.state}
                </span>
              </div>
              <div className="text-xs text-gray-400 font-mono font-medium">
                {iface.ip}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
