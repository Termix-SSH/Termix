import React, {useState, useEffect, useRef} from "react";
import {FileManagerLeftSidebar} from "@/ui/Apps/File Manager/FileManagerLeftSidebar.tsx";
import {FileManagerTabList} from "@/ui/Apps/File Manager/FileManagerTabList.tsx";
import {FileManagerHomeView} from "@/ui/Apps/File Manager/FileManagerHomeView.tsx";
import {FileManagerFileEditor} from "@/ui/Apps/File Manager/FileManagerFileEditor.tsx";
import {FileManagerOperations} from "@/ui/Apps/File Manager/FileManagerOperations.tsx";
import {Button} from '@/components/ui/button.tsx';
import {FIleManagerTopNavbar} from "@/ui/Apps/File Manager/FIleManagerTopNavbar.tsx";
import {cn} from '@/lib/utils.ts';
import {Save, RefreshCw, Settings, Trash2} from 'lucide-react';
import {Separator} from '@/components/ui/separator.tsx';
import {toast} from 'sonner';
import {useTranslation} from 'react-i18next';
import {
    getFileManagerRecent,
    getFileManagerPinned,
    getFileManagerShortcuts,
    addFileManagerRecent,
    removeFileManagerRecent,
    addFileManagerPinned,
    removeFileManagerPinned,
    addFileManagerShortcut,
    removeFileManagerShortcut,
    readSSHFile,
    writeSSHFile,
    getSSHStatus,
    connectSSH
} from '@/ui/main-axios.ts';

interface Tab {
    id: string | number;
    title: string;
    fileName: string;
    content: string;
    isSSH?: boolean;
    sshSessionId?: string;
    filePath?: string;
    loading?: boolean;
    dirty?: boolean;
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

export function FileManager({onSelectView, embedded = false, initialHost = null}: {
    onSelectView?: (view: string) => void,
    embedded?: boolean,
    initialHost?: SSHHost | null
}): React.ReactElement {
    const {t} = useTranslation();
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTab, setActiveTab] = useState<string | number>('home');
    const [recent, setRecent] = useState<any[]>([]);
    const [pinned, setPinned] = useState<any[]>([]);
    const [shortcuts, setShortcuts] = useState<any[]>([]);

    const [currentHost, setCurrentHost] = useState<SSHHost | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const [showOperations, setShowOperations] = useState(false);
    const [currentPath, setCurrentPath] = useState('/');

    const [deletingItem, setDeletingItem] = useState<any | null>(null);

    const sidebarRef = useRef<any>(null);

    useEffect(() => {
        if (initialHost && (!currentHost || currentHost.id !== initialHost.id)) {
            setCurrentHost(initialHost);
            setTimeout(() => {
                try {
                    const path = initialHost.defaultPath || '/';
                    if (sidebarRef.current && sidebarRef.current.openFolder) {
                        sidebarRef.current.openFolder(initialHost, path);
                    }
                } catch (e) {
                }
            }, 0);
        }
    }, [initialHost]);

    useEffect(() => {
        if (currentHost) {
            fetchHomeData();
        } else {
            setRecent([]);
            setPinned([]);
            setShortcuts([]);
        }
    }, [currentHost]);

    useEffect(() => {
        if (activeTab === 'home' && currentHost) {
            fetchHomeData();
        }
    }, [activeTab, currentHost]);

    useEffect(() => {
        if (activeTab === 'home' && currentHost) {
            const interval = setInterval(() => {
                fetchHomeData();
            }, 2000);

            return () => clearInterval(interval);
        }
    }, [activeTab, currentHost]);

    async function fetchHomeData() {
        if (!currentHost) return;

        try {
            const homeDataPromise = Promise.all([
                getFileManagerRecent(currentHost.id),
                getFileManagerPinned(currentHost.id),
                getFileManagerShortcuts(currentHost.id),
            ]);

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Fetch home data timed out')), 15000)
            );

            const [recentRes, pinnedRes, shortcutsRes] = await Promise.race([homeDataPromise, timeoutPromise]) as [any, any, any];

            const recentWithPinnedStatus = (recentRes || []).map(file => ({
                ...file,
                type: 'file',
                isPinned: (pinnedRes || []).some(pinnedFile =>
                    pinnedFile.path === file.path && pinnedFile.name === file.name
                )
            }));

            const pinnedWithType = (pinnedRes || []).map(file => ({
                ...file,
                type: 'file'
            }));

            setRecent(recentWithPinnedStatus);
            setPinned(pinnedWithType);
            setShortcuts((shortcutsRes || []).map(shortcut => ({
                ...shortcut,
                type: 'directory'
            })));
        } catch (err: any) {
        }
    }

    const formatErrorMessage = (err: any, defaultMessage: string): string => {
        if (typeof err === 'object' && err !== null && 'response' in err) {
            const axiosErr = err as any;
            if (axiosErr.response?.status === 403) {
                return `${t('fileManager.permissionDenied')}. ${defaultMessage}. ${t('fileManager.checkDockerLogs')}.`;
            } else if (axiosErr.response?.status === 500) {
                const backendError = axiosErr.response?.data?.error || t('fileManager.internalServerError');
                return `${t('fileManager.serverError')} (500): ${backendError}. ${t('fileManager.checkDockerLogs')}.`;
            } else if (axiosErr.response?.data?.error) {
                const backendError = axiosErr.response.data.error;
                return `${axiosErr.response?.status ? `${t('fileManager.error')} ${axiosErr.response.status}: ` : ''}${backendError}. ${t('fileManager.checkDockerLogs')}.`;
            } else {
                return `${t('fileManager.requestFailed')} ${axiosErr.response?.status || t('fileManager.unknown')}. ${t('fileManager.checkDockerLogs')}.`;
            }
        } else if (err instanceof Error) {
            return `${err.message}. ${t('fileManager.checkDockerLogs')}.`;
        } else {
            return `${defaultMessage}. ${t('fileManager.checkDockerLogs')}.`;
        }
    };

    const handleOpenFile = async (file: any) => {
        const tabId = file.path;

        if (!tabs.find(t => t.id === tabId)) {
            const currentSshSessionId = currentHost?.id.toString();

            setTabs([...tabs, {
                id: tabId,
                title: file.name,
                fileName: file.name,
                content: '',
                filePath: file.path,
                isSSH: true,
                sshSessionId: currentSshSessionId,
                loading: true
            }]);
            try {
                const res = await readSSHFile(currentSshSessionId, file.path);
                setTabs(tabs => tabs.map(t => t.id === tabId ? {
                    ...t,
                    content: res.content,
                    loading: false,
                    error: undefined
                } : t));
                await addFileManagerRecent({
                    name: file.name,
                    path: file.path,
                    isSSH: true,
                    sshSessionId: currentSshSessionId,
                    hostId: currentHost?.id
                });
                fetchHomeData();
            } catch (err: any) {
                const errorMessage = formatErrorMessage(err, t('fileManager.cannotReadFile'));
                toast.error(errorMessage);
                setTabs(tabs => tabs.map(t => t.id === tabId ? {...t, loading: false} : t));
            }
        }
        setActiveTab(tabId);
    };

    const handleRemoveRecent = async (file: any) => {
        try {
            await removeFileManagerRecent({
                name: file.name,
                path: file.path,
                isSSH: true,
                sshSessionId: file.sshSessionId,
                hostId: currentHost?.id
            });
            fetchHomeData();
        } catch (err) {
        }
    };

    const handlePinFile = async (file: any) => {
        try {
            await addFileManagerPinned({
                name: file.name,
                path: file.path,
                isSSH: true,
                sshSessionId: file.sshSessionId,
                hostId: currentHost?.id
            });
            fetchHomeData();
            if (sidebarRef.current && sidebarRef.current.fetchFiles) {
                sidebarRef.current.fetchFiles();
            }
        } catch (err) {
        }
    };

    const handleUnpinFile = async (file: any) => {
        try {
            await removeFileManagerPinned({
                name: file.name,
                path: file.path,
                isSSH: true,
                sshSessionId: file.sshSessionId,
                hostId: currentHost?.id
            });
            fetchHomeData();
            if (sidebarRef.current && sidebarRef.current.fetchFiles) {
                sidebarRef.current.fetchFiles();
            }
        } catch (err) {
        }
    };

    const handleOpenShortcut = async (shortcut: any) => {
        if (sidebarRef.current?.isOpeningShortcut) {
            return;
        }

        if (sidebarRef.current && sidebarRef.current.openFolder) {
            try {
                sidebarRef.current.isOpeningShortcut = true;

                const normalizedPath = shortcut.path.startsWith('/') ? shortcut.path : `/${shortcut.path}`;

                await sidebarRef.current.openFolder(currentHost, normalizedPath);
            } catch (err) {
            } finally {
                if (sidebarRef.current) {
                    sidebarRef.current.isOpeningShortcut = false;
                }
            }
        } else {
        }
    };

    const handleAddShortcut = async (folderPath: string) => {
        try {
            const name = folderPath.split('/').pop() || folderPath;
            await addFileManagerShortcut({
                name,
                path: folderPath,
                isSSH: true,
                sshSessionId: currentHost?.id.toString(),
                hostId: currentHost?.id
            });
            fetchHomeData();
        } catch (err) {
        }
    };

    const handleRemoveShortcut = async (shortcut: any) => {
        try {
            await removeFileManagerShortcut({
                name: shortcut.name,
                path: shortcut.path,
                isSSH: true,
                sshSessionId: currentHost?.id.toString(),
                hostId: currentHost?.id
            });
            fetchHomeData();
        } catch (err) {
        }
    };

    const closeTab = (tabId: string | number) => {
        const idx = tabs.findIndex(t => t.id === tabId);
        const newTabs = tabs.filter(t => t.id !== tabId);
        setTabs(newTabs);
        if (activeTab === tabId) {
            if (newTabs.length > 0) setActiveTab(newTabs[Math.max(0, idx - 1)].id);
            else setActiveTab('home');
        }
        if (currentHost) {
            fetchHomeData();
        }
    };

    const setTabContent = (tabId: string | number, content: string) => {
        setTabs(tabs => tabs.map(t => t.id === tabId ? {
            ...t,
            content,
            dirty: true,
            error: undefined,
            success: undefined
        } : t));
    };

    const handleSave = async (tab: Tab) => {
        if (isSaving) {
            return;
        }

        setIsSaving(true);

        try {
            if (!tab.sshSessionId) {
                throw new Error(t('fileManager.noSshSessionId'));
            }

            if (!tab.filePath) {
                throw new Error(t('fileManager.noFilePath'));
            }

            if (!currentHost?.id) {
                throw new Error(t('fileManager.noCurrentHost'));
            }

            try {
                const statusPromise = getSSHStatus(tab.sshSessionId);
                const statusTimeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('SSH status check timed out')), 10000)
                );

                const status = await Promise.race([statusPromise, statusTimeoutPromise]) as { connected: boolean };

                if (!status.connected) {
                    const connectPromise = connectSSH(tab.sshSessionId, {
                        ip: currentHost.ip,
                        port: currentHost.port,
                        username: currentHost.username,
                        password: currentHost.password,
                        sshKey: currentHost.key,
                        keyPassword: currentHost.keyPassword
                    });
                    const connectTimeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('SSH reconnection timed out')), 15000)
                    );

                    await Promise.race([connectPromise, connectTimeoutPromise]);
                }
            } catch (statusErr) {
            }

            const savePromise = writeSSHFile(tab.sshSessionId, tab.filePath, tab.content);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => {
                    reject(new Error('Save operation timed out'));
                }, 30000)
            );

            const result = await Promise.race([savePromise, timeoutPromise]);
            setTabs(tabs => tabs.map(t => t.id === tab.id ? {
                ...t,
                loading: false
            } : t));

            toast.success(t('fileManager.fileSavedSuccessfully'));

            Promise.allSettled([
                (async () => {
                    try {
                        await addFileManagerRecent({
                            name: tab.fileName,
                            path: tab.filePath,
                            isSSH: true,
                            sshSessionId: tab.sshSessionId,
                            hostId: currentHost.id
                        });
                    } catch (recentErr) {
                    }
                })(),
                (async () => {
                    try {
                        await fetchHomeData();
                    } catch (refreshErr) {
                    }
                })()
            ]).then(() => {
            });

        } catch (err) {
            let errorMessage = formatErrorMessage(err, 'Cannot save file');

            if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
                errorMessage = t('fileManager.saveTimeout');
            }

            toast.error(`${t('fileManager.failedToSaveFile')}: ${errorMessage}`);
            setTabs(tabs => tabs.map(t => t.id === tab.id ? {
                ...t,
                loading: false
            } : t));
        } finally {
            setIsSaving(false);
        }
    };

    const handleHostChange = (_host: SSHHost | null) => {
    };

    const handleOperationComplete = () => {
        if (sidebarRef.current && sidebarRef.current.fetchFiles) {
            sidebarRef.current.fetchFiles();
        }
        if (currentHost) {
            fetchHomeData();
        }
    };

    const handleSuccess = (message: string) => {
        toast.success(message);
    };

    const handleError = (error: string) => {
        toast.error(error);
    };

    const updateCurrentPath = (newPath: string) => {
        setCurrentPath(newPath);
    };

    const handleDeleteFromSidebar = (item: any) => {
        setDeletingItem(item);
    };

    const performDelete = async (item: any) => {
        if (!currentHost?.id) return;

        try {
            const {deleteSSHItem} = await import('@/ui/main-axios.ts');
            await deleteSSHItem(currentHost.id.toString(), item.path, item.type === 'directory');
            toast.success(`${item.type === 'directory' ? t('fileManager.folder') : t('fileManager.file')} ${t('fileManager.deletedSuccessfully')}`);
            setDeletingItem(null);
            handleOperationComplete();
        } catch (error: any) {
            handleError(error?.response?.data?.error || t('fileManager.failedToDeleteItem'));
        }
    };

    if (!currentHost) {
        return (
            <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}} className="rounded-md">
                <div style={{position: 'absolute', top: 0, left: 0, width: 256, height: '100%', zIndex: 20}}>
                    <FileManagerLeftSidebar
                        onSelectView={onSelectView || (() => {
                        })}
                        onOpenFile={handleOpenFile}
                        tabs={tabs}
                        ref={sidebarRef}
                        host={initialHost as SSHHost}
                        onOperationComplete={handleOperationComplete}
                        onError={handleError}
                        onSuccess={handleSuccess}
                        onPathChange={updateCurrentPath}
                    />
                </div>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 256,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#09090b'
                }}>
                    <div className="text-center">
                        <h2 className="text-xl font-semibold text-white mb-2">{t('fileManager.connectToServer')}</h2>
                        <p className="text-muted-foreground">{t('fileManager.selectServerToEdit')}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}} className="rounded-md">
            <div style={{position: 'absolute', top: 0, left: 0, width: 256, height: '100%', zIndex: 20}}>
                <FileManagerLeftSidebar
                    onSelectView={onSelectView || (() => {
                    })}
                    onOpenFile={handleOpenFile}
                    tabs={tabs}
                    ref={sidebarRef}
                    host={currentHost as SSHHost}
                    onOperationComplete={handleOperationComplete}
                    onError={handleError}
                    onSuccess={handleSuccess}
                    onPathChange={updateCurrentPath}
                    onDeleteItem={handleDeleteFromSidebar}
                />
            </div>
            <div style={{position: 'absolute', top: 0, left: 256, right: 0, height: 50, zIndex: 30}}>
                <div className="flex items-center w-full bg-[#18181b] border-b-2 border-[#303032] h-[50px] relative">
                    <div
                        className="h-full p-1 pr-2 border-r-2 border-[#303032] w-[calc(100%-6rem)] flex items-center overflow-x-auto overflow-y-hidden gap-2 thin-scrollbar">
                        <FIleManagerTopNavbar
                            tabs={tabs.map(t => ({id: t.id, title: t.title}))}
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                            closeTab={closeTab}
                            onHomeClick={() => {
                                setActiveTab('home');
                                if (currentHost) {
                                    fetchHomeData();
                                }
                            }}
                        />
                    </div>
                    <div className="flex items-center justify-center gap-2 flex-1">
                        <Button
                            variant="outline"
                            onClick={() => setShowOperations(!showOperations)}
                            className={cn(
                                'w-[30px] h-[30px]',
                                showOperations ? 'bg-[#2d2d30] border-[#434345]' : ''
                            )}
                            title={t('fileManager.fileOperations')}
                        >
                            <Settings className="h-4 w-4"/>
                        </Button>
                        <div className="p-0.25 w-px h-[30px] bg-[#303032]"></div>
                        <Button
                            variant="outline"
                            onClick={() => {
                                const tab = tabs.find(t => t.id === activeTab);
                                if (tab && !isSaving) handleSave(tab);
                            }}
                            disabled={activeTab === 'home' || !tabs.find(t => t.id === activeTab)?.dirty || isSaving}
                            className={cn(
                                'w-[30px] h-[30px]',
                                activeTab === 'home' || !tabs.find(t => t.id === activeTab)?.dirty || isSaving ? 'opacity-60 cursor-not-allowed' : ''
                            )}
                        >
                            {isSaving ? <RefreshCw className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}
                        </Button>
                    </div>
                </div>
            </div>
            <div style={{
                position: 'absolute',
                top: 44,
                left: 256,
                right: 0,
                bottom: 0,
                overflow: 'hidden',
                zIndex: 10,
                background: '#101014',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <div className="flex h-full">
                    <div className="flex-1">
                        {activeTab === 'home' ? (
                            <FileManagerHomeView
                                recent={recent}
                                pinned={pinned}
                                shortcuts={shortcuts}
                                onOpenFile={handleOpenFile}
                                onRemoveRecent={handleRemoveRecent}
                                onPinFile={handlePinFile}
                                onUnpinFile={handleUnpinFile}
                                onOpenShortcut={handleOpenShortcut}
                                onRemoveShortcut={handleRemoveShortcut}
                                onAddShortcut={handleAddShortcut}
                            />
                        ) : (
                            (() => {
                                const tab = tabs.find(t => t.id === activeTab);
                                if (!tab) return null;
                                return (
                                    <div className="flex flex-col h-full" style={{flex: 1, minHeight: 0}}>
                                        <div className="flex-1 min-h-0">
                                            <FileManagerFileEditor
                                                content={tab.content}
                                                fileName={tab.fileName}
                                                onContentChange={content => setTabContent(tab.id, content)}
                                            />
                                        </div>
                                    </div>
                                );
                            })()
                        )}
                    </div>
                    {showOperations && (
                        <div className="w-80 border-l-2 border-[#303032] bg-[#09090b] overflow-y-auto">
                            <FileManagerOperations
                                currentPath={currentPath}
                                sshSessionId={currentHost?.id.toString() || null}
                                onOperationComplete={handleOperationComplete}
                                onError={handleError}
                                onSuccess={handleSuccess}
                            />
                        </div>
                    )}
                </div>
            </div>

            {deletingItem && (
                <div className="fixed inset-0 z-[99999]">
                    <div className="absolute inset-0 bg-black/60"></div>

                    <div className="relative h-full flex items-center justify-center">
                        <div className="bg-[#18181b] border-2 border-[#303032] rounded-lg p-6 max-w-md mx-4 shadow-2xl">
                            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                                <Trash2 className="w-5 h-5 text-red-400"/>
                                {t('fileManager.confirmDelete')}
                            </h3>
                            <p className="text-white mb-4">
                                {t('fileManager.confirmDeleteMessage', { name: deletingItem.name })}
                                {deletingItem.type === 'directory' && ` ${t('fileManager.deleteDirectoryWarning')}`}
                            </p>
                            <p className="text-red-400 text-sm mb-6">
                                {t('fileManager.actionCannotBeUndone')}
                            </p>
                            <div className="flex gap-3">
                                <Button
                                    variant="destructive"
                                    onClick={() => performDelete(deletingItem)}
                                    className="flex-1"
                                >
                                    {t('common.delete')}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setDeletingItem(null)}
                                    className="flex-1"
                                >
                                    {t('common.cancel')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}