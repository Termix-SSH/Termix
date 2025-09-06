import React, {useState} from "react";
import {HostManagerHostViewer} from "@/ui/Desktop/Apps/Host Manager/HostManagerHostViewer.tsx"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs.tsx";
import {Separator} from "@/components/ui/separator.tsx";
import {HostManagerHostEditor} from "@/ui/Desktop/Apps/Host Manager/HostManagerHostEditor.tsx";
import CredentialsManager from "@/ui/Desktop/Apps/Credentials/CredentialsManager.tsx";
import {useSidebar} from "@/components/ui/sidebar.tsx";
import {useTranslation} from "react-i18next";

interface HostManagerProps {
    onSelectView: (view: string) => void;
    isTopbarOpen?: boolean;
}

interface SSHHost {
    id: number;
    name: string;
    ip: string;
    port: number;
    username: string;
    folder: string;
    tags: string[];
    pin: boolean;
    authType: string;
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
    enableTerminal: boolean;
    enableTunnel: boolean;
    enableFileManager: boolean;
    defaultPath: string;
    tunnelConnections: any[];
    createdAt: string;
    updatedAt: string;
}

export function HostManager({onSelectView, isTopbarOpen}: HostManagerProps): React.ReactElement {
    const {t} = useTranslation();
    const [activeTab, setActiveTab] = useState("host_viewer");
    const [editingHost, setEditingHost] = useState<SSHHost | null>(null);
    const {state: sidebarState} = useSidebar();

    const handleEditHost = (host: SSHHost) => {
        setEditingHost(host);
        setActiveTab("add_host");
    };

    const handleFormSubmit = () => {
        setEditingHost(null);
        setActiveTab("host_viewer");
    };

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        if (value === "host_viewer") {
            setEditingHost(null);
        }
    };

    const topMarginPx = isTopbarOpen ? 74 : 26;
    const leftMarginPx = sidebarState === 'collapsed' ? 26 : 8;
    const bottomMarginPx = 8;

    return (
        <div>
            <div className="w-full">
                <div
                    className="bg-[#18181b] text-white p-4 pt-0 rounded-lg border-2 border-[#303032] flex flex-col min-h-0 overflow-hidden"
                    style={{
                        marginLeft: leftMarginPx,
                        marginRight: 17,
                        marginTop: topMarginPx,
                        marginBottom: bottomMarginPx,
                        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`
                    }}
                >
                    <Tabs value={activeTab} onValueChange={handleTabChange}
                          className="flex-1 flex flex-col h-full min-h-0">
                        <TabsList className="bg-[#18181b] border-2 border-[#303032] mt-1.5">
                            <TabsTrigger value="host_viewer">{t('hosts.hostViewer')}</TabsTrigger>
                            <TabsTrigger value="add_host">
                                {editingHost ? t('hosts.editHost') : t('hosts.addHost')}
                            </TabsTrigger>
                            <TabsTrigger value="credentials">{t('credentials.credentialsManager')}</TabsTrigger>
                        </TabsList>
                        <TabsContent value="host_viewer" className="flex-1 flex flex-col h-full min-h-0">
                            <Separator className="p-0.25 -mt-0.5 mb-1"/>
                            <HostManagerHostViewer onEditHost={handleEditHost}/>
                        </TabsContent>
                        <TabsContent value="add_host" className="flex-1 flex flex-col h-full min-h-0">
                            <Separator className="p-0.25 -mt-0.5 mb-1"/>
                            <div className="flex flex-col h-full min-h-0">
                                <HostManagerHostEditor
                                    editingHost={editingHost}
                                    onFormSubmit={handleFormSubmit}
                                />
                            </div>
                        </TabsContent>
                        <TabsContent value="credentials" className="flex-1 flex flex-col h-full min-h-0">
                            <Separator className="p-0.25 -mt-0.5 mb-1"/>
                            <div className="flex flex-col h-full min-h-0 overflow-auto">
                                <CredentialsManager />
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    )
}