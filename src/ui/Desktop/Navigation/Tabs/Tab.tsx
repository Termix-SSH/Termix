import React from "react";
import {ButtonGroup} from "@/components/ui/button-group.tsx";
import {Button} from "@/components/ui/button.tsx";
import {useTranslation} from 'react-i18next';
import {
    Home,
    SeparatorVertical,
    X,
    Terminal as TerminalIcon,
    Server as ServerIcon,
    Folder as FolderIcon,
    User as UserIcon
} from "lucide-react";

interface TabProps {
    tabType: string;
    title?: string;
    isActive?: boolean;
    onActivate?: () => void;
    onClose?: () => void;
    onSplit?: () => void;
    canSplit?: boolean;
    canClose?: boolean;
    disableActivate?: boolean;
    disableSplit?: boolean;
    disableClose?: boolean;
}

export function Tab({
                        tabType,
                        title,
                        isActive,
                        onActivate,
                        onClose,
                        onSplit,
                        canSplit = false,
                        canClose = false,
                        disableActivate = false,
                        disableSplit = false,
                        disableClose = false
                    }: TabProps): React.ReactElement {
    const {t} = useTranslation();
    if (tabType === "home") {
        return (
            <Button
                variant="outline"
                className={`!px-2 border-1 border-dark-border ${isActive ? '!bg-dark-bg-active !text-white !border-dark-border-active' : ''}`}
                onClick={onActivate}
                disabled={disableActivate}
            >
                <Home/>
            </Button>
        );
    }

    if (tabType === "terminal" || tabType === "server" || tabType === "file_manager" || tabType === "user_profile") {
        const isServer = tabType === 'server';
        const isFileManager = tabType === 'file_manager';
        const isUserProfile = tabType === 'user_profile';
        return (
            <ButtonGroup>
                <Button
                    variant="outline"
                    className={`!px-2 border-1 border-dark-border ${isActive ? '!bg-dark-bg-active !text-white !border-dark-border-active' : ''}`}
                    onClick={onActivate}
                    disabled={disableActivate}
                >
                    {isServer ? <ServerIcon className="mr-1 h-4 w-4"/> : isFileManager ?
                        <FolderIcon className="mr-1 h-4 w-4"/> : isUserProfile ?
                            <UserIcon className="mr-1 h-4 w-4"/> : <TerminalIcon className="mr-1 h-4 w-4"/>}
                    {title || (isServer ? t('nav.serverStats') : isFileManager ? t('nav.fileManager') : isUserProfile ? t('nav.userProfile') : t('nav.terminal'))}
                </Button>
                {canSplit && (
                    <Button
                        variant="outline"
                        className="!px-2 border-1 border-dark-border"
                        onClick={onSplit}
                        disabled={disableSplit}
                        title={disableSplit ? t('nav.cannotSplitTab') : t('nav.splitScreen')}
                    >
                        <SeparatorVertical className="w-[28px] h-[28px]"/>
                    </Button>
                )}
                {canClose && (
                    <Button
                        variant="outline"
                        className="!px-2 border-1 border-dark-border"
                        onClick={onClose}
                        disabled={disableClose}
                    >
                        <X/>
                    </Button>
                )}
            </ButtonGroup>
        );
    }

    if (tabType === "ssh_manager") {
        return (
            <ButtonGroup>
                <Button
                    variant="outline"
                    className={`!px-2 border-1 border-dark-border ${isActive ? '!bg-dark-bg-active !text-white !border-dark-border-active' : ''}`}
                    onClick={onActivate}
                    disabled={disableActivate}
                >
                    {title || t('nav.sshManager')}
                </Button>
                <Button
                    variant="outline"
                    className="!px-2 border-1 border-dark-border"
                    onClick={onClose}
                    disabled={disableClose}
                >
                    <X/>
                </Button>
            </ButtonGroup>
        );
    }

    if (tabType === "admin") {
        return (
            <ButtonGroup>
                <Button
                    variant="outline"
                    className={`!px-2 border-1 border-dark-border ${isActive ? '!bg-dark-bg-active !text-white !border-dark-border-active' : ''}`}
                    onClick={onActivate}
                    disabled={disableActivate}
                >
                    {title || t('nav.admin')}
                </Button>
                <Button
                    variant="outline"
                    className="!px-2 border-1 border-dark-border"
                    onClick={onClose}
                    disabled={disableClose}
                >
                    <X/>
                </Button>
            </ButtonGroup>
        );
    }

    return null;
}
