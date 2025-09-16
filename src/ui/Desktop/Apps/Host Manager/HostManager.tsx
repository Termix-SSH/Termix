import React, { useState } from "react";
import { HostManagerViewer } from "@/ui/Desktop/Apps/Host Manager/HostManagerViewer.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { HostManagerEditor } from "@/ui/Desktop/Apps/Host Manager/HostManagerEditor.tsx";
import { CredentialsManager } from "@/ui/Desktop/Apps/Credentials/CredentialsManager.tsx";
import { CredentialEditor } from "@/ui/Desktop/Apps/Credentials/CredentialEditor.tsx";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { useTranslation } from "react-i18next";
import type { SSHHost, HostManagerProps } from "../../../types/index";

export function HostManager({
  onSelectView,
  isTopbarOpen,
}: HostManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("host_viewer");
  const [editingHost, setEditingHost] = useState<SSHHost | null>(null);

  const [editingCredential, setEditingCredential] = useState<any | null>(null);
  const { state: sidebarState } = useSidebar();

  const handleEditHost = (host: SSHHost) => {
    setEditingHost(host);
    setActiveTab("add_host");
  };

  const handleFormSubmit = (updatedHost?: SSHHost) => {
    setEditingHost(null);
    setActiveTab("host_viewer");
  };

  const handleEditCredential = (credential: any) => {
    setEditingCredential(credential);
    setActiveTab("add_credential");
  };

  const handleCredentialFormSubmit = () => {
    setEditingCredential(null);
    setActiveTab("credentials");
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    if (value !== "add_host") {
      setEditingHost(null);
    }
    if (value !== "add_credential") {
      setEditingCredential(null);
    }
  };

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;

  return (
    <div>
      <div className="w-full">
        <div
          className="bg-dark-bg text-white p-4 pt-0 rounded-lg border-2 border-dark-border flex flex-col min-h-0 overflow-hidden"
          style={{
            marginLeft: leftMarginPx,
            marginRight: 17,
            marginTop: topMarginPx,
            marginBottom: bottomMarginPx,
            height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
          }}
        >
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex-1 flex flex-col h-full min-h-0"
          >
            <TabsList className="bg-dark-bg border-2 border-dark-border mt-1.5">
              <TabsTrigger value="host_viewer">
                {t("hosts.hostViewer")}
              </TabsTrigger>
              <TabsTrigger value="add_host">
                {editingHost
                  ? editingHost.id
                    ? t("hosts.editHost")
                    : t("hosts.cloneHost")
                  : t("hosts.addHost")}
              </TabsTrigger>
              <div className="h-6 w-px bg-dark-border mx-1"></div>
              <TabsTrigger value="credentials">
                {t("credentials.credentialsViewer")}
              </TabsTrigger>
              <TabsTrigger value="add_credential">
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
              <div className="flex flex-col h-full min-h-0 overflow-auto">
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
