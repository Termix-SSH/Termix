import React, { useState, useEffect, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
    Search, 
    Key, 
    Folder,
    Edit,
    Trash2,
    Shield,
    Pin,
    Tag,
    Info
} from 'lucide-react';
import { getCredentials, deleteCredential } from '@/ui/main-axios';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {CredentialEditor} from './CredentialEditor';
import CredentialViewer from './CredentialViewer';

interface Credential {
    id: number;
    name: string;
    description?: string;
    folder?: string;
    tags: string[];
    authType: 'password' | 'key';
    username: string;
    keyType?: string;
    usageCount: number;
    lastUsed?: string;
    createdAt: string;
    updatedAt: string;
}

interface CredentialsManagerProps {
    onEditCredential?: (credential: Credential) => void;
}

export function CredentialsManager({ onEditCredential }: CredentialsManagerProps) {
    const { t } = useTranslation();
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showViewer, setShowViewer] = useState(false);
    const [viewingCredential, setViewingCredential] = useState<Credential | null>(null);

    useEffect(() => {
        fetchCredentials();
    }, []);

    const fetchCredentials = async () => {
        try {
            setLoading(true);
            const data = await getCredentials();
            setCredentials(data);
            setError(null);
        } catch (err) {
            setError(t('credentials.failedToFetchCredentials'));
        } finally {
            setLoading(false);
        }
    };



    const handleEdit = (credential: Credential) => {
        if (onEditCredential) {
            onEditCredential(credential);
        }
    };


    const handleDelete = async (credentialId: number, credentialName: string) => {
        if (window.confirm(t('credentials.confirmDeleteCredential', { name: credentialName }))) {
            try {
                await deleteCredential(credentialId);
                toast.success(t('credentials.credentialDeletedSuccessfully', { name: credentialName }));
                await fetchCredentials();
                window.dispatchEvent(new CustomEvent('credentials:changed'));
            } catch (err) {
                toast.error(t('credentials.failedToDeleteCredential'));
            }
        }
    };









    const filteredAndSortedCredentials = useMemo(() => {
        let filtered = credentials;

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = credentials.filter(credential => {
                const searchableText = [
                    credential.name || '',
                    credential.username,
                    credential.description || '',
                    ...(credential.tags || []),
                    credential.authType,
                    credential.keyType || ''
                ].join(' ').toLowerCase();
                return searchableText.includes(query);
            });
        }

        return filtered.sort((a, b) => {
            const aName = a.name || a.username;
            const bName = b.name || b.username;
            return aName.localeCompare(bName);
        });
    }, [credentials, searchQuery]);

    const credentialsByFolder = useMemo(() => {
        const grouped: { [key: string]: Credential[] } = {};

        filteredAndSortedCredentials.forEach(credential => {
            const folder = credential.folder || t('credentials.uncategorized');
            if (!grouped[folder]) {
                grouped[folder] = [];
            }
            grouped[folder].push(credential);
        });

        const sortedFolders = Object.keys(grouped).sort((a, b) => {
            if (a === t('credentials.uncategorized')) return -1;
            if (b === t('credentials.uncategorized')) return 1;
            return a.localeCompare(b);
        });

        const sortedGrouped: { [key: string]: Credential[] } = {};
        sortedFolders.forEach(folder => {
            sortedGrouped[folder] = grouped[folder];
        });

        return sortedGrouped;
    }, [filteredAndSortedCredentials, t]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                    <p className="text-muted-foreground">{t('credentials.loadingCredentials')}</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <p className="text-red-500 mb-4">{error}</p>
                    <Button onClick={fetchCredentials} variant="outline">
                        {t('credentials.retry')}
                    </Button>
                </div>
            </div>
        );
    }

    if (credentials.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <Key className="h-12 w-12 text-muted-foreground mx-auto mb-4"/>
                    <h3 className="text-lg font-semibold mb-2">{t('credentials.noCredentials')}</h3>
                    <p className="text-muted-foreground mb-4">
                        {t('credentials.noCredentialsMessage')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h2 className="text-xl font-semibold">{t('credentials.sshCredentials')}</h2>
                    <p className="text-muted-foreground">
                        {t('credentials.credentialsCount', { count: filteredAndSortedCredentials.length })}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={fetchCredentials} variant="outline" size="sm">
                        {t('credentials.refresh')}
                    </Button>
                </div>
            </div>

            <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                <Input
                    placeholder={t('placeholders.searchCredentials')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                />
            </div>

            <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-2 pb-20">
                    {Object.entries(credentialsByFolder).map(([folder, folderCredentials]) => (
                        <div key={folder} className="border rounded-md">
                            <Accordion type="multiple" defaultValue={Object.keys(credentialsByFolder)}>
                                <AccordionItem value={folder} className="border-none">
                                    <AccordionTrigger
                                        className="px-2 py-1 bg-muted/20 border-b hover:no-underline rounded-t-md">
                                        <div className="flex items-center gap-2">
                                            <Folder className="h-4 w-4"/>
                                            <span className="font-medium">{folder}</span>
                                            <Badge variant="secondary" className="text-xs">
                                                {folderCredentials.length}
                                            </Badge>
                                        </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="p-2">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                            {folderCredentials.map((credential) => (
                                                <div
                                                    key={credential.id}
                                                    className="bg-[#222225] border border-input rounded cursor-pointer hover:shadow-md transition-shadow p-2"
                                                    onClick={() => handleEdit(credential)}
                                                >
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1">
                                                                <h3 className="font-medium truncate text-sm">
                                                                    {credential.name || `${credential.username}`}
                                                                </h3>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {credential.username}
                                                            </p>
                                                            <p className="text-xs text-muted-foreground truncate">
                                                                {credential.authType === 'password' ? t('credentials.password') : t('credentials.sshKey')}
                                                            </p>
                                                        </div>
                                                        <div className="flex gap-1 flex-shrink-0 ml-1">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEdit(credential);
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
                                                                    handleDelete(credential.id, credential.name || credential.username);
                                                                }}
                                                                className="h-5 w-5 p-0 text-red-500 hover:text-red-700"
                                                            >
                                                                <Trash2 className="h-3 w-3"/>
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    <div className="mt-2 space-y-1">
                                                        {credential.tags && credential.tags.length > 0 && (
                                                            <div className="flex flex-wrap gap-1">
                                                                {credential.tags.slice(0, 6).map((tag, index) => (
                                                                    <Badge key={index} variant="outline"
                                                                           className="text-xs px-1 py-0">
                                                                        <Tag className="h-2 w-2 mr-0.5"/>
                                                                        {tag}
                                                                    </Badge>
                                                                ))}
                                                                {credential.tags.length > 6 && (
                                                                    <Badge variant="outline"
                                                                           className="text-xs px-1 py-0">
                                                                        +{credential.tags.length - 6}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="flex flex-wrap gap-1">
                                                            <Badge variant="outline" className="text-xs px-1 py-0">
                                                                {credential.authType === 'password' ? (
                                                                    <Key className="h-2 w-2 mr-0.5"/>
                                                                ) : (
                                                                    <Shield className="h-2 w-2 mr-0.5"/>
                                                                )}
                                                                {credential.authType}
                                                            </Badge>
                                                            {credential.authType === 'key' && credential.keyType && (
                                                                <Badge variant="outline" className="text-xs px-1 py-0">
                                                                    {credential.keyType}
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

            {showViewer && viewingCredential && (
                <CredentialViewer
                    credential={viewingCredential}
                    onClose={() => setShowViewer(false)}
                    onEdit={() => {
                        setShowViewer(false);
                        handleEdit(viewingCredential);
                    }}
                />
            )}
        </div>
    );
}