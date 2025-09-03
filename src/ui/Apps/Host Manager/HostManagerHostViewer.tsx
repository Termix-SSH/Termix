import React, {useState, useEffect, useMemo} from "react";
import {Card, CardContent} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Input} from "@/components/ui/input";
import {Accordion, AccordionContent, AccordionItem, AccordionTrigger} from "@/components/ui/accordion";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {getSSHHosts, deleteSSHHost, bulkImportSSHHosts} from "@/ui/main-axios.ts";
import {toast} from "sonner";
import {useTranslation} from "react-i18next";
import {
    Edit,
    Trash2,
    Server,
    Folder,
    Tag,
    Pin,
    Terminal,
    Network,
    FileEdit,
    Search,
    Upload,
    Info
} from "lucide-react";
import {Separator} from "@/components/ui/separator.tsx";

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
    tunnelConnections: any[];
    createdAt: string;
    updatedAt: string;
}

interface SSHManagerHostViewerProps {
    onEditHost?: (host: SSHHost) => void;
}

export function HostManagerHostViewer({onEditHost}: SSHManagerHostViewerProps) {
    const {t} = useTranslation();
    const [hosts, setHosts] = useState<SSHHost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [importing, setImporting] = useState(false);

    useEffect(() => {
        fetchHosts();
    }, []);

    const fetchHosts = async () => {
        try {
            setLoading(true);
            const data = await getSSHHosts();
            setHosts(data);
            setError(null);
        } catch (err) {
            setError(t('hosts.failedToLoadHosts'));
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (hostId: number, hostName: string) => {
        if (window.confirm(t('hosts.confirmDelete', { name: hostName }))) {
            try {
                await deleteSSHHost(hostId);
                toast.success(t('hosts.hostDeletedSuccessfully', { name: hostName }));
                await fetchHosts();
                window.dispatchEvent(new CustomEvent('ssh-hosts:changed'));
            } catch (err) {
                toast.error(t('hosts.failedToDeleteHost'));
            }
        }
    };

    const handleEdit = (host: SSHHost) => {
        if (onEditHost) {
            onEditHost(host);
        }
    };

    const handleJsonImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            setImporting(true);
            const text = await file.text();
            const data = JSON.parse(text);

            if (!Array.isArray(data.hosts) && !Array.isArray(data)) {
                throw new Error(t('hosts.jsonMustContainHosts'));
            }

            const hostsArray = Array.isArray(data.hosts) ? data.hosts : data;

            if (hostsArray.length === 0) {
                throw new Error(t('hosts.noHostsInJson'));
            }

            if (hostsArray.length > 100) {
                throw new Error(t('hosts.maxHostsAllowed'));
            }

            const result = await bulkImportSSHHosts(hostsArray);

            if (result.success > 0) {
                toast.success(t('hosts.importCompleted', { success: result.success, failed: result.failed }));
                if (result.errors.length > 0) {
                    toast.error(`Import errors: ${result.errors.join(', ')}`);
                }
                await fetchHosts();
                window.dispatchEvent(new CustomEvent('ssh-hosts:changed'));
            } else {
                toast.error(t('hosts.importFailed') + `: ${result.errors.join(', ')}`);
            }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : t('hosts.failedToImportJson');
            toast.error(t('hosts.importError') + `: ${errorMessage}`);
        } finally {
            setImporting(false);
            event.target.value = '';
        }
    };

    const filteredAndSortedHosts = useMemo(() => {
        let filtered = hosts;

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = hosts.filter(host => {
                const searchableText = [
                    host.name || '',
                    host.username,
                    host.ip,
                    host.folder || '',
                    ...(host.tags || []),
                    host.authType,
                    host.defaultPath || ''
                ].join(' ').toLowerCase();
                return searchableText.includes(query);
            });
        }

        return filtered.sort((a, b) => {
            if (a.pin && !b.pin) return -1;
            if (!a.pin && b.pin) return 1;

            const aName = a.name || a.username;
            const bName = b.name || b.username;
            return aName.localeCompare(bName);
        });
    }, [hosts, searchQuery]);

    const hostsByFolder = useMemo(() => {
        const grouped: { [key: string]: SSHHost[] } = {};

        filteredAndSortedHosts.forEach(host => {
            const folder = host.folder || t('hosts.uncategorized');
            if (!grouped[folder]) {
                grouped[folder] = [];
            }
            grouped[folder].push(host);
        });

        const sortedFolders = Object.keys(grouped).sort((a, b) => {
            if (a === t('hosts.uncategorized')) return -1;
            if (b === t('hosts.uncategorized')) return 1;
            return a.localeCompare(b);
        });

        const sortedGrouped: { [key: string]: SSHHost[] } = {};
        sortedFolders.forEach(folder => {
            sortedGrouped[folder] = grouped[folder];
        });

        return sortedGrouped;
    }, [filteredAndSortedHosts]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                    <p className="text-muted-foreground">{t('hosts.loadingHosts')}</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <p className="text-red-500 mb-4">{error}</p>
                    <Button onClick={fetchHosts} variant="outline">
                        {t('hosts.retry')}
                    </Button>
                </div>
            </div>
        );
    }

    if (hosts.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4"/>
                    <h3 className="text-lg font-semibold mb-2">{t('hosts.noHosts')}</h3>
                    <p className="text-muted-foreground mb-4">
                        {t('hosts.noHostsMessage')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h2 className="text-xl font-semibold">{t('hosts.sshHosts')}</h2>
                    <p className="text-muted-foreground">
                        {t('hosts.hostsCount', { count: filteredAndSortedHosts.length })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="relative"
                                    onClick={() => document.getElementById('json-import-input')?.click()}
                                    disabled={importing}
                                >
                                    {importing ? t('hosts.importing') : t('hosts.importJson')}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom"
                                            className="max-w-sm bg-popover text-popover-foreground border border-border shadow-lg">
                                <div className="space-y-2">
                                    <p className="font-semibold text-sm">{t('hosts.importJsonTitle')}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('hosts.importJsonDesc')}
                                    </p>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            const sampleData = {
                                hosts: [
                                    {
                                        name: "Web Server - Production",
                                        ip: "192.168.1.100",
                                        port: 22,
                                        username: "admin",
                                        authType: "password",
                                        password: "your_secure_password_here",
                                        folder: "Production",
                                        tags: ["web", "production", "nginx"],
                                        pin: true,
                                        enableTerminal: true,
                                        enableTunnel: false,
                                        enableFileManager: true,
                                        defaultPath: "/var/www"
                                    },
                                    {
                                        name: "Database Server",
                                        ip: "192.168.1.101",
                                        port: 22,
                                        username: "dbadmin",
                                        authType: "key",
                                        key: "-----BEGIN OPENSSH PRIVATE KEY-----\nYour SSH private key content here\n-----END OPENSSH PRIVATE KEY-----",
                                        keyPassword: "optional_key_passphrase",
                                        keyType: "ssh-ed25519",
                                        folder: "Production",
                                        tags: ["database", "production", "postgresql"],
                                        pin: false,
                                        enableTerminal: true,
                                        enableTunnel: true,
                                        enableFileManager: false,
                                        tunnelConnections: [
                                            {
                                                sourcePort: 5432,
                                                endpointPort: 5432,
                                                endpointHost: "Web Server - Production",
                                                maxRetries: 3,
                                                retryInterval: 10,
                                                autoStart: true
                                            }
                                        ]
                                    }
                                ]
                            };

                            const blob = new Blob([JSON.stringify(sampleData, null, 2)], {type: 'application/json'});
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'sample-ssh-hosts.json';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        }}
                    >
                        {t('hosts.downloadSample')}
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            window.open('https://docs.termix.site/json-import', '_blank');
                        }}
                    >
                        {t('hosts.formatGuide')}
                    </Button>

                    <div className="w-px h-6 bg-border mx-2"/>

                    <Button onClick={fetchHosts} variant="outline" size="sm">
                        {t('hosts.refresh')}
                    </Button>
                </div>
            </div>

            <input
                id="json-import-input"
                type="file"
                accept=".json"
                onChange={handleJsonImport}
                style={{display: 'none'}}
            />

            <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                <Input
                    placeholder={t('placeholders.searchHosts')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                />
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-2 pb-20">
                    {Object.entries(hostsByFolder).map(([folder, folderHosts]) => (
                        <div key={folder} className="border rounded-md">
                            <Accordion type="multiple" defaultValue={Object.keys(hostsByFolder)}>
                                <AccordionItem value={folder} className="border-none">
                                    <AccordionTrigger
                                        className="px-2 py-1 bg-muted/20 border-b hover:no-underline rounded-t-md">
                                        <div className="flex items-center gap-2">
                                            <Folder className="h-4 w-4"/>
                                            <span className="font-medium">{folder}</span>
                                            <Badge variant="secondary" className="text-xs">
                                                {folderHosts.length}
                                            </Badge>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="p-2">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                            {folderHosts.map((host) => (
                                                <div
                                                    key={host.id}
                                                    className="bg-[#222225] border border-input rounded cursor-pointer hover:shadow-md transition-shadow p-2"
                                                    onClick={() => handleEdit(host)}
                                                >
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1">
                                                                {host.pin && <Pin
                                                                    className="h-3 w-3 text-yellow-500 flex-shrink-0"/>}
                                                                <h3 className="font-medium truncate text-sm">
                                                                    {host.name || `${host.username}@${host.ip}`}
                                                                </h3>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {host.ip}:{host.port}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {host.username}
                                                            </p>
                                                        </div>
                                                        <div className="flex gap-1 flex-shrink-0 ml-1">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEdit(host);
                                                                }}
                                                                className="h-5 w-5 p-0"
                                                            >
                                                                <Edit className="h-3 w-3"/>
                                                            </Button>
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(host.id, host.name || `${host.username}@${host.ip}`);
                                                                }}
                                                                className="h-5 w-5 p-0 text-red-500 hover:text-red-700"
                                                            >
                                                                <Trash2 className="h-3 w-3"/>
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    <div className="mt-2 space-y-1">
                                                        {host.tags && host.tags.length > 0 && (
                                                            <div className="flex flex-wrap gap-1">
                                                                {host.tags.slice(0, 6).map((tag, index) => (
                                                                    <Badge key={index} variant="outline"
                                                                           className="text-xs px-1 py-0">
                                                                        <Tag className="h-2 w-2 mr-0.5"/>
                                                                        {tag}
                                                                    </Badge>
                                                                ))}
                                                                {host.tags.length > 6 && (
                                                                    <Badge variant="outline"
                                                                           className="text-xs px-1 py-0">
                                                                        +{host.tags.length - 6}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="flex flex-wrap gap-1">
                                                            {host.enableTerminal && (
                                                                <Badge variant="outline" className="text-xs px-1 py-0">
                                                                    <Terminal className="h-2 w-2 mr-0.5"/>
                                                                    {t('hosts.terminalBadge')}
                                                                </Badge>
                                                            )}
                                                            {host.enableTunnel && (
                                                                <Badge variant="outline" className="text-xs px-1 py-0">
                                                                    <Network className="h-2 w-2 mr-0.5"/>
                                                                    {t('hosts.tunnelBadge')}
                                                                    {host.tunnelConnections && host.tunnelConnections.length > 0 && (
                                                                        <span
                                                                            className="ml-0.5">({host.tunnelConnections.length})</span>
                                                                    )}
                                                                </Badge>
                                                            )}
                                                            {host.enableFileManager && (
                                                                <Badge variant="outline" className="text-xs px-1 py-0">
                                                                    <FileEdit className="h-2 w-2 mr-0.5"/>
                                                                    {t('hosts.fileManagerBadge')}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </div>
                    ))}
                </div>
            </ScrollArea>
        </div>
    );
}