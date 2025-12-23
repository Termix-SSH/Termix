import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { ArrowLeft } from "lucide-react";
import type { DockerContainer, SSHHost } from "@/types/index.js";
import { LogViewer } from "./LogViewer.tsx";
import { ContainerStats } from "./ContainerStats.tsx";
import { ConsoleTerminal } from "./ConsoleTerminal.tsx";

interface ContainerDetailProps {
  sessionId: string;
  containerId: string;
  containers: DockerContainer[];
  hostConfig: SSHHost;
  onBack: () => void;
}

export function ContainerDetail({
  sessionId,
  containerId,
  containers,
  hostConfig,
  onBack,
}: ContainerDetailProps): React.ReactElement {
  const [activeTab, setActiveTab] = React.useState("logs");

  const container = containers.find((c) => c.id === containerId);

  if (!container) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-gray-400 text-lg">Container not found</p>
          <Button onClick={onBack} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to list
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with back button */}
      <div className="flex items-center gap-4 px-4 pt-3 pb-3">
        <Button variant="ghost" onClick={onBack} size="sm">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-lg truncate">{container.name}</h2>
          <p className="text-sm text-gray-400 truncate">{container.image}</p>
        </div>
      </div>
      <Separator className="p-0.25 w-full" />

      {/* Tabs for Logs, Stats, Console */}
      <div className="flex-1 overflow-hidden min-h-0">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="h-full flex flex-col"
        >
          <div className="px-4 pt-2">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="console">Console</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="logs"
            className="flex-1 overflow-auto thin-scrollbar px-3 pb-3 mt-3"
          >
            <LogViewer
              sessionId={sessionId}
              containerId={containerId}
              containerName={container.name}
            />
          </TabsContent>

          <TabsContent
            value="stats"
            className="flex-1 overflow-auto thin-scrollbar px-3 pb-3 mt-3"
          >
            <ContainerStats
              sessionId={sessionId}
              containerId={containerId}
              containerName={container.name}
              containerState={container.state}
            />
          </TabsContent>

          <TabsContent
            value="console"
            className="flex-1 overflow-hidden px-3 pb-3 mt-3"
          >
            <ConsoleTerminal
              sessionId={sessionId}
              containerId={containerId}
              containerName={container.name}
              containerState={container.state}
              hostConfig={hostConfig}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
