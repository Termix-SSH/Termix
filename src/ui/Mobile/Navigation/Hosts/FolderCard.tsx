import React, {useState} from "react";
import {CardTitle} from "@/components/ui/card.tsx";
import {ChevronDown, Folder} from "lucide-react";
import {Button} from "@/components/ui/button.tsx";
import {Separator} from "@/components/ui/separator.tsx";
import {Host} from "@/ui/Mobile/Navigation/Hosts/Host.tsx";

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

interface FolderCardProps {
    folderName: string;
    hosts: SSHHost[];
    onHostConnect: () => void;
}

export function FolderCard({folderName, hosts, onHostConnect}: FolderCardProps): React.ReactElement {
    const [isExpanded, setIsExpanded] = useState(true);

    const toggleExpanded = () => {
        setIsExpanded(!isExpanded);
    };

    return (
        <div className="bg-[#0e0e10] border-2 border-[#303032] rounded-lg overflow-hidden"
             style={{padding: '0', margin: '0'}}>
            <div className={`px-4 py-3 relative ${isExpanded ? 'border-b-2' : ''} bg-[#131316]`}>
                <div className="flex gap-2 pr-10">
                    <div className="flex-shrink-0 flex items-center">
                        <Folder size={16} strokeWidth={3}/>
                    </div>
                    <div className="flex-1 min-w-0">
                        <CardTitle className="mb-0 leading-tight break-words text-md">{folderName}</CardTitle>
                    </div>
                </div>
                <Button
                    variant="outline"
                    className="w-[28px] h-[28px] absolute right-4 top-1/2 -translate-y-1/2 flex-shrink-0"
                    onClick={toggleExpanded}
                >
                    <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? '' : 'rotate-180'}`}/>
                </Button>
            </div>
            {isExpanded && (
                <div className="flex flex-col p-2 gap-y-3">
                    {hosts.map((host, index) => (
                        <React.Fragment key={`${folderName}-host-${host.id}-${host.name || host.ip}`}>
                            <Host host={host} onHostConnect={onHostConnect}/>

                            {index < hosts.length - 1 && (
                                <div className="relative -mx-2">
                                    <Separator className="p-0.25 absolute inset-x-0"/>
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    )
}
