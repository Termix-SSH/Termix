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
  initialTab = "hosts",
  hostConfig,
  _updateTimestamp,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
  currentTabId,
  updateTab,
}: HostManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(
    initialTab === "host_viewer" || initialTab === "add_host"
      ? "hosts"
      : initialTab === "credentials" || initialTab === "add_credential"
        ? "credentials"
        : initialTab,
  );
  const [editingHost, setEditingHost] = useState<SSHHost | null>(
    hostConfig || null,
  );
  const [isAddingHost, setIsAddingHost] = useState(false);
  const [isAddingCredential, setIsAddingCredential] = useState(false);

  useEffect(() => {}, [editingHost]);

  const [editingCredential, setEditingCredential] = useState<{
    id: number;
    name?: string;
    username: string;
  } | null>(null);
  const { state: sidebarState } = useSidebar();
  const ignoreNextHostConfigChangeRef = useRef<boolean>(false);
  const lastProcessedHostIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const handleAddHostEvent = () => {
      setActiveTab("hosts");
      setEditingHost(null);
      setIsAddingHost(true);
      setIsAddingCredential(false);
    };

    const handleAddCredentialEvent = () => {
      setActiveTab("credentials");
      setEditingCredential(null);
      setIsAddingCredential(true);
      setIsAddingHost(false);
    };

    window.addEventListener("host-manager:add-host", handleAddHostEvent);
    window.addEventListener(
      "host-manager:add-credential",
      handleAddCredentialEvent,
    );

    return () => {
      window.removeEventListener("host-manager:add-host", handleAddHostEvent);
      window.removeEventListener(
        "host-manager:add-credential",
        handleAddCredentialEvent,
      );
    };
  }, []);

  useEffect(() => {
    if (_updateTimestamp !== undefined) {
      const normalizedTab =
        initialTab === "host_viewer" || initialTab === "add_host"
          ? "hosts"
          : initialTab === "credentials" || initialTab === "add_credential"
            ? "credentials"
            : initialTab;

      if (initialTab && normalizedTab !== activeTab) {
        setActiveTab(normalizedTab);
      }

      if (hostConfig && hostConfig.id !== editingHost?.id) {
        setEditingHost(hostConfig);
        setIsAddingHost(false);
        lastProcessedHostIdRef.current = hostConfig.id;
      } else if (!hostConfig && editingHost) {
        setEditingHost(null);
        setIsAddingHost(false);
      }
    } else {
      if (initialTab) {
        const normalizedTab =
          initialTab === "host_viewer" || initialTab === "add_host"
            ? "hosts"
            : initialTab === "credentials" || initialTab === "add_credential"
              ? "credentials"
              : initialTab;
        setActiveTab(normalizedTab);
      }
      if (hostConfig) {
        setEditingHost(hostConfig);
        setIsAddingHost(false);
        lastProcessedHostIdRef.current = hostConfig.id;
      }
    }
  }, [_updateTimestamp, initialTab, hostConfig]);

  const handleEditHost = (host: SSHHost) => {
    setEditingHost(host);
    setIsAddingHost(false);
    lastProcessedHostIdRef.current = host.id;
  };

  const handleAddHost = () => {
    setEditingHost(null);
    setIsAddingHost(true);
    lastProcessedHostIdRef.current = undefined;
  };

  const handleFormSubmit = () => {
    ignoreNextHostConfigChangeRef.current = true;
    setEditingHost(null);
    setIsAddingHost(false);
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
    setIsAddingCredential(false);
  };

  const handleAddCredential = () => {
    setEditingCredential(null);
    setIsAddingCredential(true);
  };

  const handleCredentialFormSubmit = () => {
    setEditingCredential(null);
    setIsAddingCredential(false);
  };

  const handleTabChange = (value: string) => {
    if (activeTab !== value) {
      setEditingHost(null);
      setEditingCredential(null);
      setIsAddingHost(false);
      setIsAddingCredential(false);
      lastProcessedHostIdRef.current = undefined;

      if (updateTab && currentTabId !== undefined) {
        updateTab(currentTabId, { hostConfig: null });
      }
    }

    setActiveTab(value);

    if (updateTab && currentTabId !== undefined) {
      updateTab(currentTabId, { initialTab: value });
    }
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
                value="hosts"
                className="bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                {t("hosts.hosts")}
              </TabsTrigger>
              <TabsTrigger
                value="credentials"
                className="bg-elevated data-[state=active]:bg-button data-[state=active]:border data-[state=active]:border-edge"
              >
                {t("credentials.credentials")}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="hosts"
              className="flex-1 flex flex-col h-full min-h-0"
            >
              <Separator className="p-0.25 -mt-0.5 mb-1" />
              {editingHost !== null || isAddingHost ? (
                <div className="flex flex-col h-full min-h-0">
                  <HostManagerEditor
                    editingHost={editingHost}
                    onFormSubmit={handleFormSubmit}
                    onBack={() => {
                      setEditingHost(null);
                      setIsAddingHost(false);
                    }}
                  />
                </div>
              ) : (
                <HostManagerViewer
                  onEditHost={handleEditHost}
                  onAddHost={handleAddHost}
                />
              )}
            </TabsContent>
            <TabsContent
              value="credentials"
              className="flex-1 flex flex-col h-full min-h-0"
            >
              <Separator className="p-0.25 -mt-0.5 mb-1" />
              {editingCredential !== null || isAddingCredential ? (
                <div className="flex flex-col h-full min-h-0">
                  <CredentialEditor
                    editingCredential={editingCredential}
                    onFormSubmit={handleCredentialFormSubmit}
                    onBack={() => {
                      setEditingCredential(null);
                      setIsAddingCredential(false);
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-col h-full min-h-0 overflow-auto thin-scrollbar">
                  <CredentialsManager
                    onEditCredential={handleEditCredential}
                    onAddCredential={handleAddCredential}
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
