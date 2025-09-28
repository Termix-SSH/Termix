import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Pin,
  Network,
  Tag,
  Play,
  Square,
  AlertCircle,
  Clock,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import type {
  TunnelStatus,
  SSHTunnelObjectProps,
} from "../../../types/index.js";

export function TunnelObject({
  host,
  tunnelStatuses,
  tunnelActions,
  onTunnelAction,
  compact = false,
  bare = false,
}: SSHTunnelObjectProps): React.ReactElement {
  const { t } = useTranslation();

  const getTunnelStatus = (tunnelIndex: number): TunnelStatus | undefined => {
    const tunnel = host.tunnelConnections[tunnelIndex];
    const tunnelName = `${host.name || `${host.username}@${host.ip}`}_${tunnel.sourcePort}_${tunnel.endpointPort}`;
    return tunnelStatuses[tunnelName];
  };

  const getTunnelStatusDisplay = (status: TunnelStatus | undefined) => {
    if (!status)
      return {
        icon: <WifiOff className="h-4 w-4" />,
        text: t("tunnels.unknown"),
        color: "text-muted-foreground",
        bgColor: "bg-muted/50",
        borderColor: "border-border",
      };

    const statusValue = status.status || "DISCONNECTED";

    switch (statusValue.toUpperCase()) {
      case "CONNECTED":
        return {
          icon: <Wifi className="h-4 w-4" />,
          text: t("tunnels.connected"),
          color: "text-green-600 dark:text-green-400",
          bgColor: "bg-green-500/10 dark:bg-green-400/10",
          borderColor: "border-green-500/20 dark:border-green-400/20",
        };
      case "CONNECTING":
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          text: t("tunnels.connecting"),
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-500/10 dark:bg-blue-400/10",
          borderColor: "border-blue-500/20 dark:border-blue-400/20",
        };
      case "DISCONNECTING":
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          text: t("tunnels.disconnecting"),
          color: "text-orange-600 dark:text-orange-400",
          bgColor: "bg-orange-500/10 dark:bg-orange-400/10",
          borderColor: "border-orange-500/20 dark:border-orange-400/20",
        };
      case "DISCONNECTED":
        return {
          icon: <WifiOff className="h-4 w-4" />,
          text: t("tunnels.disconnected"),
          color: "text-muted-foreground",
          bgColor: "bg-muted/30",
          borderColor: "border-border",
        };
      case "WAITING":
        return {
          icon: <Clock className="h-4 w-4" />,
          color: "text-blue-600 dark:text-blue-400",
          bgColor: "bg-blue-500/10 dark:bg-blue-400/10",
          borderColor: "border-blue-500/20 dark:border-blue-400/20",
        };
      case "ERROR":
      case "FAILED":
        return {
          icon: <AlertCircle className="h-4 w-4" />,
          text: status.reason || t("tunnels.error"),
          color: "text-red-600 dark:text-red-400",
          bgColor: "bg-red-500/10 dark:bg-red-400/10",
          borderColor: "border-red-500/20 dark:border-red-400/20",
        };
      default:
        return {
          icon: <WifiOff className="h-4 w-4" />,
          text: statusValue,
          color: "text-muted-foreground",
          bgColor: "bg-muted/30",
          borderColor: "border-border",
        };
    }
  };

  if (bare) {
    return (
      <div className="w-full min-w-0">
        <div className="space-y-3">
          {host.tunnelConnections && host.tunnelConnections.length > 0 ? (
            <div className="space-y-3">
              {host.tunnelConnections.map((tunnel, tunnelIndex) => {
                const status = getTunnelStatus(tunnelIndex);
                const statusDisplay = getTunnelStatusDisplay(status);
                const tunnelName = `${host.name || `${host.username}@${host.ip}`}_${tunnel.sourcePort}_${tunnel.endpointPort}`;
                const isActionLoading = tunnelActions[tunnelName];
                const statusValue =
                  status?.status?.toUpperCase() || "DISCONNECTED";
                const isConnected = statusValue === "CONNECTED";
                const isConnecting = statusValue === "CONNECTING";
                const isDisconnecting = statusValue === "DISCONNECTING";
                const isRetrying = statusValue === "RETRYING";
                const isWaiting = statusValue === "WAITING";

                return (
                  <div
                    key={tunnelIndex}
                    className={`border rounded-lg p-3 min-w-0 ${statusDisplay.bgColor} ${statusDisplay.borderColor}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span
                          className={`${statusDisplay.color} mt-0.5 flex-shrink-0`}
                        >
                          {statusDisplay.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium break-words">
                            {t("tunnels.port")} {tunnel.sourcePort} →{" "}
                            {tunnel.endpointHost}:{tunnel.endpointPort}
                          </div>
                          <div
                            className={`text-xs ${statusDisplay.color} font-medium`}
                          >
                            {statusDisplay.text}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0 min-w-[120px]">
                        {!isActionLoading ? (
                          <div className="flex flex-col gap-1">
                            {isConnected ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    onTunnelAction(
                                      "disconnect",
                                      host,
                                      tunnelIndex,
                                    )
                                  }
                                  className="h-7 px-2 text-red-600 dark:text-red-400 border-red-500/30 dark:border-red-400/30 hover:bg-red-500/10 dark:hover:bg-red-400/10 hover:border-red-500/50 dark:hover:border-red-400/50 text-xs"
                                >
                                  <Square className="h-3 w-3 mr-1" />
                                  {t("tunnels.disconnect")}
                                </Button>
                              </>
                            ) : isRetrying || isWaiting ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  onTunnelAction("cancel", host, tunnelIndex)
                                }
                                className="h-7 px-2 text-orange-600 dark:text-orange-400 border-orange-500/30 dark:border-orange-400/30 hover:bg-orange-500/10 dark:hover:bg-orange-400/10 hover:border-orange-500/50 dark:hover:border-orange-400/50 text-xs"
                              >
                                <X className="h-3 w-3 mr-1" />
                                {t("tunnels.cancel")}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  onTunnelAction("connect", host, tunnelIndex)
                                }
                                disabled={isConnecting || isDisconnecting}
                                className="h-7 px-2 text-green-600 dark:text-green-400 border-green-500/30 dark:border-green-400/30 hover:bg-green-500/10 dark:hover:bg-green-400/10 hover:border-green-500/50 dark:hover:border-green-400/50 text-xs"
                              >
                                <Play className="h-3 w-3 mr-1" />
                                {t("tunnels.connect")}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled
                            className="h-7 px-2 text-muted-foreground border-border text-xs"
                          >
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {isConnected
                              ? t("tunnels.disconnecting")
                              : isRetrying || isWaiting
                                ? t("tunnels.canceling")
                                : t("tunnels.connecting")}
                          </Button>
                        )}
                      </div>
                    </div>

                    {(statusValue === "ERROR" || statusValue === "FAILED") &&
                      status?.reason && (
                        <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 dark:bg-red-400/10 rounded px-3 py-2 border border-red-500/20 dark:border-red-400/20">
                          <div className="font-medium mb-1">
                            {t("tunnels.error")}:
                          </div>
                          {status.reason}
                          {status.reason &&
                            status.reason.includes("Max retries exhausted") && (
                              <>
                                <div className="mt-2 pt-2 border-t border-red-500/20 dark:border-red-400/20">
                                  {t("tunnels.checkDockerLogs")}{" "}
                                  <a
                                    href="https://discord.com/invite/jVQGdvHDrf"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline text-blue-600 dark:text-blue-400"
                                  >
                                    {t("tunnels.discord")}
                                  </a>{" "}
                                  or create a{" "}
                                  <a
                                    href="https://github.com/LukeGus/Termix/issues/new"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline text-blue-600 dark:text-blue-400"
                                  >
                                    {t("tunnels.githubIssue")}
                                  </a>{" "}
                                  {t("tunnels.forHelp")}.
                                </div>
                              </>
                            )}
                        </div>
                      )}

                    {(statusValue === "RETRYING" ||
                      statusValue === "WAITING") &&
                      status?.retryCount &&
                      status?.maxRetries && (
                        <div className="mt-2 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-500/10 dark:bg-yellow-400/10 rounded px-3 py-2 border border-yellow-500/20 dark:border-yellow-400/20">
                          <div className="font-medium mb-1">
                            {statusValue === "WAITING"
                              ? t("tunnels.waitingForRetry")
                              : t("tunnels.retryingConnection")}
                          </div>
                          <div>
                            {t("tunnels.attempt", {
                              current: status.retryCount,
                              max: status.maxRetries,
                            })}
                            {status.nextRetryIn && (
                              <span>
                                {" "}
                                •{" "}
                                {t("tunnels.nextRetryIn", {
                                  seconds: status.nextRetryIn,
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              <Network className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("tunnels.noTunnelConnections")}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="w-full bg-card border-border shadow-sm hover:shadow-md transition-shadow relative group p-0">
      <div className="p-4">
        {!compact && (
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {host.pin && (
                <Pin className="h-4 w-4 text-yellow-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-card-foreground truncate">
                  {host.name || `${host.username}@${host.ip}`}
                </h3>
                <p className="text-xs text-muted-foreground truncate">
                  {host.ip}:{host.port} • {host.username}
                </p>
              </div>
            </div>
          </div>
        )}

        {!compact && host.tags && host.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {host.tags.slice(0, 3).map((tag, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="text-xs px-1 py-0"
              >
                <Tag className="h-2 w-2 mr-0.5" />
                {tag}
              </Badge>
            ))}
            {host.tags.length > 3 && (
              <Badge variant="outline" className="text-xs px-1 py-0">
                +{host.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        {!compact && <Separator className="mb-3" />}

        <div className="space-y-3">
          {!compact && (
            <h4 className="text-sm font-medium text-card-foreground flex items-center gap-2">
              <Network className="h-4 w-4" />
              {t("tunnels.tunnelConnections")} ({host.tunnelConnections.length})
            </h4>
          )}
          {host.tunnelConnections && host.tunnelConnections.length > 0 ? (
            <div className="space-y-3">
              {host.tunnelConnections.map((tunnel, tunnelIndex) => {
                const status = getTunnelStatus(tunnelIndex);
                const statusDisplay = getTunnelStatusDisplay(status);
                const tunnelName = `${host.name || `${host.username}@${host.ip}`}_${tunnel.sourcePort}_${tunnel.endpointPort}`;
                const isActionLoading = tunnelActions[tunnelName];
                const statusValue =
                  status?.status?.toUpperCase() || "DISCONNECTED";
                const isConnected = statusValue === "CONNECTED";
                const isConnecting = statusValue === "CONNECTING";
                const isDisconnecting = statusValue === "DISCONNECTING";
                const isRetrying = statusValue === "RETRYING";
                const isWaiting = statusValue === "WAITING";

                return (
                  <div
                    key={tunnelIndex}
                    className={`border rounded-lg p-3 ${statusDisplay.bgColor} ${statusDisplay.borderColor}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span
                          className={`${statusDisplay.color} mt-0.5 flex-shrink-0`}
                        >
                          {statusDisplay.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium break-words">
                            {t("tunnels.port")} {tunnel.sourcePort} →{" "}
                            {tunnel.endpointHost}:{tunnel.endpointPort}
                          </div>
                          <div
                            className={`text-xs ${statusDisplay.color} font-medium`}
                          >
                            {statusDisplay.text}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!isActionLoading && (
                          <div className="flex flex-col gap-1">
                            {isConnected ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    onTunnelAction(
                                      "disconnect",
                                      host,
                                      tunnelIndex,
                                    )
                                  }
                                  className="h-7 px-2 text-red-600 dark:text-red-400 border-red-500/30 dark:border-red-400/30 hover:bg-red-500/10 dark:hover:bg-red-400/10 hover:border-red-500/50 dark:hover:border-red-400/50 text-xs"
                                >
                                  <Square className="h-3 w-3 mr-1" />
                                  {t("tunnels.disconnect")}
                                </Button>
                              </>
                            ) : isRetrying || isWaiting ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  onTunnelAction("cancel", host, tunnelIndex)
                                }
                                className="h-7 px-2 text-orange-600 dark:text-orange-400 border-orange-500/30 dark:border-orange-400/30 hover:bg-orange-500/10 dark:hover:bg-orange-400/10 hover:border-orange-500/50 dark:hover:border-orange-400/50 text-xs"
                              >
                                <X className="h-3 w-3 mr-1" />
                                {t("tunnels.cancel")}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  onTunnelAction("connect", host, tunnelIndex)
                                }
                                disabled={isConnecting || isDisconnecting}
                                className="h-7 px-2 text-green-600 dark:text-green-400 border-green-500/30 dark:border-green-400/30 hover:bg-green-500/10 dark:hover:bg-green-400/10 hover:border-green-500/50 dark:hover:border-green-400/50 text-xs"
                              >
                                <Play className="h-3 w-3 mr-1" />
                                {t("tunnels.connect")}
                              </Button>
                            )}
                          </div>
                        )}
                        {isActionLoading && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled
                            className="h-7 px-2 text-muted-foreground border-border text-xs"
                          >
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {isConnected
                              ? t("tunnels.disconnecting")
                              : isRetrying || isWaiting
                                ? t("tunnels.canceling")
                                : t("tunnels.connecting")}
                          </Button>
                        )}
                      </div>
                    </div>

                    {(statusValue === "ERROR" || statusValue === "FAILED") &&
                      status?.reason && (
                        <div className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 dark:bg-red-400/10 rounded px-3 py-2 border border-red-500/20 dark:border-red-400/20">
                          <div className="font-medium mb-1">
                            {t("tunnels.error")}:
                          </div>
                          {status.reason}
                          {status.reason &&
                            status.reason.includes("Max retries exhausted") && (
                              <>
                                <div className="mt-2 pt-2 border-t border-red-500/20 dark:border-red-400/20">
                                  {t("tunnels.checkDockerLogs")}{" "}
                                  <a
                                    href="https://discord.com/invite/jVQGdvHDrf"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline text-blue-600 dark:text-blue-400"
                                  >
                                    {t("tunnels.discord")}
                                  </a>{" "}
                                  or create a{" "}
                                  <a
                                    href="https://github.com/LukeGus/Termix/issues/new"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline text-blue-600 dark:text-blue-400"
                                  >
                                    {t("tunnels.githubIssue")}
                                  </a>{" "}
                                  {t("tunnels.forHelp")}.
                                </div>
                              </>
                            )}
                        </div>
                      )}

                    {(statusValue === "RETRYING" ||
                      statusValue === "WAITING") &&
                      status?.retryCount &&
                      status?.maxRetries && (
                        <div className="mt-2 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-500/10 dark:bg-yellow-400/10 rounded px-3 py-2 border border-yellow-500/20 dark:border-yellow-400/20">
                          <div className="font-medium mb-1">
                            {statusValue === "WAITING"
                              ? t("tunnels.waitingForRetry")
                              : t("tunnels.retryingConnection")}
                          </div>
                          <div>
                            {t("tunnels.attempt", {
                              current: status.retryCount,
                              max: status.maxRetries,
                            })}
                            {status.nextRetryIn && (
                              <span>
                                {" "}
                                •{" "}
                                {t("tunnels.nextRetryIn", {
                                  seconds: status.nextRetryIn,
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              <Network className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{t("tunnels.noTunnelConnections")}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
