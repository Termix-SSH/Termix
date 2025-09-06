import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
    Plus, 
    Search, 
    Key, 
    User, 
    Calendar, 
    Hash, 
    Folder,
    Edit3,
    Trash2,
    Copy,
    Settings,
    ChevronDown,
    ChevronRight,
    Shield,
    Clock,
    Server
} from 'lucide-react';
import { getCredentials, getCredentialFolders, deleteCredential } from '@/ui/main-axios';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import CredentialEditor from './CredentialEditor';
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

interface GroupedCredentials {
    [folder: string]: Credential[];
}

const CredentialsManager: React.FC = () => {
    const { t } = useTranslation();
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [filteredCredentials, setFilteredCredentials] = useState<Credential[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFolder, setSelectedFolder] = useState<string>('all');
    const [selectedAuthType, setSelectedAuthType] = useState<string>('all');
    const [showEditor, setShowEditor] = useState(false);
    const [showViewer, setShowViewer] = useState(false);
    const [editingCredential, setEditingCredential] = useState<Credential | null>(null);
    const [viewingCredential, setViewingCredential] = useState<Credential | null>(null);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [viewMode, setViewMode] = useState<'list' | 'folder'>('list');

    useEffect(() => {
        fetchCredentials();
    }, []);

    useEffect(() => {
        filterCredentials();
    }, [credentials, searchQuery, selectedFolder, selectedAuthType]);

    const fetchCredentials = async () => {
        try {
            const response = await getCredentials();
            setCredentials(response);
        } catch (error) {
            console.error('Failed to fetch credentials:', error);
            toast.error(t('credentials.failedToFetchCredentials'));
        } finally {
            setLoading(false);
        }
    };

    const filterCredentials = () => {
        let filtered = credentials;

        if (searchQuery) {
            filtered = filtered.filter(cred =>
                cred.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                cred.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
                cred.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                cred.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }

        if (selectedFolder !== 'all') {
            if (selectedFolder === 'none') {
                filtered = filtered.filter(cred => !cred.folder);
            } else {
                filtered = filtered.filter(cred => cred.folder === selectedFolder);
            }
        }

        if (selectedAuthType !== 'all') {
            filtered = filtered.filter(cred => cred.authType === selectedAuthType);
        }

        setFilteredCredentials(filtered);
    };

    const handleCreateCredential = () => {
        setEditingCredential(null);
        setShowEditor(true);
    };

    const handleEditCredential = (credential: Credential) => {
        setEditingCredential(credential);
        setShowEditor(true);
    };

    const handleViewCredential = (credential: Credential) => {
        setViewingCredential(credential);
        setShowViewer(true);
    };

    const handleDeleteCredential = async (credential: Credential) => {
        if (!confirm(t('credentials.confirmDeleteCredential', { name: credential.name }))) {
            return;
        }

        try {
            await deleteCredential(credential.id);
            
            toast.success(t('credentials.credentialDeletedSuccessfully'));
            fetchCredentials();
        } catch (error: any) {
            console.error('Failed to delete credential:', error);
            toast.error(error.response?.data?.error || t('credentials.failedToDeleteCredential'));
        }
    };

    const handleDuplicateCredential = (credential: Credential) => {
        const duplicated: Credential = {
            ...credential,
            id: 0, // Will be assigned by server
            name: `${credential.name} (Copy)`,
            usageCount: 0,
            lastUsed: undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        setEditingCredential(duplicated);
        setShowEditor(true);
    };

    const handleCredentialSaved = () => {
        setShowEditor(false);
        setEditingCredential(null);
        fetchCredentials();
    };

    const toggleFolder = (folder: string) => {
        const newExpanded = new Set(expandedFolders);
        if (newExpanded.has(folder)) {
            newExpanded.delete(folder);
        } else {
            newExpanded.add(folder);
        }
        setExpandedFolders(newExpanded);
    };

    const groupCredentialsByFolder = (credentials: Credential[]): GroupedCredentials => {
        const grouped: GroupedCredentials = {};
        
        credentials.forEach(credential => {
            const folder = credential.folder || t('credentials.uncategorized');
            if (!grouped[folder]) {
                grouped[folder] = [];
            }
            grouped[folder].push(credential);
        });

        return grouped;
    };

    const getUniqueValues = (field: keyof Credential): string[] => {
        const values = credentials
            .map(cred => cred[field])
            .filter((value): value is string => typeof value === 'string' && value.length > 0);
        return Array.from(new Set(values));
    };

    const renderCredentialCard = (credential: Credential) => (
        <Card key={credential.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors border-zinc-200 dark:border-zinc-700">
            <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                            {credential.authType === 'password' ? (
                                <Key className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                            ) : (
                                <Shield className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                            )}
                        </div>
                        <div>
                            <CardTitle className="text-sm font-medium">{credential.name}</CardTitle>
                            {credential.description && (
                                <CardDescription className="text-xs mt-1">
                                    {credential.description}
                                </CardDescription>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center space-x-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewCredential(credential)}
                            title={t('credentials.viewCredential')}
                        >
                            <Settings className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditCredential(credential)}
                            title={t('credentials.editCredential')}
                        >
                            <Edit3 className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDuplicateCredential(credential)}
                            title={t('credentials.duplicateCredential')}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteCredential(credential)}
                            title={t('credentials.deleteCredential')}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                <div className="space-y-3 text-sm">
                    <div className="flex items-center space-x-3">
                        <User className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                        <span className="text-zinc-700 dark:text-zinc-300 font-medium">{credential.username}</span>
                        <Badge variant="outline" className="text-xs border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400">
                            {credential.authType}
                        </Badge>
                        {credential.keyType && (
                            <Badge variant="secondary" className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                                {credential.keyType}
                            </Badge>
                        )}
                    </div>
                    
                    {credential.tags.length > 0 && (
                        <div className="flex items-center space-x-2 flex-wrap gap-1">
                            <Hash className="h-4 w-4 text-zinc-500 dark:text-zinc-400 flex-shrink-0" />
                            {credential.tags.map((tag, index) => (
                                <Badge key={index} variant="outline" className="text-xs border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400">
                                    {tag}
                                </Badge>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-zinc-200 dark:border-zinc-700">
                        <div className="flex items-center space-x-4 text-zinc-500 dark:text-zinc-400">
                            <div className="flex items-center space-x-1.5">
                                <Server className="h-3.5 w-3.5" />
                                <span className="text-xs">{credential.usageCount}</span>
                            </div>
                            {credential.lastUsed && (
                                <div className="flex items-center space-x-1.5">
                                    <Clock className="h-3.5 w-3.5" />
                                    <span className="text-xs">{new Date(credential.lastUsed).toLocaleDateString()}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center space-x-1.5 text-zinc-500 dark:text-zinc-400">
                            <Calendar className="h-3.5 w-3.5" />
                            <span className="text-xs">{new Date(credential.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );

    const renderListView = () => (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {filteredCredentials.map(renderCredentialCard)}
        </div>
    );

    const renderFolderView = () => {
        const grouped = groupCredentialsByFolder(filteredCredentials);
        
        return (
            <div className="space-y-4">
                {Object.entries(grouped).map(([folder, folderCredentials]) => (
                    <div key={folder} className="space-y-2">
                        <div 
                            className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                            onClick={() => toggleFolder(folder)}
                        >
                            {expandedFolders.has(folder) ? (
                                <ChevronDown className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                            )}
                            <Folder className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                            <span className="font-medium text-zinc-800 dark:text-zinc-200">{folder === t('credentials.uncategorized') ? t('credentials.uncategorized') : folder}</span>
                            <Badge variant="secondary" className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                                {folderCredentials.length}
                            </Badge>
                        </div>
                        
                        {expandedFolders.has(folder) && (
                            <div className="ml-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3 pt-2">
                                {folderCredentials.map(renderCredentialCard)}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-8 pb-6">
                <div className="space-y-2">
                    <h1 className="text-3xl font-bold">{t('credentials.credentialsManager')}</h1>
                    <p className="text-zinc-600 dark:text-zinc-400 text-lg">
                        {t('credentials.manageYourSSHCredentials')}
                    </p>
                </div>
                <Button onClick={handleCreateCredential} size="lg">
                    <Plus className="h-5 w-5 mr-2" />
                    {t('credentials.addCredential')}
                </Button>
            </div>

            {/* Filters */}
            <div className="px-8 pb-6">
                <Card>
                    <CardContent className="pt-8">
                        <div className="flex flex-col md:flex-row gap-6">
                        <div className="flex-1">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder={t('credentials.searchCredentials')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-10"
                                />
                            </div>
                        </div>
                        <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                            <SelectTrigger className="w-full md:w-48">
                                <SelectValue placeholder={t('credentials.selectFolder')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('credentials.allFolders')}</SelectItem>
                                <SelectItem value="none">{t('credentials.uncategorized')}</SelectItem>
                                {getUniqueValues('folder').map(folder => (
                                    <SelectItem key={folder} value={folder}>{folder}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={selectedAuthType} onValueChange={setSelectedAuthType}>
                            <SelectTrigger className="w-full md:w-48">
                                <SelectValue placeholder={t('credentials.selectAuthType')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t('credentials.allAuthTypes')}</SelectItem>
                                <SelectItem value="password">{t('common.password')}</SelectItem>
                                <SelectItem value="key">{t('credentials.sshKey')}</SelectItem>
                            </SelectContent>
                        </Select>
                        <div className="flex border rounded-md">
                            <Button
                                variant={viewMode === 'list' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setViewMode('list')}
                                className="rounded-r-none"
                            >
                                {t('credentials.listView')}
                            </Button>
                            <Button
                                variant={viewMode === 'folder' ? 'default' : 'ghost'}
                                size="sm"
                                onClick={() => setViewMode('folder')}
                                className="rounded-l-none"
                            >
                                {t('credentials.folderView')}
                            </Button>
                        </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="px-8 py-4">
                <Separator />
            </div>

            {/* Stats */}
            <div className="px-8 pb-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-center space-y-2">
                            <div className="text-3xl font-bold text-zinc-700 dark:text-zinc-300">{credentials.length}</div>
                            <div className="text-sm text-zinc-600 dark:text-zinc-400">{t('credentials.totalCredentials')}</div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-center space-y-2">
                            <div className="text-3xl font-bold text-zinc-700 dark:text-zinc-300">
                                {credentials.filter(c => c.authType === 'key').length}
                            </div>
                            <div className="text-sm text-zinc-600 dark:text-zinc-400">{t('credentials.keyBased')}</div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-center space-y-2">
                            <div className="text-3xl font-bold text-zinc-700 dark:text-zinc-300">
                                {credentials.filter(c => c.authType === 'password').length}
                            </div>
                            <div className="text-sm text-zinc-600 dark:text-zinc-400">{t('credentials.passwordBased')}</div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-center space-y-2">
                            <div className="text-3xl font-bold text-zinc-700 dark:text-zinc-300">
                                {getUniqueValues('folder').length}
                            </div>
                            <div className="text-sm text-zinc-600 dark:text-zinc-400">{t('credentials.folders')}</div>
                        </div>
                    </CardContent>
                </Card>
                </div>
            </div>

            {/* Credentials List */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-8 pb-8">
                <Card className="flex-1 flex flex-col min-h-0">
                    <CardHeader className="pb-6">
                        <CardTitle className="text-xl">
                            {t('nav.credentials')} ({filteredCredentials.length})
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col min-h-0 px-6">
                        <ScrollArea className="flex-1">
                        {filteredCredentials.length === 0 ? (
                            <div className="text-center py-16 text-zinc-500 dark:text-zinc-400">
                                {searchQuery || selectedFolder !== 'all' || selectedAuthType !== 'all' ? (
                                    <div className="space-y-4">
                                        <Search className="h-16 w-16 mx-auto text-zinc-300 dark:text-zinc-600" />
                                        <p className="text-lg">{t('credentials.noCredentialsMatchFilters')}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        <Key className="h-16 w-16 mx-auto text-zinc-300 dark:text-zinc-600" />
                                        <div className="space-y-2">
                                            <p className="text-lg font-medium">{t('credentials.noCredentialsYet')}</p>
                                            <p className="text-sm text-zinc-400">开始创建你的第一个SSH凭据</p>
                                        </div>
                                        <Button size="lg" onClick={handleCreateCredential}>
                                            <Plus className="h-5 w-5 mr-2" />
                                            {t('credentials.createFirstCredential')}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            viewMode === 'list' ? renderListView() : renderFolderView()
                        )}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>

            {/* Modals */}
            {showEditor && (
                <CredentialEditor
                    credential={editingCredential}
                    onSave={handleCredentialSaved}
                    onCancel={() => setShowEditor(false)}
                />
            )}

            {showViewer && viewingCredential && (
                <CredentialViewer
                    credential={viewingCredential}
                    onClose={() => setShowViewer(false)}
                    onEdit={() => {
                        setShowViewer(false);
                        handleEditCredential(viewingCredential);
                    }}
                />
            )}
        </div>
    );
};

export default CredentialsManager;