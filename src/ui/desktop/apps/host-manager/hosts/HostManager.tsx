import React, { useState, useEffect, useRef } from "react";
import { HostManagerViewer } from "@/ui/desktop/apps/host-manager/hosts/HostManagerViewer.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { HostManagerEditor } from "@/ui/desktop/apps/host-manager/hosts/HostManagerEditor.tsx";
import { CredentialsManager } from "@/ui/desktop/apps/host-manager/credentials/CredentialsManager.tsx";
import { CredentialEditor } from "@/ui/desktop/apps/host-manager/credentials/CredentialEditor.tsx";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { useTranslation } from "react-i18next";
import type { SSHHost, HostManagerProps } from "../../../types/index";

export function HostManager({
  isTopbarOpen,
  initialTab = "host_viewer",
  hostConfig,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
}: HostManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [editingHost, setEditingHost] = useState<SSHHost | null>(
    hostConfig || null,
  );

  const [editingCredential, setEditingCredential] = useState<{
    id: number;
    name?: string;
    username: string;
  } | null>(null);
  const { state: sidebarState } = useSidebar();
  const ignoreNextHostConfigChangeRef = useRef<boolean>(false);
  const lastProcessedHostIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Update editingHost when hostConfig changes
  useEffect(() => {
    if (hostConfig) {
      setEditingHost(hostConfig);
      setActiveTab("add_host");
      lastProcessedHostIdRef.current = hostConfig.id;
    }
  }, [hostConfig?.id]);

  const handleEditHost = (host: SSHHost) => {
    setEditingHost(host);
    setActiveTab("add_host");
    lastProcessedHostIdRef.current = host.id;
  };

  const handleFormSubmit = () => {
    ignoreNextHostConfigChangeRef.current = true;
    setEditingHost(null);
    setActiveTab("host_viewer");
    setTimeout(() => {
      lastProcessedHostIdRef.current = undefined;
    }, 500);
  };

  const handleEditCredential = (credential: {
    id: number;
    name?: string;
    username: string;
  }) => {
    setEditingCredential(credential);
    setActiveTab("add_credential");
  };

  const handleCredentialFormSubmit = () => {
    setEditingCredential(null);
    setActiveTab("credentials");
  };

  const handleTabChange = (value: string) => {
    if (activeTab === "add_host" && value !== "add_host") {
      setEditingHost(null);
    }
    if (activeTab === "add_credential" && value !== "add_credential") {
      setEditingCredential(null);
    }
    setActiveTab(value);
  };

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;

  return (
    <div>
      <div className="w-full">
        <div
          className="bg-canvas text-foreground p-4 pt-0 rounded-lg border-2 border-edge flex flex-col min-h-0 overflow-hidden"
          style={{
            marginLeft: leftMarginPx,
            marginRight: rightSidebarOpen
              ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
              : 17,
            marginTop: topMarginPx,
            marginBottom: bottomMarginPx,
            height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
            transition:
              "margin-left 200ms linear, margin-right 200ms linear, margin-top 200ms linear",
          }}
        >
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex-1 flex flex-col h-full min-h-0"
          >
            <TabsList className="bg-elevated border-2 border-edge mt-1.5">
              <TabsTrigger
                value="host_viewer"
                className="bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                {t("hosts.hostViewer")}
              </TabsTrigger>
              <TabsTrigger
                value="add_host"
                className="bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                {editingHost
                  ? editingHost.id
                    ? t("hosts.editHost")
                    : t("hosts.cloneHost")
                  : t("hosts.addHost")}
              </TabsTrigger>
              <div className="h-6 w-px bg-border-base mx-1"></div>
              <TabsTrigger
                value="credentials"
                className="bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                {t("credentials.credentialsViewer")}
              </TabsTrigger>
              <TabsTrigger
                value="add_credential"
                className="bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                {editingCredential
                  ? t("credentials.editCredential")
                  : t("credentials.addCredential")}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="host_viewer"
              className="flex-1 flex flex-col h-full min-h-0"
            >
              <Separator className="p-0.25 -mt-0.5 mb-1" />
              <HostManagerViewer onEditHost={handleEditHost} />
            </TabsContent>
            <TabsContent
              value="add_host"
              className="flex-1 flex flex-col h-full min-h-0"
            >
              <Separator className="p-0.25 -mt-0.5 mb-1" />
              <div className="flex flex-col h-full min-h-0">
                <HostManagerEditor
                  editingHost={editingHost}
                  onFormSubmit={handleFormSubmit}
                />
              </div>
            </TabsContent>
            <TabsContent
              value="credentials"
              className="flex-1 flex flex-col h-full min-h-0"
            >
              <Separator className="p-0.25 -mt-0.5 mb-1" />
              <div className="flex flex-col h-full min-h-0 overflow-auto thin-scrollbar">
                <CredentialsManager onEditCredential={handleEditCredential} />
              </div>
            </TabsContent>
            <TabsContent
              value="add_credential"
              className="flex-1 flex flex-col h-full min-h-0"
            >
              <Separator className="p-0.25 -mt-0.5 mb-1" />
              <div className="flex flex-col h-full min-h-0">
                <CredentialEditor
                  editingCredential={editingCredential}
                  onFormSubmit={handleCredentialFormSubmit}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
