import React from "react";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePlus,
  Folder,
  FolderPlus,
  Grid3X3,
  Layout,
  List,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu.tsx";
import type { FileItem } from "@/types/index";

type SortBy = "name" | "modified" | "size";
type SortOrder = "asc" | "desc";
type ViewMode = "grid" | "list";

type FileManagerToolbarProps = {
  t: (key: string) => string;
  currentPath: string;
  navIndex: number;
  navHistoryLength: number;
  isLoading: boolean;
  sshSessionId: string | null;
  selectedFiles: FileItem[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  sortBy: SortBy;
  setSortBy: (sortBy: SortBy) => void;
  sortOrder: SortOrder;
  setSortOrder: (sortOrder: SortOrder) => void;
  setMobileSidebarOpen: (updater: (open: boolean) => boolean) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  navigateTo: (path: string) => void;
  handleRefreshDirectory: () => void;
  handleDeleteFiles: (files: FileItem[]) => void;
  handleCopyFiles: (files: FileItem[]) => void;
  handleFilesDropped: (fileList: FileList) => void;
  handleCreateNewFolder: () => void;
  handleCreateNewFile: () => void;
};

function Breadcrumb({
  currentPath,
  navigateTo,
  t,
}: Pick<FileManagerToolbarProps, "currentPath" | "navigateTo" | "t">) {
  return (
    <>
      <Folder className="size-3.5 text-accent-brand shrink-0" />
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">
        {currentPath.split("/").map((part, i, arr) => (
          <React.Fragment key={i}>
            {part === "" && i === 0 ? (
              <button
                onClick={() => navigateTo("/")}
                className="hover:text-accent-brand transition-colors"
              >
                {t("fileManager.root")}
              </button>
            ) : part !== "" ? (
              <button
                onClick={() => navigateTo(arr.slice(0, i + 1).join("/") || "/")}
                className="hover:text-accent-brand transition-colors"
              >
                {part}
              </button>
            ) : null}
            {i < arr.length - 1 && part !== "" && (
              <ChevronRight className="size-3 text-muted-foreground shrink-0" />
            )}
            {i === 0 && arr.length > 1 && part === "" && (
              <ChevronRight className="size-3 text-muted-foreground shrink-0" />
            )}
          </React.Fragment>
        ))}
      </div>
    </>
  );
}

export function FileManagerToolbar({
  t,
  currentPath,
  navIndex,
  navHistoryLength,
  isLoading,
  sshSessionId,
  selectedFiles,
  searchQuery,
  setSearchQuery,
  viewMode,
  setViewMode,
  sortBy,
  setSortBy,
  sortOrder,
  setSortOrder,
  setMobileSidebarOpen,
  goBack,
  goForward,
  goUp,
  navigateTo,
  handleRefreshDirectory,
  handleDeleteFiles,
  handleCopyFiles,
  handleFilesDropped,
  handleCreateNewFolder,
  handleCreateNewFile,
}: FileManagerToolbarProps) {
  return (
    <div className="flex flex-col shrink-0 mx-3 mt-3 border border-border bg-card">
      <div className="flex flex-row items-center justify-between px-3 py-2 gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileSidebarOpen((open) => !open)}
            className="md:hidden size-8 rounded-none"
            title={t("fileManager.toggleSidebar")}
          >
            <Layout className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            disabled={navIndex <= 0}
            className="size-8 rounded-none"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goForward}
            disabled={navIndex >= navHistoryLength - 1}
            className="size-8 rounded-none"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={goUp}
            disabled={currentPath === "/"}
            className="size-8 rounded-none"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefreshDirectory}
            className="size-8 rounded-none"
          >
            <RefreshCw
              className={`size-4 ${isLoading && !!sshSessionId ? "animate-spin [animation-duration:0.5s]" : ""}`}
            />
          </Button>
        </div>

        <div className="hidden md:flex flex-1 items-center px-3 h-8 bg-muted/50 border border-border rounded-none gap-2 overflow-hidden">
          <Breadcrumb currentPath={currentPath} navigateTo={navigateTo} t={t} />
        </div>

        <div className="flex items-center gap-2">
          {selectedFiles.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-accent-brand/10 border border-accent-brand/20 text-accent-brand text-[10px] font-black uppercase tracking-tighter">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-accent-brand hover:bg-accent-brand/20 rounded-none"
                onClick={() => handleDeleteFiles(selectedFiles)}
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-accent-brand hover:bg-accent-brand/20 rounded-none"
                onClick={() => handleCopyFiles(selectedFiles)}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          )}

          <div className="relative w-28 md:w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder={t("fileManager.searchFiles")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs bg-muted/50 border-border rounded-none focus:ring-1 focus:ring-accent-brand/50"
            />
          </div>

          <div className="flex items-center border border-border rounded-none overflow-hidden">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("grid")}
              className={`size-8 rounded-none border-y-0 border-l-0 border-r border-border ${viewMode === "grid" ? "bg-accent-brand/10 text-accent-brand" : ""}`}
            >
              <Grid3X3 className="size-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("list")}
              className={`size-8 rounded-none border-y-0 border-r-0 border-border ${viewMode === "list" ? "bg-accent-brand/10 text-accent-brand" : ""}`}
            >
              <List className="size-4" />
            </Button>
          </div>

          <label
            className="hidden md:block cursor-pointer"
            title={t("fileManager.upload")}
          >
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files) handleFilesDropped(files);
              }}
            />
            <div className="h-8 px-3 flex items-center gap-1.5 border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-[10px] font-bold uppercase tracking-widest">
              <Upload className="size-3.5" /> {t("fileManager.upload")}
            </div>
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none font-bold uppercase tracking-widest text-[10px]"
              >
                <Plus className="size-3.5" />
                {t("fileManager.new")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44 rounded-none border-border bg-card"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuItem
                onSelect={() => {
                  setTimeout(() => handleCreateNewFolder(), 0);
                }}
                className="rounded-none text-xs font-semibold gap-2 focus:bg-accent-brand/10 focus:text-accent-brand"
              >
                <FolderPlus className="size-4 text-accent-brand" />
                {t("fileManager.newFolder")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setTimeout(() => handleCreateNewFile(), 0);
                }}
                className="rounded-none text-xs font-semibold gap-2 focus:bg-accent-brand/10 focus:text-accent-brand"
              >
                <FilePlus className="size-4 text-muted-foreground" />
                {t("fileManager.newFile")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground py-1">
                {t("fileManager.sortBy")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortBy}
                onValueChange={(value) => setSortBy(value as SortBy)}
              >
                <DropdownMenuRadioItem
                  value="name"
                  className="rounded-none text-xs"
                >
                  {t("fileManager.sortByName")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="modified"
                  className="rounded-none text-xs"
                >
                  {t("fileManager.sortByDate")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="size"
                  className="rounded-none text-xs"
                >
                  {t("fileManager.sortBySize")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sortOrder}
                onValueChange={(value) => setSortOrder(value as SortOrder)}
              >
                <DropdownMenuRadioItem
                  value="asc"
                  className="rounded-none text-xs"
                >
                  {t("fileManager.ascending")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="desc"
                  className="rounded-none text-xs"
                >
                  {t("fileManager.descending")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="md:hidden flex items-center px-3 pb-2 gap-2">
        <div className="flex-1 flex items-center px-3 h-8 bg-muted/50 border border-border gap-2 overflow-hidden">
          <Breadcrumb currentPath={currentPath} navigateTo={navigateTo} t={t} />
        </div>
      </div>
    </div>
  );
}
