import React from "react";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Separator } from "@/components/separator.tsx";
import {
  Activity,
  ArrowLeft,
  Box,
  List,
  Settings,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DockerContainer, SSHHost } from "@/types";
import { LogViewer } from "./LogViewer.tsx";
import { ContainerStats } from "./ContainerStats.tsx";
import { ConsoleTerminal } from "./ConsoleTerminal.tsx";
import { DockerBadge } from "./ContainerCard.tsx";

interface ContainerDetailProps {
  sessionId: string;
  containerId: string;
  containers: DockerContainer[];
  hostConfig: SSHHost;
  onBack: () => void;
}

type DetailTab = "logs" | "stats" | "console";

export function ContainerDetail({
  sessionId,
  containerId,
  containers,
  hostConfig,
  onBack,
}: ContainerDetailProps): React.ReactElement {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState<DetailTab>("logs");

  const container = containers.find((c) => c.id === containerId);
  const containerName = container
    ? container.name.startsWith("/")
      ? container.name.slice(1)
      : container.name
    : "";

  if (!container) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center flex flex-col gap-3">
          <p className="text-muted-foreground">
            {t("docker.containerNotFound")}
          </p>
          <Button onClick={onBack} variant="outline" size="sm">
            <ArrowLeft className="size-4 mr-2" />
            {t("docker.backToList")}
          </Button>
        </div>
      </div>
    );
  }

  const tabs: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "logs",
      label: t("docker.logs"),
      icon: <List className="size-3.5" />,
    },
    {
      id: "stats",
      label: t("docker.stats"),
      icon: <Activity className="size-3.5" />,
    },
    {
      id: "console",
      label: t("docker.consoleTab"),
      icon: <Terminal className="size-3.5" />,
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-3 py-3 gap-3">
        <Card className="flex-row items-center justify-between px-3 py-3 shrink-0 gap-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="size-10 border border-border bg-muted flex items-center justify-center shrink-0">
              <Box className="size-5 text-accent-brand" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{containerName}</h1>
              <span className="text-xs text-muted-foreground font-mono">
                {container.image}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DockerBadge state={container.state} />
            <Separator orientation="vertical" className="h-8 mx-2" />
            <Button variant="ghost" size="icon">
              <Settings className="size-4 text-accent-brand" />
            </Button>
          </div>
        </Card>

        <div className="flex flex-col flex-1 min-h-0 gap-3">
          <div className="flex gap-1 border-b border-border shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-b-accent-brand text-foreground bg-accent-brand/5"
                    : "border-b-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            {activeTab === "logs" && (
              <LogViewer
                sessionId={sessionId}
                containerId={containerId}
                containerName={containerName}
              />
            )}
            {activeTab === "stats" && (
              <ContainerStats
                sessionId={sessionId}
                containerId={containerId}
                containerName={containerName}
                containerState={container.state}
              />
            )}
            {activeTab === "console" && (
              <ConsoleTerminal
                containerId={containerId}
                containerName={containerName}
                containerState={container.state}
                hostConfig={hostConfig}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
