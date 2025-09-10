import React, {useState, useRef, useEffect} from 'react';
import {Button} from '@/components/ui/button.tsx';
import {Input} from '@/components/ui/input.tsx';
import {Card} from '@/components/ui/card.tsx';
import {Separator} from '@/components/ui/separator.tsx';
import {
    Upload,
    FilePlus,
    FolderPlus,
    Trash2,
    Edit3,
    X,
    Check,
    AlertCircle,
    FileText,
    Folder
} from 'lucide-react';
import {cn} from '@/lib/utils.ts';
import {useTranslation} from 'react-i18next';
import type { FileManagerOperationsProps } from '../../../types/index.js';

export function FileManagerOperations({
                                          currentPath,
                                          sshSessionId,
                                          onOperationComplete,
                                          onError,
                                          onSuccess
                                      }: FileManagerOperationsProps) {
    const {t} = useTranslation();
    const [showUpload, setShowUpload] = useState(false);
    const [showCreateFile, setShowCreateFile] = useState(false);
    const [showCreateFolder, setShowCreateFolder] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [showRename, setShowRename] = useState(false);

    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [newFileName, setNewFileName] = useState('');
    const [newFolderName, setNewFolderName] = useState('');
    const [deletePath, setDeletePath] = useState('');
    const [deleteIsDirectory, setDeleteIsDirectory] = useState(false);
    const [renamePath, setRenamePath] = useState('');
    const [renameIsDirectory, setRenameIsDirectory] = useState(false);
    const [newName, setNewName] = useState('');

    const [isLoading, setIsLoading] = useState(false);
    const [showTextLabels, setShowTextLabels] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const checkContainerWidth = () => {
            if (containerRef.current) {
                const width = containerRef.current.offsetWidth;
                setShowTextLabels(width > 240);
            }
        };

        checkContainerWidth();
        
        const resizeObserver = new ResizeObserver(checkContainerWidth);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    const handleFileUpload = async () => {
        if (!uploadFile || !sshSessionId) return;

        setIsLoading(true);
        
        // Show loading toast
        const {toast} = await import('sonner');
        const loadingToast = toast.loading(t('fileManager.uploadingFile', { name: uploadFile.name }));
        
        try {
            const content = await uploadFile.text();
            const {uploadSSHFile} = await import('@/ui/main-axios.ts');

            const response = await uploadSSHFile(sshSessionId, currentPath, uploadFile.name, content);
            
            // Dismiss loading toast and show success
            toast.dismiss(loadingToast);
            
            // Handle toast notification from backend
            if (response?.toast) {
                toast[response.toast.type](response.toast.message);
            } else {
                onSuccess(t('fileManager.fileUploadedSuccessfully', { name: uploadFile.name }));
            }
            
            setShowUpload(false);
            setUploadFile(null);
            onOperationComplete();
        } catch (error: any) {
            // Dismiss loading toast and show error
            toast.dismiss(loadingToast);
            onError(error?.response?.data?.error || t('fileManager.failedToUploadFile'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateFile = async () => {
        if (!newFileName.trim() || !sshSessionId) return;

        setIsLoading(true);
        
        // Show loading toast
        const {toast} = await import('sonner');
        const loadingToast = toast.loading(t('fileManager.creatingFile', { name: newFileName.trim() }));
        
        try {
            const {createSSHFile} = await import('@/ui/main-axios.ts');

            const response = await createSSHFile(sshSessionId, currentPath, newFileName.trim());
            
            // Dismiss loading toast
            toast.dismiss(loadingToast);
            
            // Handle toast notification from backend
            if (response?.toast) {
                toast[response.toast.type](response.toast.message);
            } else {
                onSuccess(t('fileManager.fileCreatedSuccessfully', { name: newFileName.trim() }));
            }
            
            setShowCreateFile(false);
            setNewFileName('');
            onOperationComplete();
        } catch (error: any) {
            // Dismiss loading toast and show error
            toast.dismiss(loadingToast);
            onError(error?.response?.data?.error || t('fileManager.failedToCreateFile'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim() || !sshSessionId) return;

        setIsLoading(true);
        
        // Show loading toast
        const {toast} = await import('sonner');
        const loadingToast = toast.loading(t('fileManager.creatingFolder', { name: newFolderName.trim() }));
        
        try {
            const {createSSHFolder} = await import('@/ui/main-axios.ts');

            const response = await createSSHFolder(sshSessionId, currentPath, newFolderName.trim());
            
            // Dismiss loading toast
            toast.dismiss(loadingToast);
            
            // Handle toast notification from backend
            if (response?.toast) {
                toast[response.toast.type](response.toast.message);
            } else {
                onSuccess(t('fileManager.folderCreatedSuccessfully', { name: newFolderName.trim() }));
            }
            
            setShowCreateFolder(false);
            setNewFolderName('');
            onOperationComplete();
        } catch (error: any) {
            // Dismiss loading toast and show error
            toast.dismiss(loadingToast);
            onError(error?.response?.data?.error || t('fileManager.failedToCreateFolder'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!deletePath || !sshSessionId) return;

        setIsLoading(true);
        
        // Show loading toast
        const {toast} = await import('sonner');
        const loadingToast = toast.loading(t('fileManager.deletingItem', { 
            type: deleteIsDirectory ? t('fileManager.folder') : t('fileManager.file'),
            name: deletePath.split('/').pop()
        }));
        
        try {
            const {deleteSSHItem} = await import('@/ui/main-axios.ts');

            const response = await deleteSSHItem(sshSessionId, deletePath, deleteIsDirectory);
            
            // Dismiss loading toast
            toast.dismiss(loadingToast);
            
            // Handle toast notification from backend
            if (response?.toast) {
                toast[response.toast.type](response.toast.message);
            } else {
                onSuccess(t('fileManager.itemDeletedSuccessfully', { type: deleteIsDirectory ? t('fileManager.folder') : t('fileManager.file') }));
            }
            
            setShowDelete(false);
            setDeletePath('');
            setDeleteIsDirectory(false);
            onOperationComplete();
        } catch (error: any) {
            // Dismiss loading toast and show error
            toast.dismiss(loadingToast);
            onError(error?.response?.data?.error || t('fileManager.failedToDeleteItem'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleRename = async () => {
        if (!renamePath || !newName.trim() || !sshSessionId) return;

        setIsLoading(true);
        
        // Show loading toast
        const {toast} = await import('sonner');
        const loadingToast = toast.loading(t('fileManager.renamingItem', { 
            type: renameIsDirectory ? t('fileManager.folder') : t('fileManager.file'),
            oldName: renamePath.split('/').pop(),
            newName: newName.trim()
        }));
        
        try {
            const {renameSSHItem} = await import('@/ui/main-axios.ts');

            const response = await renameSSHItem(sshSessionId, renamePath, newName.trim());
            
            // Dismiss loading toast
            toast.dismiss(loadingToast);
            
            // Handle toast notification from backend
            if (response?.toast) {
                toast[response.toast.type](response.toast.message);
            } else {
                onSuccess(t('fileManager.itemRenamedSuccessfully', { type: renameIsDirectory ? t('fileManager.folder') : t('fileManager.file') }));
            }
            
            setShowRename(false);
            setRenamePath('');
            setRenameIsDirectory(false);
            setNewName('');
            onOperationComplete();
        } catch (error: any) {
            // Dismiss loading toast and show error
            toast.dismiss(loadingToast);
            onError(error?.response?.data?.error || t('fileManager.failedToRenameItem'));
        } finally {
            setIsLoading(false);
        }
    };

    const openFileDialog = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setUploadFile(file);
        }
    };

    const resetStates = () => {
        setShowUpload(false);
        setShowCreateFile(false);
        setShowCreateFolder(false);
        setShowDelete(false);
        setShowRename(false);
        setUploadFile(null);
        setNewFileName('');
        setNewFolderName('');
        setDeletePath('');
        setDeleteIsDirectory(false);
        setRenamePath('');
        setRenameIsDirectory(false);
        setNewName('');
    };

    if (!sshSessionId) {
        return (
            <div className="p-4 text-center">
                <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2"/>
                <p className="text-sm text-muted-foreground">{t('fileManager.connectToSsh')}</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowUpload(true)}
                    className="h-10 bg-dark-bg border-2 border-dark-border hover:border-dark-border-hover hover:bg-dark-hover"
                    title={t('fileManager.uploadFile')}
                >
                    <Upload className={cn("w-4 h-4", showTextLabels ? "mr-2" : "")}/>
                    {showTextLabels && <span className="truncate">{t('fileManager.uploadFile')}</span>}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreateFile(true)}
                    className="h-10 bg-dark-bg border-2 border-dark-border hover:border-dark-border-hover hover:bg-dark-hover"
                    title={t('fileManager.newFile')}
                >
                    <FilePlus className={cn("w-4 h-4", showTextLabels ? "mr-2" : "")}/>
                    {showTextLabels && <span className="truncate">{t('fileManager.newFile')}</span>}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreateFolder(true)}
                    className="h-10 bg-dark-bg border-2 border-dark-border hover:border-dark-border-hover hover:bg-dark-hover"
                    title={t('fileManager.newFolder')}
                >
                    <FolderPlus className={cn("w-4 h-4", showTextLabels ? "mr-2" : "")}/>
                    {showTextLabels && <span className="truncate">{t('fileManager.newFolder')}</span>}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRename(true)}
                    className="h-10 bg-dark-bg border-2 border-dark-border hover:border-dark-border-hover hover:bg-dark-hover"
                    title={t('fileManager.rename')}
                >
                    <Edit3 className={cn("w-4 h-4", showTextLabels ? "mr-2" : "")}/>
                    {showTextLabels && <span className="truncate">{t('fileManager.rename')}</span>}
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDelete(true)}
                    className="h-10 bg-dark-bg border-2 border-dark-border hover:border-dark-border-hover hover:bg-dark-hover col-span-2"
                    title={t('fileManager.deleteItem')}
                >
                    <Trash2 className={cn("w-4 h-4", showTextLabels ? "mr-2" : "")}/>
                    {showTextLabels && <span className="truncate">{t('fileManager.deleteItem')}</span>}
                </Button>
            </div>

            <div className="bg-dark-bg-light border-2 border-dark-border-medium rounded-md p-3">
                <div className="flex items-start gap-2 text-sm">
                    <Folder className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5"/>
                    <div className="flex-1 min-w-0">
                        <span className="text-muted-foreground block mb-1">{t('fileManager.currentPath')}:</span>
                        <span className="text-white font-mono text-xs break-all leading-relaxed">{currentPath}</span>
                    </div>
                </div>
            </div>

            <Separator className="p-0.25 bg-dark-border"/>

            {showUpload && (
                <Card className="bg-dark-bg border-2 border-dark-border p-3 sm:p-4">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2 mb-1">
                                <Upload className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0"/>
                                <span className="break-words">{t('fileManager.uploadFileTitle')}</span>
                            </h3>
                            <p className="text-xs text-muted-foreground break-words">
                                {t('fileManager.maxFileSize')}
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowUpload(false)}
                            className="h-8 w-8 p-0 flex-shrink-0 ml-2"
                        >
                            <X className="w-4 h-4"/>
                        </Button>
                    </div>

                    <div className="space-y-3">
                        <div className="border-2 border-dashed border-dark-border-hover rounded-lg p-4 text-center">
                            {uploadFile ? (
                                <div className="space-y-3">
                                    <FileText className="w-12 h-12 text-blue-400 mx-auto"/>
                                    <p className="text-white font-medium text-sm break-words px-2">{uploadFile.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {(uploadFile.size / 1024).toFixed(2)} KB
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setUploadFile(null)}
                                        className="w-full text-sm h-8"
                                    >
                                        {t('fileManager.removeFile')}
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <Upload className="w-12 h-12 text-muted-foreground mx-auto"/>
                                    <p className="text-white text-sm break-words px-2">{t('fileManager.clickToSelectFile')}</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={openFileDialog}
                                        className="w-full text-sm h-8"
                                    >
                                        {t('fileManager.chooseFile')}
                                    </Button>
                                </div>
                            )}
                        </div>

                        <input
                            ref={fileInputRef}
                            type="file"
                            onChange={handleFileSelect}
                            className="hidden"
                            accept="*/*"
                        />

                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={handleFileUpload}
                                disabled={!uploadFile || isLoading}
                                className="w-full text-sm h-9"
                            >
                                {isLoading ? t('fileManager.uploading') : t('fileManager.uploadFile')}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setShowUpload(false)}
                                disabled={isLoading}
                                className="w-full text-sm h-9"
                            >
                                {t('common.cancel')}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {showCreateFile && (
                <Card className="bg-dark-bg border-2 border-dark-border p-3 sm:p-4">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base sm:text-lg font-semibold text-white flex items-center gap-2">
                                <FilePlus className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0"/>
                                <span className="break-words">{t('fileManager.createNewFile')}</span>
                            </h3>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowCreateFile(false)}
                            className="h-8 w-8 p-0 flex-shrink-0 ml-2"
                        >
                            <X className="w-4 h-4"/>
                        </Button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="text-sm font-medium text-white mb-2 block">
                                {t('fileManager.fileName')}
                            </label>
                            <Input
                                value={newFileName}
                                onChange={(e) => setNewFileName(e.target.value)}
                                placeholder={t('placeholders.fileName')}
                                className="bg-dark-bg-button border-2 border-dark-border-hover text-white text-sm"
                                onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={handleCreateFile}
                                disabled={!newFileName.trim() || isLoading}
                                className="w-full text-sm h-9"
                            >
                                {isLoading ? t('fileManager.creating') : t('fileManager.createFile')}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setShowCreateFile(false)}
                                disabled={isLoading}
                                className="w-full text-sm h-9"
                            >
                                {t('common.cancel')}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {showCreateFolder && (
                <Card className="bg-dark-bg border-2 border-dark-border p-3">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <FolderPlus className="w-6 h-6 flex-shrink-0"/>
                                <span className="break-words">{t('fileManager.createNewFolder')}</span>
                            </h3>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowCreateFolder(false)}
                            className="h-8 w-8 p-0 flex-shrink-0 ml-2"
                        >
                            <X className="w-4 h-4"/>
                        </Button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="text-sm font-medium text-white mb-2 block">
                                {t('fileManager.folderName')}
                            </label>
                            <Input
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                placeholder={t('placeholders.folderName')}
                                className="bg-dark-bg-button border-2 border-dark-border-hover text-white text-sm"
                                onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={handleCreateFolder}
                                disabled={!newFolderName.trim() || isLoading}
                                className="w-full text-sm h-9"
                            >
                                {isLoading ? t('fileManager.creating') : t('fileManager.createFolder')}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setShowCreateFolder(false)}
                                disabled={isLoading}
                                className="w-full text-sm h-9"
                            >
                                {t('common.cancel')}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {showDelete && (
                <Card className="bg-dark-bg border-2 border-dark-border p-3">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <Trash2 className="w-6 h-6 text-red-400 flex-shrink-0"/>
                                <span className="break-words">{t('fileManager.deleteItem')}</span>
                            </h3>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowDelete(false)}
                            className="h-8 w-8 p-0 flex-shrink-0 ml-2"
                        >
                            <X className="w-4 h-4"/>
                        </Button>
                    </div>

                    <div className="space-y-3">
                        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3">
                            <div className="flex items-start gap-2 text-red-300">
                                <AlertCircle className="w-5 h-5 flex-shrink-0"/>
                                <span className="text-sm font-medium break-words">{t('fileManager.warningCannotUndo')}</span>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-white mb-2 block">
                                {t('fileManager.itemPath')}
                            </label>
                            <Input
                                value={deletePath}
                                onChange={(e) => setDeletePath(e.target.value)}
                                placeholder={t('placeholders.fullPath')}
                                className="bg-dark-bg-button border-2 border-dark-border-hover text-white text-sm"
                            />
                        </div>

                        <div className="flex items-start gap-2">
                            <input
                                type="checkbox"
                                id="deleteIsDirectory"
                                checked={deleteIsDirectory}
                                onChange={(e) => setDeleteIsDirectory(e.target.checked)}
                                className="rounded border-dark-border-hover bg-dark-bg-button mt-0.5 flex-shrink-0"
                            />
                            <label htmlFor="deleteIsDirectory" className="text-sm text-white break-words">
                                {t('fileManager.thisIsDirectory')}
                            </label>
                        </div>

                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={handleDelete}
                                disabled={!deletePath || isLoading}
                                variant="destructive"
                                className="w-full text-sm h-9"
                            >
                                {isLoading ? t('fileManager.deleting') : t('fileManager.deleteItem')}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setShowDelete(false)}
                                disabled={isLoading}
                                className="w-full text-sm h-9"
                            >
                                {t('common.cancel')}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {showRename && (
                <Card className="bg-dark-bg border-2 border-dark-border p-3">
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <Edit3 className="w-6 h-6 flex-shrink-0"/>
                                <span className="break-words">{t('fileManager.renameItem')}</span>
                            </h3>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowRename(false)}
                            className="h-8 w-8 p-0 flex-shrink-0 ml-2"
                        >
                            <X className="w-4 h-4"/>
                        </Button>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="text-sm font-medium text-white mb-2 block">
                                {t('fileManager.currentPathLabel')}
                            </label>
                            <Input
                                value={renamePath}
                                onChange={(e) => setRenamePath(e.target.value)}
                                placeholder={t('placeholders.currentPath')}
                                className="bg-dark-bg-button border-2 border-dark-border-hover text-white text-sm"
                            />
                        </div>

                        <div>
                            <label className="text-sm font-medium text-white mb-2 block">
                                {t('fileManager.newName')}
                            </label>
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder={t('placeholders.newName')}
                                className="bg-dark-bg-button border-2 border-dark-border-hover text-white text-sm"
                                onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                            />
                        </div>

                        <div className="flex items-start gap-2">
                            <input
                                type="checkbox"
                                id="renameIsDirectory"
                                checked={renameIsDirectory}
                                onChange={(e) => setRenameIsDirectory(e.target.checked)}
                                className="rounded border-dark-border-hover bg-dark-bg-button mt-0.5 flex-shrink-0"
                            />
                            <label htmlFor="renameIsDirectory" className="text-sm text-white break-words">
                                {t('fileManager.thisIsDirectoryRename')}
                            </label>
                        </div>

                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={handleRename}
                                disabled={!renamePath || !newName.trim() || isLoading}
                                className="w-full text-sm h-9"
                            >
                                {isLoading ? t('fileManager.renaming') : t('fileManager.renameItem')}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setShowRename(false)}
                                disabled={isLoading}
                                className="w-full text-sm h-9"
                            >
                                {t('common.cancel')}
                            </Button>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
