import {Sidebar, SidebarContent, SidebarGroupLabel, SidebarHeader, SidebarProvider} from "@/components/ui/sidebar.tsx";
import {Button} from "@/components/ui/button.tsx";
import {Menu} from "lucide-react";
import React from "react";
import {Separator} from "@/components/ui/separator.tsx";
import {FolderCard} from "@/ui/Mobile/Apps/Navigation/Hosts/FolderCard.tsx";
import {Host} from "@/ui/Mobile/Apps/Navigation/Hosts/Host.tsx";

interface LeftSidebarProps {
    isSidebarOpen: boolean;
    setIsSidebarOpen: (type: boolean) => void;
}

export function LeftSidebar({ isSidebarOpen, setIsSidebarOpen }: LeftSidebarProps) {
    return (
        <div className="">
            <SidebarProvider open={isSidebarOpen}>
                <Sidebar>
                    <SidebarHeader>
                        <SidebarGroupLabel className="text-lg font-bold text-white">
                            Termix
                            <Button
                                variant="outline"
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="w-[28px] h-[28px] absolute right-5"
                            >
                                <Menu className="h-4 w-4"/>
                            </Button>
                        </SidebarGroupLabel>
                    </SidebarHeader>
                    <Separator/>
                    <SidebarContent className="px-2 py-2">
                        <FolderCard
                            folderName="Folder"
                            hosts={[{
                                id: 1,
                                name: "My Server",
                                ip: "192.168.1.100",
                                port: 22,
                                username: "admin",
                                folder: "/home/admin",
                                tags: ["production", "backend"],
                                pin: true,
                                authType: "password",
                                password: "securePassword123",
                                key: undefined,
                                keyPassword: undefined,
                                keyType: undefined,
                                enableTerminal: true,
                                enableTunnel: false,
                                enableFileManager: true,
                                defaultPath: "/home/admin/projects",
                                tunnelConnections: [],
                                createdAt: "2025-09-05T12:00:00Z",
                                updatedAt: "2025-09-05T12:00:00Z"
                            }]}
                        />
                    </SidebarContent>
                </Sidebar>
            </SidebarProvider>
        </div>
    )
}