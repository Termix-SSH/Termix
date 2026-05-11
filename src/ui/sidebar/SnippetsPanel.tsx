import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getSnippets,
  createSnippet as apiCreateSnippet,
  deleteSnippet as apiDeleteSnippet,
} from "@/main-axios";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Separator } from "@/components/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import {
  Box,
  ChevronDown,
  Copy,
  Cpu,
  Database,
  Folder,
  Globe,
  Network,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  Share2,
  Terminal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { FOLDER_COLORS } from "@/lib/theme";
import { FOLDER_ICONS } from "@/types/ui-types";
import type {
  Snippet,
  SnippetFolder,
  FolderIconId,
  Tab,
} from "@/types/ui-types";

function FolderIconEl({
  icon,
  className,
  style,
}: {
  icon: FolderIconId;
  className?: string;
  style?: React.CSSProperties;
}) {
  const props = { className, style };
  switch (icon) {
    case "folder":
      return <Folder {...props} />;
    case "server":
      return <Server {...props} />;
    case "cloud":
      return (
        <div {...props}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={className}
            style={style}
          >
            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          </svg>
        </div>
      );
    case "database":
      return <Database {...props} />;
    case "box":
      return <Box {...props} />;
    case "network":
      return <Network {...props} />;
    case "copy":
      return <Copy {...props} />;
    case "settings":
      return <Settings {...props} />;
    case "cpu":
      return <Cpu {...props} />;
    case "globe":
      return <Globe {...props} />;
  }
}

function CreateSnippetDialog({
  open,
  onOpenChange,
  folders,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folders: SnippetFolder[];
  onCreate: (s: Omit<Snippet, "id">) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [command, setCommand] = useState("");

  function handleCreate() {
    if (!name.trim() || !command.trim()) return;
    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      command: command.trim(),
      folderId,
    });
    setName("");
    setDescription("");
    setFolderId(null);
    setCommand("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("newUi.sidebar.snippets.createSnippetTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("newUi.sidebar.snippets.createSnippetDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.snippets.nameLabel")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <Input
              placeholder={t("newUi.sidebar.snippets.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("newUi.sidebar.snippets.descriptionLabel")}{" "}
              <span className="font-normal">
                ({t("newUi.sidebar.snippets.optional")})
              </span>
            </label>
            <Input
              placeholder={t("newUi.sidebar.snippets.descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Folder className="size-3.5" />
              {t("newUi.sidebar.snippets.folderLabel")}{" "}
              <span className="font-normal">
                ({t("newUi.sidebar.snippets.optional")})
              </span>
            </label>
            <select
              value={folderId ?? ""}
              onChange={(e) =>
                setFolderId(
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              className="px-3 py-2 text-sm bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t("newUi.sidebar.snippets.noFolder")}</option>
              {folders
                .filter((f) => f.name !== "Uncategorized")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.snippets.commandLabel")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <textarea
              placeholder={t("newUi.sidebar.snippets.commandPlaceholder")}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-full h-36 px-3 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("newUi.sidebar.snippets.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleCreate}
          >
            {t("newUi.sidebar.snippets.createSnippetButton")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateFolderDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (f: Omit<SnippetFolder, "id" | "open">) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]);
  const [icon, setIcon] = useState<FolderIconId>("folder");

  function handleCreate() {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), color, icon });
    setName("");
    setColor(FOLDER_COLORS[0]);
    setIcon("folder");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("newUi.sidebar.snippets.createFolderTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("newUi.sidebar.snippets.createFolderDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.snippets.folderNameLabel")}{" "}
              <span className="text-accent-brand">*</span>
            </label>
            <Input
              placeholder={t("newUi.sidebar.snippets.folderNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.snippets.folderColorLabel")}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-10 transition-all ${color === c ? "ring-2 ring-offset-2 ring-offset-background ring-white/50" : "opacity-75 hover:opacity-100"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.snippets.folderIconLabel")}
            </label>
            <div className="grid grid-cols-5 gap-2">
              {FOLDER_ICONS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setIcon(ic)}
                  className={`flex items-center justify-center h-11 border transition-colors ${
                    icon === ic
                      ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                  }`}
                >
                  <FolderIconEl icon={ic} className="size-5" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("newUi.sidebar.snippets.previewLabel")}
            </label>
            <div className="flex items-center gap-2 px-3 py-3 border border-border bg-muted/20">
              <FolderIconEl
                icon={icon}
                className="size-4 shrink-0"
                style={{ color }}
              />
              <span className="text-sm font-semibold">
                {name || t("newUi.sidebar.snippets.folderNameFallback")}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("newUi.sidebar.snippets.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleCreate}
          >
            {t("newUi.sidebar.snippets.createFolderButton")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SnippetsPanel({
  terminalTabs,
  activeTabId,
}: {
  terminalTabs: Tab[];
  activeTabId: string;
}) {
  const { t } = useTranslation();
  const [snippetSearch, setSnippetSearch] = useState("");
  const [folders, setFolders] = useState<SnippetFolder[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);

  useEffect(() => {
    getSnippets()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: Snippet[] = arr.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          command: s.command,
          folderId: s.folderId ?? null,
        }));
        setSnippets(mapped);
      })
      .catch(() => {});
  }, []);
  const [createSnippetOpen, setCreateSnippetOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(
    () =>
      new Set(
        activeTabId && terminalTabs.some((t) => t.id === activeTabId)
          ? [activeTabId]
          : [],
      ),
  );

  function toggleTab(id: string) {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleCreateSnippet(s: Omit<Snippet, "id">) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = (await apiCreateSnippet(s as any)) as any;
      setSnippets((prev) => [
        ...prev,
        { ...s, id: created.id ?? Math.max(0, ...prev.map((x) => x.id)) + 1 },
      ]);
      toast.success("Snippet created successfully");
    } catch {
      toast.error("Failed to create snippet");
    }
  }

  function handleCreateFolder(f: Omit<SnippetFolder, "id" | "open">) {
    const id = Math.max(0, ...folders.map((x) => x.id)) + 1;
    setFolders((prev) => [...prev, { ...f, id, open: true }]);
    toast.success("Folder created successfully");
  }

  function toggleFolder(id: number) {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, open: !f.open } : f)),
    );
  }

  async function deleteSnippet(id: number) {
    try {
      await apiDeleteSnippet(id);
      setSnippets((prev) => prev.filter((s) => s.id !== id));
    } catch {
      toast.error("Failed to delete snippet");
    }
  }

  const filtered = snippetSearch
    ? snippets.filter(
        (s) =>
          s.name.toLowerCase().includes(snippetSearch.toLowerCase()) ||
          s.command.toLowerCase().includes(snippetSearch.toLowerCase()),
      )
    : snippets;

  const namedFolders = folders.filter((f) => f.name !== "Uncategorized");
  const uncategorized = folders.find((f) => f.name === "Uncategorized");
  const allFolders = [
    ...namedFolders,
    ...(uncategorized ? [uncategorized] : []),
  ];

  return (
    <>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">
              {t("newUi.sidebar.snippets.targetTerminals")}{" "}
              <span className="text-muted-foreground font-normal">
                ({t("newUi.sidebar.snippets.optional")})
              </span>
            </span>
            {terminalTabs.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setSelectedTabIds(new Set(terminalTabs.map((t) => t.id)))
                  }
                  className="text-[10px] text-accent-brand hover:text-accent-brand/70"
                >
                  {t("newUi.sidebar.snippets.selectAll")}
                </button>
                <button
                  onClick={() => setSelectedTabIds(new Set())}
                  className="text-[10px] text-accent-brand hover:text-accent-brand/70"
                >
                  {t("newUi.sidebar.snippets.selectNone")}
                </button>
              </div>
            )}
          </div>
          {terminalTabs.length === 0 ? (
            <div className="flex items-center gap-1.5 px-2.5 py-2 border border-dashed border-border/60 text-muted-foreground/40">
              <Terminal className="size-3 shrink-0" />
              <span className="text-xs">
                {t("newUi.sidebar.snippets.noTerminalTabsOpen")}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {terminalTabs.map((tab) => {
                const selected = selectedTabIds.has(tab.id);
                return (
                  <button
                    key={tab.id}
                    onClick={() => toggleTab(tab.id)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 border text-left transition-colors ${
                      selected
                        ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                    }`}
                  >
                    <div
                      className={`size-3 border-2 flex items-center justify-center shrink-0 transition-colors ${
                        selected
                          ? "border-accent-brand bg-accent-brand"
                          : "border-border/60"
                      }`}
                    >
                      {selected && <div className="size-1.5 bg-background" />}
                    </div>
                    <Terminal className="size-3 shrink-0 opacity-60" />
                    <span className="text-xs font-medium truncate flex-1">
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Separator />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder={t("newUi.sidebar.snippets.searchPlaceholder")}
            value={snippetSearch}
            onChange={(e) => setSnippetSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-2 min-w-0">
          <Button
            variant="outline"
            className="flex-1 text-xs min-w-0 overflow-hidden"
            onClick={() => setCreateSnippetOpen(true)}
          >
            <Plus className="size-3.5 shrink-0" />
            {t("newUi.sidebar.snippets.newSnippet")}
          </Button>
          <Button
            variant="outline"
            className="flex-1 text-xs min-w-0 overflow-hidden"
            onClick={() => setCreateFolderOpen(true)}
          >
            <Folder className="size-3.5 shrink-0" />
            {t("newUi.sidebar.snippets.newFolder")}
          </Button>
        </div>
        <div className="flex flex-col gap-4">
          {allFolders.map((folder) => {
            const folderSnippets = filtered.filter((s) =>
              folder.name === "Uncategorized"
                ? s.folderId === null || s.folderId === folder.id
                : s.folderId === folder.id,
            );
            if (folderSnippets.length === 0 && snippetSearch) return null;
            return (
              <div key={folder.id} className="flex flex-col gap-2">
                <button
                  onClick={() => toggleFolder(folder.id)}
                  className="flex items-center gap-1.5 w-full text-left"
                >
                  <ChevronDown
                    className={`size-3 text-muted-foreground shrink-0 transition-transform ${folder.open ? "" : "-rotate-90"}`}
                  />
                  <FolderIconEl
                    icon={folder.icon}
                    className="size-3.5 shrink-0"
                    style={{ color: folder.color }}
                  />
                  <span
                    className="text-xs font-semibold flex-1 truncate"
                    style={{
                      color:
                        folder.name === "Uncategorized"
                          ? undefined
                          : folder.color,
                    }}
                  >
                    {folder.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {folderSnippets.length}
                  </span>
                </button>
                {folder.open && (
                  <div className="flex flex-col gap-2 ml-1">
                    {folderSnippets.map((snippet) => (
                      <div
                        key={snippet.id}
                        className="border border-border bg-background p-2.5 flex flex-col gap-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="grid grid-cols-2 gap-px mt-0.5 shrink-0 opacity-30">
                            <div className="size-1 bg-muted-foreground rounded-full" />
                            <div className="size-1 bg-muted-foreground rounded-full" />
                            <div className="size-1 bg-muted-foreground rounded-full" />
                            <div className="size-1 bg-muted-foreground rounded-full" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold">
                              {snippet.name}
                            </span>
                            {snippet.description && (
                              <span className="text-xs text-muted-foreground">
                                {snippet.description}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono px-1">
                          {snippet.command}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 text-xs h-7 gap-1.5"
                          >
                            <Play className="size-3" />
                            {t("newUi.sidebar.snippets.run")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <Copy className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => deleteSnippet(snippet.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <Share2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {folderSnippets.length === 0 && (
                      <span className="text-xs text-muted-foreground/60 pl-1">
                        {t("newUi.sidebar.snippets.noSnippetsInFolder")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CreateSnippetDialog
        open={createSnippetOpen}
        onOpenChange={setCreateSnippetOpen}
        folders={folders}
        onCreate={handleCreateSnippet}
      />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onCreate={handleCreateFolder}
      />
    </>
  );
}
