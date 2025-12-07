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
  Network,
} from "lucide-react";

interface TabProps {
  tabType: string;
  title?: string;
  isActive?: boolean;
  isSplit?: boolean;
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
  isValidDropTarget?: boolean;
  isHoveredDropTarget?: boolean;
}

export function Tab({
  tabType,
  title,
  isActive,
  isSplit = false,
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
  isValidDropTarget = false,
  isHoveredDropTarget = false,
}: TabProps): React.ReactElement {
  const { t } = useTranslation();

  const tabBaseClasses = cn(
    "relative flex items-center gap-1.5 px-3 w-full min-w-0",
    "rounded-t-lg border-t-2 border-l-2 border-r-2",
    "transition-all duration-150 h-[42px]",
    isDragOver &&
      "bg-background/40 text-muted-foreground border-border opacity-60",
    isDragging && "opacity-70",
    isHoveredDropTarget &&
      "bg-blue-500/20 border-blue-500 ring-2 ring-blue-500/50",
    !isHoveredDropTarget &&
      isValidDropTarget &&
      "border-blue-400/50 bg-background/90",
    !isDragOver &&
      !isDragging &&
      !isValidDropTarget &&
      !isHoveredDropTarget &&
      isActive &&
      "bg-background text-foreground border-border z-10",
    !isDragOver &&
      !isDragging &&
      !isValidDropTarget &&
      !isHoveredDropTarget &&
      !isActive &&
      "bg-background/80 text-muted-foreground border-border hover:bg-background/90",
  );

  const splitTitle = (fullTitle: string): { base: string; suffix: string } => {
    const match = fullTitle.match(/^(.*?)(\s*\(\d+\))$/);
    if (match) {
      return { base: match[1], suffix: match[2] };
    }
    return { base: fullTitle, suffix: "" };
  };

  if (tabType === "home") {
    return (
      <div
        className={cn(
          "relative flex items-center gap-1.5 px-3 flex-shrink-0 cursor-pointer",
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
        )}
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

    const { base, suffix } = splitTitle(displayTitle);

    return (
      <div
        className={cn(tabBaseClasses, "cursor-pointer")}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive || isSplit ? "2px solid white" : "none",
        }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {isServer ? (
            <ServerIcon className="h-4 w-4 flex-shrink-0" />
          ) : isFileManager ? (
            <FolderIcon className="h-4 w-4 flex-shrink-0" />
          ) : isUserProfile ? (
            <UserIcon className="h-4 w-4 flex-shrink-0" />
          ) : (
            <TerminalIcon className="h-4 w-4 flex-shrink-0" />
          )}
          <span className="truncate text-sm flex-1 min-w-0">{base}</span>
          {suffix && <span className="text-sm flex-shrink-0">{suffix}</span>}
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
            <SeparatorVertical
              className={cn(
                "h-4 w-4",
                isSplit ? "text-white" : "text-muted-foreground",
              )}
            />
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
    const displayTitle = title || t("nav.sshManager");
    const { base, suffix } = splitTitle(displayTitle);

    return (
      <div
        className={cn(tabBaseClasses, "cursor-pointer")}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid white" : "none",
        }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="truncate text-sm flex-1 min-w-0">{base}</span>
          {suffix && <span className="text-sm flex-shrink-0">{suffix}</span>}
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
    const displayTitle = title || t("nav.admin");
    const { base, suffix } = splitTitle(displayTitle);

    return (
      <div
        className={cn(tabBaseClasses, "cursor-pointer")}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid white" : "none",
        }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="truncate text-sm flex-1 min-w-0">{base}</span>
          {suffix && <span className="text-sm flex-shrink-0">{suffix}</span>}
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

  if (tabType === "network_graph") {
    const displayTitle = title || "Network Graph";
    const { base, suffix } = splitTitle(displayTitle);

    return (
      <div
        className={cn(tabBaseClasses, "cursor-pointer")}
        onClick={!disableActivate ? onActivate : undefined}
        style={{
          marginBottom: "-2px",
          borderBottom: isActive ? "2px solid white" : "none",
        }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Network className="h-4 w-4 flex-shrink-0" />
          <span className="truncate text-sm flex-1 min-w-0">{base}</span>
          {suffix && <span className="text-sm flex-shrink-0">{suffix}</span>}
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
