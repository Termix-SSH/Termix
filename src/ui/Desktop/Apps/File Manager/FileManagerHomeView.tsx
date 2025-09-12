import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Trash2, Folder, File, Plus, Pin } from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FileItem, ShortcutItem } from "../../../types/index";

interface FileManagerHomeViewProps {
  recent: FileItem[];
  pinned: FileItem[];
  shortcuts: ShortcutItem[];
  onOpenFile: (file: FileItem) => void;
  onRemoveRecent: (file: FileItem) => void;
  onPinFile: (file: FileItem) => void;
  onUnpinFile: (file: FileItem) => void;
  onOpenShortcut: (shortcut: ShortcutItem) => void;
  onRemoveShortcut: (shortcut: ShortcutItem) => void;
  onAddShortcut: (path: string) => void;
}

export function FileManagerHomeView({
  recent,
  pinned,
  shortcuts,
  onOpenFile,
  onRemoveRecent,
  onPinFile,
  onUnpinFile,
  onOpenShortcut,
  onRemoveShortcut,
  onAddShortcut,
}: FileManagerHomeViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"recent" | "pinned" | "shortcuts">("recent");
  const [newShortcut, setNewShortcut] = useState("");

  const renderFileCard = (
    file: FileItem,
    onRemove: () => void,
    onPin?: () => void,
    isPinned = false,
  ) => (
    <div
      key={file.path}
      className="flex items-center gap-2 px-3 py-2 bg-dark-bg border-2 border-dark-border rounded hover:border-dark-border-hover transition-colors"
    >
      <div
        className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
        onClick={() => onOpenFile(file)}
      >
        {file.type === "directory" ? (
          <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
        ) : (
          <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white break-words leading-tight">
            {file.name}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onPin && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 bg-dark-bg-button hover:bg-dark-hover rounded-md"
            onClick={onPin}
          >
            <Pin
              className={`w-3 h-3 ${isPinned ? "text-yellow-400 fill-current" : "text-muted-foreground"}`}
            />
          </Button>
        )}
        {onRemove && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 bg-dark-bg-button hover:bg-dark-hover rounded-md"
            onClick={onRemove}
          >
            <Trash2 className="w-3 h-3 text-red-500" />
          </Button>
        )}
      </div>
    </div>
  );

  const renderShortcutCard = (shortcut: ShortcutItem) => (
    <div
      key={shortcut.path}
      className="flex items-center gap-2 px-3 py-2 bg-dark-bg border-2 border-dark-border rounded hover:border-dark-border-hover transition-colors"
    >
      <div
        className="flex items-center gap-2 flex-1 cursor-pointer min-w-0"
        onClick={() => onOpenShortcut(shortcut)}
      >
        <Folder className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white break-words leading-tight">
            {shortcut.path}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 bg-dark-bg-button hover:bg-dark-hover rounded-md"
          onClick={() => onRemoveShortcut(shortcut)}
        >
          <Trash2 className="w-3 h-3 text-red-500" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="p-4 flex flex-col gap-4 h-full bg-dark-bg-darkest">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "recent" | "pinned" | "shortcuts")}
        className="w-full"
      >
        <TabsList className="mb-4 bg-dark-bg border-2 border-dark-border">
          <TabsTrigger
            value="recent"
            className="data-[state=active]:bg-dark-bg-button"
          >
            {t("fileManager.recent")}
          </TabsTrigger>
          <TabsTrigger
            value="pinned"
            className="data-[state=active]:bg-dark-bg-button"
          >
            {t("fileManager.pinned")}
          </TabsTrigger>
          <TabsTrigger
            value="shortcuts"
            className="data-[state=active]:bg-dark-bg-button"
          >
            {t("fileManager.folderShortcuts")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recent" className="mt-0">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3 auto-rows-min content-start w-full">
            {recent.length === 0 ? (
              <div className="flex items-center justify-center py-8 col-span-full">
                <span className="text-sm text-muted-foreground">
                  {t("fileManager.noRecentFiles")}
                </span>
              </div>
            ) : (
              recent.map((file) =>
                renderFileCard(
                  file,
                  () => onRemoveRecent(file),
                  () => (file.isPinned ? onUnpinFile(file) : onPinFile(file)),
                  file.isPinned,
                ),
              )
            )}
          </div>
        </TabsContent>

        <TabsContent value="pinned" className="mt-0">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3 auto-rows-min content-start w-full">
            {pinned.length === 0 ? (
              <div className="flex items-center justify-center py-8 col-span-full">
                <span className="text-sm text-muted-foreground">
                  {t("fileManager.noPinnedFiles")}
                </span>
              </div>
            ) : (
              pinned.map((file) =>
                renderFileCard(file, undefined, () => onUnpinFile(file), true),
              )
            )}
          </div>
        </TabsContent>

        <TabsContent value="shortcuts" className="mt-0">
          <div className="flex items-center gap-3 mb-4 p-3 bg-dark-bg border-2 border-dark-border rounded-lg">
            <Input
              placeholder={t("fileManager.enterFolderPath")}
              value={newShortcut}
              onChange={(e) => setNewShortcut(e.target.value)}
              className="flex-1 bg-dark-bg-button border-2 border-dark-border text-white placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newShortcut.trim()) {
                  onAddShortcut(newShortcut.trim());
                  setNewShortcut("");
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 bg-dark-bg-button border-2 !border-dark-border hover:bg-dark-hover rounded-md"
              onClick={() => {
                if (newShortcut.trim()) {
                  onAddShortcut(newShortcut.trim());
                  setNewShortcut("");
                }
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {t("common.add")}
            </Button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3 auto-rows-min content-start w-full">
            {shortcuts.length === 0 ? (
              <div className="flex items-center justify-center py-4 col-span-full">
                <span className="text-sm text-muted-foreground">
                  {t("fileManager.noShortcuts")}
                </span>
              </div>
            ) : (
              shortcuts.map((shortcut) => renderShortcutCard(shortcut))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
