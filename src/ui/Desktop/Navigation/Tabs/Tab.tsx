import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  Home,
  SeparatorVertical,
  X,
  Terminal as TerminalIcon,
  Server as ServerIcon,
  Folder as FolderIcon,
  User as UserIcon,
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
  isDragging?: boolean;
  isDragOver?: boolean;
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
  disableClose = false,
  isDragging = false,
  isDragOver = false,
}: TabProps): React.ReactElement {
  const { t } = useTranslation();

  // Firefox-style tab classes using cn utility
  const tabBaseClasses = cn(
    "relative flex items-center gap-1.5 px-3 min-w-fit max-w-[200px]",
    "rounded-t-lg border-t-2 border-l-2 border-r-2",
    "transition-all duration-150 h-[42px]",
    isDragOver &&
      "bg-background/40 text-muted-foreground border-border opacity-60",
    isDragging && "opacity-70",
    !isDragOver &&
      !isDragging &&
      isActive &&
      "bg-background text-foreground border-border z-10",
    !isDragOver &&
      !isDragging &&
      !isActive &&
      "bg-background/80 text-muted-foreground border-border hover:bg-background/90",
  );

  if (tabType === "home") {
    return (
      <div
        className={tabBaseClasses}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid white" : "none",
        }}
      >
        <Home className="h-4 w-4" />
      </div>
    );
  }

  if (
    tabType === "terminal" ||
    tabType === "server" ||
    tabType === "file_manager" ||
    tabType === "user_profile"
  ) {
    const isServer = tabType === "server";
    const isFileManager = tabType === "file_manager";
    const isUserProfile = tabType === "user_profile";

    const displayTitle =
      title ||
      (isServer
        ? t("nav.serverStats")
        : isFileManager
          ? t("nav.fileManager")
          : isUserProfile
            ? t("nav.userProfile")
            : t("nav.terminal"));

    return (
      <div
        className={tabBaseClasses}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid white" : "none",
        }}
      >
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0"
          onClick={!disableActivate ? onActivate : undefined}
        >
          {isServer ? (
            <ServerIcon className="h-4 w-4 flex-shrink-0" />
          ) : isFileManager ? (
            <FolderIcon className="h-4 w-4 flex-shrink-0" />
          ) : isUserProfile ? (
            <UserIcon className="h-4 w-4 flex-shrink-0" />
          ) : (
            <TerminalIcon className="h-4 w-4 flex-shrink-0" />
          )}
          <span className="truncate text-sm">{displayTitle}</span>
        </div>

        {canSplit && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableSplit && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableSplit && onSplit) onSplit();
            }}
            disabled={disableSplit}
            title={
              disableSplit ? t("nav.cannotSplitTab") : t("nav.splitScreen")
            }
          >
            <SeparatorVertical className="h-4 w-4" />
          </Button>
        )}

        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableClose && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableClose && onClose) onClose();
            }}
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (tabType === "ssh_manager") {
    return (
      <div
        className={tabBaseClasses}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid white" : "none",
        }}
      >
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0"
          onClick={!disableActivate ? onActivate : undefined}
        >
          <span className="truncate text-sm">
            {title || t("nav.sshManager")}
          </span>
        </div>

        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableClose && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableClose && onClose) onClose();
            }}
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  if (tabType === "admin") {
    return (
      <div
        className={tabBaseClasses}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid white" : "none",
        }}
      >
        <div
          className="flex items-center gap-1.5 flex-1 min-w-0"
          onClick={!disableActivate ? onActivate : undefined}
        >
          <span className="truncate text-sm">{title || t("nav.admin")}</span>
        </div>

        {canClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6", disableClose && "opacity-50")}
            onClick={(e) => {
              e.stopPropagation();
              if (!disableClose && onClose) onClose();
            }}
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return null;
}
