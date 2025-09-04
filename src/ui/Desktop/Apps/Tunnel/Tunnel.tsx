import React, {useState, useEffect, useCallback} from "react";
import {TunnelViewer} from "@/ui/Desktop/Apps/Tunnel/TunnelViewer.tsx";
import {getSSHHosts, getTunnelStatuses, connectTunnel, disconnectTunnel, cancelTunnel} from "@/ui/main-axios.ts";

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
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
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

interface SSHTunnelProps {
    filterHostKey?: string;
}

export function Tunnel({filterHostKey}: SSHTunnelProps): React.ReactElement {
    const [allHosts, setAllHosts] = useState<SSHHost[]>([]);
    const [visibleHosts, setVisibleHosts] = useState<SSHHost[]>([]);
    const [tunnelStatuses, setTunnelStatuses] = useState<Record<string, TunnelStatus>>({});
    const [tunnelActions, setTunnelActions] = useState<Record<string, boolean>>({});

    const prevVisibleHostRef = React.useRef<SSHHost | null>(null);

    const haveTunnelConnectionsChanged = (a: TunnelConnection[] = [], b: TunnelConnection[] = []): boolean => {
        if (a.length !== b.length) return true;
        for (let i = 0; i < a.length; i++) {
            const x = a[i];
            const y = b[i];
            if (
                x.sourcePort !== y.sourcePort ||
                x.endpointPort !== y.endpointPort ||
                x.endpointHost !== y.endpointHost ||
                x.maxRetries !== y.maxRetries ||
                x.retryInterval !== y.retryInterval ||
                x.autoStart !== y.autoStart
            ) {
                return true;
            }
        }
        return false;
    };

    const fetchHosts = useCallback(async () => {
        const hostsData = await getSSHHosts();
        setAllHosts(hostsData);
        const nextVisible = filterHostKey
            ? hostsData.filter(h => {
                const key = (h.name && h.name.trim() !== '') ? h.name : `${h.username}@${h.ip}`;
                return key === filterHostKey;
            })
            : hostsData;

        const prev = prevVisibleHostRef.current;
        const curr = nextVisible[0] ?? null;
        let changed = false;
        if (!prev && curr) changed = true;
        else if (prev && !curr) changed = true;
        else if (prev && curr) {
            if (
                prev.id !== curr.id ||
                prev.name !== curr.name ||
                prev.ip !== curr.ip ||
                prev.port !== curr.port ||
                prev.username !== curr.username ||
                haveTunnelConnectionsChanged(prev.tunnelConnections, curr.tunnelConnections)
            ) {
                changed = true;
            }
        }

        if (changed) {
            setVisibleHosts(nextVisible);
            prevVisibleHostRef.current = curr;
        }
    }, [filterHostKey]);

    const fetchTunnelStatuses = useCallback(async () => {
        const statusData = await getTunnelStatuses();
        setTunnelStatuses(statusData);
    }, []);

    useEffect(() => {
        fetchHosts();
        const interval = setInterval(fetchHosts, 5000);

        const handleHostsChanged = () => {
            fetchHosts();
        };
        window.addEventListener('ssh-hosts:changed', handleHostsChanged as EventListener);

        return () => {
            clearInterval(interval);
            window.removeEventListener('ssh-hosts:changed', handleHostsChanged as EventListener);
        };
    }, [fetchHosts]);

    useEffect(() => {
        fetchTunnelStatuses();
        const interval = setInterval(fetchTunnelStatuses, 500);
        return () => clearInterval(interval);
    }, [fetchTunnelStatuses]);

    const handleTunnelAction = async (action: 'connect' | 'disconnect' | 'cancel', host: SSHHost, tunnelIndex: number) => {
        const tunnel = host.tunnelConnections[tunnelIndex];
        const tunnelName = `${host.name || `${host.username}@${host.ip}`}_${tunnel.sourcePort}_${tunnel.endpointPort}`;

        setTunnelActions(prev => ({...prev, [tunnelName]: true}));

        try {
            if (action === 'connect') {
                const endpointHost = allHosts.find(h =>
                    h.name === tunnel.endpointHost ||
                    `${h.username}@${h.ip}` === tunnel.endpointHost
                );

                if (!endpointHost) {
                    throw new Error('Endpoint host not found');
                }

                const tunnelConfig = {
                    name: tunnelName,
                    hostName: host.name || `${host.username}@${host.ip}`,
                    sourceIP: host.ip,
                    sourceSSHPort: host.port,
                    sourceUsername: host.username,
                    sourcePassword: host.authType === 'password' ? host.password : undefined,
                    sourceAuthMethod: host.authType,
                    sourceSSHKey: host.authType === 'key' ? host.key : undefined,
                    sourceKeyPassword: host.authType === 'key' ? host.keyPassword : undefined,
                    sourceKeyType: host.authType === 'key' ? host.keyType : undefined,
                    endpointIP: endpointHost.ip,
                    endpointSSHPort: endpointHost.port,
                    endpointUsername: endpointHost.username,
                    endpointPassword: endpointHost.authType === 'password' ? endpointHost.password : undefined,
                    endpointAuthMethod: endpointHost.authType,
                    endpointSSHKey: endpointHost.authType === 'key' ? endpointHost.key : undefined,
                    endpointKeyPassword: endpointHost.authType === 'key' ? endpointHost.keyPassword : undefined,
                    endpointKeyType: endpointHost.authType === 'key' ? endpointHost.keyType : undefined,
                    sourcePort: tunnel.sourcePort,
                    endpointPort: tunnel.endpointPort,
                    maxRetries: tunnel.maxRetries,
                    retryInterval: tunnel.retryInterval * 1000,
                    autoStart: tunnel.autoStart,
                    isPinned: host.pin
                };

                await connectTunnel(tunnelConfig);
            } else if (action === 'disconnect') {
                await disconnectTunnel(tunnelName);
            } else if (action === 'cancel') {
                await cancelTunnel(tunnelName);
            }

            await fetchTunnelStatuses();
        } catch (err) {
        } finally {
            setTunnelActions(prev => ({...prev, [tunnelName]: false}));
        }
    };

    return (
        <TunnelViewer
            hosts={visibleHosts}
            tunnelStatuses={tunnelStatuses}
            tunnelActions={tunnelActions}
            onTunnelAction={handleTunnelAction}
        />
    );
}