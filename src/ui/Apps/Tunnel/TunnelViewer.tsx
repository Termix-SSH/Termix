import React from "react";
import {TunnelObject} from "./TunnelObject.tsx";
import {useTranslation} from 'react-i18next';

interface TunnelConnection {
    sourcePort: number;
    endpointPort: number;
    endpointHost: string;
    maxRetries: number;
    retryInterval: number;
    autoStart: boolean;
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
    enableTerminal: boolean;
    enableTunnel: boolean;
    enableFileManager: boolean;
    defaultPath: string;
    tunnelConnections: TunnelConnection[];
    createdAt: string;
    updatedAt: string;
}

interface TunnelStatus {
    status: string;
    reason?: string;
    errorType?: string;
    retryCount?: number;
    maxRetries?: number;
    nextRetryIn?: number;
    retryExhausted?: boolean;
}

interface SSHTunnelViewerProps {
    hosts: SSHHost[];
    tunnelStatuses: Record<string, TunnelStatus>;
    tunnelActions: Record<string, boolean>;
    onTunnelAction: (action: 'connect' | 'disconnect' | 'cancel', host: SSHHost, tunnelIndex: number) => Promise<any>;
}

export function TunnelViewer({
                                 hosts = [],
                                 tunnelStatuses = {},
                                 tunnelActions = {},
                                 onTunnelAction
                             }: SSHTunnelViewerProps): React.ReactElement {
    const {t} = useTranslation();
    const activeHost: SSHHost | undefined = Array.isArray(hosts) && hosts.length > 0 ? hosts[0] : undefined;

    if (!activeHost || !activeHost.tunnelConnections || activeHost.tunnelConnections.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-center p-3">
                <h3 className="text-lg font-semibold text-foreground mb-2">{t('tunnels.noSshTunnels')}</h3>
                <p className="text-muted-foreground max-w-md">
                    {t('tunnels.createFirstTunnelMessage')}
                </p>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col overflow-hidden p-3 min-h-0">
            <div className="w-full flex-shrink-0 mb-2">
                <h1 className="text-xl font-semibold text-foreground">{t('tunnels.title')}</h1>
            </div>
            <div className="min-h-0 flex-1 overflow-auto pr-1">
                <div
                    className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3 auto-rows-min content-start w-full">
                    {activeHost.tunnelConnections.map((t, idx) => (
                        <TunnelObject
                            key={`tunnel-${activeHost.id}-${t.endpointHost}-${t.sourcePort}-${t.endpointPort}`}
                            host={{...activeHost, tunnelConnections: [activeHost.tunnelConnections[idx]]}}
                            tunnelStatuses={tunnelStatuses}
                            tunnelActions={tunnelActions}
                            onTunnelAction={(action, _host, _index) => onTunnelAction(action, activeHost, idx)}
                            compact
                            bare
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}