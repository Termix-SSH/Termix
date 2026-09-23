import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePluginApi,
  useTranslation,
  useSettings,
  usePermission,
  type PanelProps,
} from "@termix/plugin-sdk/frontend";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Folder,
  FolderPlus,
  Pencil,
  Play,
  Plus,
  Search,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select2,
  Switch,
  Textarea,
} from "@termix/plugin-sdk/ui";
import { createSnippetsApi } from "./snippets-api";
import { useSnippetRunner } from "./use-snippet-runner";
import {
  errorMessage,
  FOLDER_ICONS,
  type Snippet,
  type SnippetFolder,
} from "./types";

const ROOT_FOLDER = "__root__";

interface EditState {
  id: number | null;
  name: string;
  content: string;
  description: string;
  folder: string;
  isNote: boolean;
}

const EMPTY_EDIT: EditState = {
  id: null,
  name: "",
  content: "",
  description: "",
  folder: "",
  isNote: false,
};

function groupByFolder(snippets: Snippet[]): Map<string, Snippet[]> {
  const groups = new Map<string, Snippet[]>();
  for (const snippet of snippets) {
    const key = snippet.folder || ROOT_FOLDER;
    const list = groups.get(key) ?? [];
    list.push(snippet);
    groups.set(key, list);
  }
  return groups;
}

function SnippetEditDialog({
  open,
  initial,
  folders,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: EditState;
  folders: SnippetFolder[];
  onClose: () => void;
  onSave: (state: EditState) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<EditState>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setState(initial);
  }, [open, initial]);

  const isEdit = initial.id !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? "editSnippetTitle" : "createSnippetTitle")}
          </DialogTitle>
          <DialogDescription>
            {t(isEdit ? "editSnippetDescription" : "createSnippetDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">{t("nameLabel")}</label>
            <Input
              value={state.name}
              placeholder={t("namePlaceholder")}
              onChange={(e) =>
                setState((s) => ({ ...s, name: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("descriptionLabel")}
            </label>
            <Input
              value={state.description}
              placeholder={t("descriptionPlaceholder")}
              onChange={(e) =>
                setState((s) => ({ ...s, description: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">{t("folderLabel")}</label>
            <Select2
              value={state.folder}
              onChange={(e) =>
                setState((s) => ({ ...s, folder: e.target.value }))
              }
            >
              <option value="">{t("noFolder")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.name}>
                  {f.name}
                </option>
              ))}
            </Select2>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold">{t("typeLabel")}</label>
            <div className="flex items-center gap-2 text-xs">
              <span>{t("typeCommand")}</span>
              <Switch
                checked={state.isNote}
                onCheckedChange={(checked) =>
                  setState((s) => ({ ...s, isNote: checked }))
                }
              />
              <span>{t("typeNote")}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t(state.isNote ? "noteLabel" : "commandLabel")}
            </label>
            <Textarea
              className="min-h-32 font-mono text-xs"
              value={state.content}
              placeholder={t(
                state.isNote ? "notePlaceholder" : "commandPlaceholder",
              )}
              onChange={(e) =>
                setState((s) => ({ ...s, content: e.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={saving || !state.name.trim() || !state.content.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(state);
              } finally {
                setSaving(false);
              }
            }}
          >
            {t(isEdit ? "saveSnippetButton" : "createSnippetButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderEditDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: {
    name: string;
    color: string | null;
    icon: string | null;
    isEdit: boolean;
  };
  onClose: () => void;
  onSave: (
    name: string,
    color: string | null,
    icon: string | null,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState(initial.icon ?? FOLDER_ICONS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial.name);
      setIcon(initial.icon ?? FOLDER_ICONS[0]);
    }
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t(initial.isEdit ? "editFolderTitle" : "createFolderTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("folderNameLabel")}
            </label>
            <Input
              value={name}
              placeholder={t("folderNamePlaceholder")}
              onChange={(e) => setName(e.target.value)}
              disabled={initial.isEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold">
              {t("folderIconLabel")}
            </label>
            <Select2 value={icon} onChange={(e) => setIcon(e.target.value)}>
              {FOLDER_ICONS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select2>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            disabled={saving || !name.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(name.trim(), null, icon);
              } finally {
                setSaving(false);
              }
            }}
          >
            {t(initial.isEdit ? "saveFolderButton" : "createFolderButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SnippetsPanel({ active: _active }: PanelProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const client = useMemo(() => createSnippetsApi(api), [api]);
  const canView = usePermission("view");
  const canCreate = usePermission("create");
  const canEdit = usePermission("edit");
  const canDelete = usePermission("delete");
  const { runOnActive, dialog: runnerDialog } = useSnippetRunner();

  const collapsedSetting = useSettings("user");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const defaultCollapsed = collapsedSetting.values.foldersCollapsed !== false;

  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [folders, setFolders] = useState<SnippetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [editState, setEditState] = useState<EditState | null>(null);
  const [folderEditState, setFolderEditState] = useState<{
    name: string;
    color: string | null;
    icon: string | null;
    isEdit: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [snippetList, folderList] = await Promise.all([
        client.list(),
        client.listFolders(),
      ]);
      setSnippets(snippetList);
      setFolders(folderList);
    } catch {
      toast.error(t("loading"));
    } finally {
      setLoading(false);
    }
  }, [canView, client, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return snippets;
    return snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description?.toLowerCase().includes(query),
    );
  }, [snippets, search]);

  const grouped = useMemo(() => groupByFolder(filtered), [filtered]);

  function isCollapsed(folder: string): boolean {
    if (collapsedFolders.has(folder)) return !defaultCollapsed ? false : true;
    return defaultCollapsed;
  }

  function toggleFolder(folder: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }

  async function handleSaveSnippet(state: EditState) {
    try {
      if (state.id !== null) {
        await client.update(state.id, {
          name: state.name.trim(),
          content: state.content.trim(),
          description: state.description.trim() || null,
          folder: state.folder || null,
          isNote: state.isNote,
        });
        toast.success(t("updateSuccess"));
      } else {
        await client.create({
          name: state.name.trim(),
          content: state.content.trim(),
          description: state.description.trim() || null,
          folder: state.folder || null,
          isNote: state.isNote,
        });
        toast.success(t("createSuccess"));
      }
      setEditState(null);
      await load();
    } catch (err) {
      toast.error(
        errorMessage(
          err,
          t(state.id !== null ? "updateFailed" : "createFailed"),
        ),
      );
    }
  }

  async function handleDeleteSnippet(snippet: Snippet) {
    try {
      await client.remove(snippet.id);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, t("deleteFailed")));
    }
  }

  async function handleSaveFolder(
    name: string,
    color: string | null,
    icon: string | null,
  ) {
    try {
      if (folderEditState?.isEdit) {
        await client.updateFolderMetadata(name, { color, icon });
        toast.success(t("folderEditSuccess"));
      } else {
        await client.createFolder({ name, color, icon });
        toast.success(t("folderCreateSuccess"));
      }
      setFolderEditState(null);
      await load();
    } catch (err) {
      toast.error(
        errorMessage(
          err,
          t(
            folderEditState?.isEdit ? "folderEditFailed" : "folderCreateFailed",
          ),
        ),
      );
    }
  }

  async function handleDeleteFolder(folder: SnippetFolder) {
    try {
      await client.deleteFolder(folder.name);
      toast.success(t("folderDeleteSuccess"));
      await load();
    } catch {
      toast.error(t("folderDeleteFailed"));
    }
  }

  async function handleCopy(snippet: Snippet) {
    try {
      await navigator.clipboard.writeText(snippet.content);
      toast.success(t("copySuccess"));
    } catch {
      // Clipboard access denied; nothing further to do.
    }
  }

  async function handleExport() {
    try {
      const data = await client.export();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "snippets-export.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Export failed silently; nothing to recover client-side.
    }
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await client.bulkImport({
        snippets: data.snippets,
        folders: data.folders,
        overwrite: false,
      });
      await load();
    } catch {
      toast.error(t("importFailed"));
    }
  }

  if (!canView) {
    return null;
  }

  const folderKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === ROOT_FOLDER) return -1;
    if (b === ROOT_FOLDER) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            className="pl-7 h-8"
            value={search}
            placeholder={t("searchPlaceholder")}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canCreate && (
          <>
            <Button
              size="icon"
              variant="ghost"
              title={t("newFolder")}
              onClick={() =>
                setFolderEditState({
                  name: "",
                  color: null,
                  icon: null,
                  isEdit: false,
                })
              }
            >
              <FolderPlus className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title={t("newSnippet")}
              onClick={() => setEditState({ ...EMPTY_EDIT })}
            >
              <Plus className="size-4" />
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border text-xs">
        <Button size="sm" variant="ghost" onClick={handleExport}>
          <Download className="size-3.5 mr-1" />
          {t("importExport")}
        </Button>
        <label className="inline-flex">
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="ghost" asChild>
            <span>
              <Upload className="size-3.5 mr-1" />
              {t("importExport")}
            </span>
          </Button>
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground">
            {t("loading")}
          </div>
        ) : (
          folderKeys.map((folderKey) => {
            const items = grouped.get(folderKey) ?? [];
            const folder = folders.find((f) => f.name === folderKey);
            const isRoot = folderKey === ROOT_FOLDER;
            const collapsed = isCollapsed(folderKey);

            return (
              <div key={folderKey}>
                {!isRoot && (
                  <div className="flex items-center justify-between px-2 py-1.5 hover:bg-muted/40 group">
                    <button
                      className="flex items-center gap-1.5 flex-1 text-left text-xs font-semibold"
                      onClick={() => toggleFolder(folderKey)}
                    >
                      {collapsed ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      <Folder className="size-3.5" />
                      {folderKey}
                      <Badge variant="outline" className="ml-1 text-[10px]">
                        {items.length}
                      </Badge>
                    </button>
                    {canEdit && folder && (
                      <div className="hidden group-hover:flex items-center gap-1">
                        <button
                          onClick={() =>
                            setFolderEditState({
                              name: folder.name,
                              color: folder.color,
                              icon: folder.icon,
                              isEdit: true,
                            })
                          }
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => void handleDeleteFolder(folder)}
                          >
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {!collapsed && items.length === 0 && (
                  <div className="px-4 py-2 text-xs text-muted-foreground">
                    {t("noSnippetsInFolder")}
                  </div>
                )}
                {!collapsed &&
                  items.map((snippet) => (
                    <div
                      key={snippet.id}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-muted/40 group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium truncate">
                          {snippet.name}
                          {snippet.isShared && (
                            <Badge variant="outline" className="text-[10px]">
                              {t("shareTitle")}
                            </Badge>
                          )}
                        </div>
                        {snippet.description && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {snippet.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        {!snippet.isNote && (
                          <button
                            title={t("run")}
                            onClick={() => runOnActive(snippet, null)}
                          >
                            <Play className="size-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {snippet.isNote && (
                          <button
                            title={t("pasteToTerminal")}
                            onClick={() => runOnActive(snippet, null)}
                          >
                            <Copy className="size-3.5 text-muted-foreground" />
                          </button>
                        )}
                        <button
                          title={t("copySuccess")}
                          onClick={() => void handleCopy(snippet)}
                        >
                          <Copy className="size-3.5 text-muted-foreground" />
                        </button>
                        {canEdit && !snippet.isShared && (
                          <button
                            title={t("editSnippetTitle")}
                            onClick={() =>
                              setEditState({
                                id: snippet.id,
                                name: snippet.name,
                                content: snippet.content,
                                description: snippet.description ?? "",
                                folder: snippet.folder ?? "",
                                isNote: snippet.isNote,
                              })
                            }
                          >
                            <Pencil className="size-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {!snippet.isShared && (
                          <button title={t("shareTitle")}>
                            <Share2 className="size-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {canDelete && !snippet.isShared && (
                          <button
                            title={t("deleteFailed")}
                            onClick={() => void handleDeleteSnippet(snippet)}
                          >
                            <Trash2 className="size-3.5 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between px-2 py-1.5 border-t border-border text-xs">
        <span>{t("foldersCollapsedLabel")}</span>
        <Switch
          checked={defaultCollapsed}
          onCheckedChange={(checked) => {
            setCollapsedFolders(new Set());
            void collapsedSetting.save({ foldersCollapsed: checked });
          }}
        />
      </div>

      {editState && (
        <SnippetEditDialog
          open
          initial={editState}
          folders={folders}
          onClose={() => setEditState(null)}
          onSave={handleSaveSnippet}
        />
      )}
      {folderEditState && (
        <FolderEditDialog
          open
          initial={folderEditState}
          onClose={() => setFolderEditState(null)}
          onSave={handleSaveFolder}
        />
      )}
      {runnerDialog}
    </div>
  );
}
