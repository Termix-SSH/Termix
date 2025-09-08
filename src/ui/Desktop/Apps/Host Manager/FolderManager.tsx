import React, { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
    Folder,
    Edit,
    Search,
    Trash2,
    Users
} from 'lucide-react';
import { getFoldersWithStats, renameFolder } from '@/ui/main-axios';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface FolderStats {
    name: string;
    hostCount: number;
    hosts: Array<{
        id: number;
        name?: string;
        ip: string;
    }>;
}

interface FolderManagerProps {
    onFolderChanged?: () => void;
}

export function FolderManager({ onFolderChanged }: FolderManagerProps) {
    const { t } = useTranslation();
    const [folders, setFolders] = useState<FolderStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    
    // Rename state
    const [renameLoading, setRenameLoading] = useState(false);

    useEffect(() => {
        fetchFolders();
    }, []);

    const fetchFolders = async () => {
        try {
            setLoading(true);
            const data = await getFoldersWithStats();
            setFolders(data || []);
            setError(null);
        } catch (err) {
            setError('Failed to fetch folder statistics');
        } finally {
            setLoading(false);
        }
    };

    const handleRename = async (folder: FolderStats) => {
        const newName = prompt(
            `Enter new name for folder "${folder.name}":\n\nThis will update ${folder.hostCount} host(s) that use this folder.`,
            folder.name
        );

        if (!newName || newName.trim() === '' || newName === folder.name) {
            return;
        }

        if (window.confirm(
            `Are you sure you want to rename folder "${folder.name}" to "${newName.trim()}"?\n\n` +
            `This will update ${folder.hostCount} host(s) that currently use this folder.`
        )) {
            try {
                setRenameLoading(true);
                await renameFolder(folder.name, newName.trim());
                toast.success(`Folder renamed from "${folder.name}" to "${newName.trim()}"`, {
                    description: `Updated ${folder.hostCount} host(s)`
                });
                
                // Refresh folder list
                await fetchFolders();
                
                // Notify parent component about folder change
                if (onFolderChanged) {
                    onFolderChanged();
                }
                
                // Emit event for other components to refresh
                window.dispatchEvent(new CustomEvent('folders:changed'));
                
            } catch (err) {
                toast.error('Failed to rename folder');
            } finally {
                setRenameLoading(false);
            }
        }
    };

    const filteredFolders = useMemo(() => {
        if (!searchQuery.trim()) {
            return folders;
        }
        
        const query = searchQuery.toLowerCase();
        return folders.filter(folder => 
            folder.name.toLowerCase().includes(query) ||
            folder.hosts.some(host => 
                (host.name?.toLowerCase().includes(query)) ||
                host.ip.toLowerCase().includes(query)
            )
        );
    }, [folders, searchQuery]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                    <p className="text-muted-foreground">Loading folders...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <p className="text-red-500 mb-4">{error}</p>
                    <Button onClick={fetchFolders} variant="outline">
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    if (folders.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <Folder className="h-12 w-12 text-muted-foreground mx-auto mb-4"/>
                    <h3 className="text-lg font-semibold mb-2">No Folders Found</h3>
                    <p className="text-muted-foreground mb-4">
                        Create some hosts with folders to manage them here
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h2 className="text-xl font-semibold">Folder Management</h2>
                    <p className="text-muted-foreground">
                        {filteredFolders.length} folder(s) found
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={fetchFolders} variant="outline" size="sm">
                        Refresh
                    </Button>
                </div>
            </div>

            <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                <Input
                    placeholder="Search folders..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                />
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-3 pb-20">
                    {filteredFolders.map((folder) => (
                        <div
                            key={folder.name}
                            className="bg-[#222225] border border-input rounded-lg p-4 hover:shadow-md transition-shadow"
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Folder className="h-5 w-5 text-blue-500" />
                                        <h3 className="font-medium text-lg truncate">
                                            {folder.name}
                                        </h3>
                                        <Badge variant="secondary" className="ml-auto">
                                            <Users className="h-3 w-3 mr-1" />
                                            {folder.hostCount} host(s)
                                        </Badge>
                                    </div>
                                </div>
                                <div className="flex gap-1 flex-shrink-0 ml-2">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleRename(folder)}
                                        className="h-8 w-8 p-0"
                                        title="Rename folder"
                                        disabled={renameLoading}
                                    >
                                        {renameLoading ? (
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                                        ) : (
                                            <Edit className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <p className="text-sm text-muted-foreground mb-2">
                                    Hosts using this folder:
                                </p>
                                <div className="grid grid-cols-1 gap-1 max-h-32 overflow-y-auto">
                                    {folder.hosts.slice(0, 5).map((host) => (
                                        <div key={host.id} className="flex items-center gap-2 text-sm bg-muted/20 rounded px-2 py-1">
                                            <span className="font-medium">
                                                {host.name || host.ip}
                                            </span>
                                            {host.name && (
                                                <span className="text-muted-foreground">
                                                    ({host.ip})
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                    {folder.hosts.length > 5 && (
                                        <div className="text-sm text-muted-foreground px-2 py-1">
                                            ... and {folder.hosts.length - 5} more host(s)
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </ScrollArea>

        </div>
    );
}