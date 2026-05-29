import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getSnippets,
  createSnippet as apiCreateSnippet,
  updateSnippet as apiUpdateSnippet,
  deleteSnippet as apiDeleteSnippet,
  getSnippetFolders,
  createSnippetFolder as apiCreateSnippetFolder,
  deleteSnippetFolder as apiDeleteSnippetFolder,
  renameSnippetFolder as apiRenameSnippetFolder,
  updateSnippetFolderMetadata as apiUpdateSnippetFolderMetadata,
  shareSnippet as apiShareSnippet,
  getSnippetAccess,
  revokeSnippetAccess,
  getUserList,
  getRoles,
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
  UserPlus,
  X,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
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

function SnippetFormDialog({
  open,
  onOpenChange,
  folders,
  snippet,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folders: SnippetFolder[];
  snippet: Snippet | null;
  onSave: (data: Omit<Snippet, "id">, id?: number) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (open) {
      setName(snippet?.name ?? "");
      setDescription(snippet?.description ?? "");
      setFolder(snippet?.folder ?? null);
      setContent(snippet?.content ?? "");
    }
  }, [open, snippet]);

  function handleSave() {
    if (!name.trim() || !content.trim()) return;
    onSave(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        content: content.trim(),
        folder,
      },
      snippet?.id,
    );
    onOpenChange(false);
  }

  const isEdit = snippet !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {isEdit
              ? t("newUi.sidebar.snippets.editSnippetTitle")
              : t("newUi.sidebar.snippets.createSnippetTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isEdit
              ? t("newUi.sidebar.snippets.editSnippetDescription")
              : t("newUi.sidebar.snippets.createSnippetDescription")}
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
              value={folder ?? ""}
              onChange={(e) =>
                setFolder(e.target.value === "" ? null : e.target.value)
              }
              className="px-3 py-2 text-sm bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t("newUi.sidebar.snippets.noFolder")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.name}>
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
              value={content}
              onChange={(e) => setContent(e.target.value)}
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
            onClick={handleSave}
          >
            {isEdit
              ? t("newUi.sidebar.snippets.saveSnippetButton")
              : t("newUi.sidebar.snippets.createSnippetButton")}
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

function EditFolderDialog({
  open,
  onOpenChange,
  folder,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folder: SnippetFolder | null;
  onSave: (
    oldName: string,
    data: { name: string; color: string; icon: FolderIconId },
  ) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]);
  const [icon, setIcon] = useState<FolderIconId>("folder");

  useEffect(() => {
    if (open && folder) {
      setName(folder.name);
      setColor(folder.color ?? FOLDER_COLORS[0]);
      setIcon(folder.icon ?? "folder");
    }
  }, [open, folder]);

  function handleSave() {
    if (!name.trim() || !folder) return;
    onSave(folder.name, { name: name.trim(), color, icon });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("newUi.sidebar.snippets.editFolderTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("newUi.sidebar.snippets.editFolderDescription")}
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
            onClick={handleSave}
          >
            {t("newUi.sidebar.snippets.saveFolderButton")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AccessRecord = {
  id: number;
  targetType: "user" | "role";
  username: string | null;
  roleName: string | null;
  roleDisplayName: string | null;
  permissionLevel: string;
  expiresAt: string | null;
};

function ShareSnippetDialog({
  snippet,
  onClose,
}: {
  snippet: Snippet | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [roles, setRoles] = useState<
    { id: number; name: string; displayName?: string }[]
  >([]);
  const [accessList, setAccessList] = useState<AccessRecord[]>([]);
  const [targetType, setTargetType] = useState<"user" | "role">("user");
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!snippet) return;
    setLoading(true);
    Promise.all([getUserList(), getRoles(), getSnippetAccess(snippet.id)])
      .then(([usersData, rolesData, accessData]) => {
        setUsers(
          (usersData?.users || []).map((u: any) => ({
            id: u.id,
            username: u.username,
          })),
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setRoles((rolesData?.roles || []).map((r: any) => r));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAccessList((accessData as any).accessList || []);
      })
      .catch(() => toast.error(t("newUi.sidebar.snippets.shareLoadError")))
      .finally(() => setLoading(false));
  }, [snippet, t]);

  async function handleShare() {
    if (!snippet || !targetId) return;
    try {
      await apiShareSnippet(snippet.id, {
        targetType,
        targetUserId: targetType === "user" ? targetId : undefined,
        targetRoleId: targetType === "role" ? parseInt(targetId) : undefined,
      });
      toast.success(t("newUi.sidebar.snippets.shareSuccess"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accessData = (await getSnippetAccess(snippet.id)) as any;
      setAccessList(accessData.accessList || []);
      setTargetId("");
    } catch {
      toast.error(t("newUi.sidebar.snippets.shareFailed"));
    }
  }

  async function handleRevoke(accessId: number) {
    if (!snippet) return;
    try {
      await revokeSnippetAccess(snippet.id, accessId);
      toast.success(t("newUi.sidebar.snippets.revokeSuccess"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accessData = (await getSnippetAccess(snippet.id)) as any;
      setAccessList(accessData.accessList || []);
    } catch {
      toast.error(t("newUi.sidebar.snippets.revokeFailed"));
    }
  }

  return (
    <Dialog open={snippet !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("newUi.sidebar.snippets.shareTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {snippet?.name}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t("newUi.sidebar.snippets.loading")}
          </div>
        ) : (
          <div className="flex flex-col gap-4 mt-1">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setTargetType("user");
                  setTargetId("");
                }}
                className={`flex-1 py-1.5 text-xs border transition-colors ${targetType === "user" ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {t("newUi.sidebar.snippets.shareUser")}
              </button>
              <button
                onClick={() => {
                  setTargetType("role");
                  setTargetId("");
                }}
                className={`flex-1 py-1.5 text-xs border transition-colors ${targetType === "role" ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {t("newUi.sidebar.snippets.shareRole")}
              </button>
            </div>
            <div className="flex gap-2 items-center">
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="flex-1 px-3 py-2 text-sm bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring h-9"
              >
                <option value="">
                  {targetType === "user"
                    ? t("newUi.sidebar.snippets.selectUser")
                    : t("newUi.sidebar.snippets.selectRole")}
                </option>
                {targetType === "user"
                  ? users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))
                  : roles.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.displayName || r.name}
                      </option>
                    ))}
              </select>
              <Button
                variant="outline"
                size="lg"
                className="shrink-0 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                onClick={handleShare}
                disabled={!targetId}
              >
                <UserPlus className="size-4" />
              </Button>
            </div>
            {accessList.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("newUi.sidebar.snippets.currentAccess")}
                </span>
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                  {accessList.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between px-2.5 py-1.5 border border-border text-xs"
                    >
                      <span className="truncate">
                        {entry.targetType === "user"
                          ? entry.username
                          : entry.roleDisplayName || entry.roleName}
                        <span className="text-muted-foreground ml-1">
                          ({entry.targetType})
                        </span>
                      </span>
                      <button
                        onClick={() => handleRevoke(entry.id)}
                        className="shrink-0 text-muted-foreground hover:text-destructive ml-2"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end mt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("newUi.sidebar.snippets.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SnippetCard({
  snippet,
  selectedTabIds,
  terminalTabs,
  onDelete,
  onEdit,
  onShare,
  t,
}: {
  snippet: Snippet;
  selectedTabIds: Set<string>;
  terminalTabs: Tab[];
  onDelete: (id: number) => void;
  onEdit: (snippet: Snippet) => void;
  onShare: (snippet: Snippet) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  function handleRun() {
    const targets = terminalTabs.filter((tab) => selectedTabIds.has(tab.id));
    if (targets.length > 0) {
      targets.forEach((tab) => {
        tab.terminalRef?.current?.sendInput?.(snippet.content + "\r");
      });
      toast.success(
        t("newUi.sidebar.snippets.runSuccess", {
          name: snippet.name,
          count: targets.length,
        }),
      );
    } else if (terminalTabs.length > 0) {
      terminalTabs[0].terminalRef?.current?.sendInput?.(snippet.content + "\r");
      toast.success(
        t("newUi.sidebar.snippets.runSuccess", {
          name: snippet.name,
          count: 1,
        }),
      );
    } else {
      toast.error(t("newUi.sidebar.snippets.noTerminalTabsOpen"));
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(snippet.content);
    toast.success(
      t("newUi.sidebar.snippets.copySuccess", { name: snippet.name }),
    );
  }

  return (
    <div className="border border-border bg-background p-2.5 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="grid grid-cols-2 gap-px mt-0.5 shrink-0 opacity-30">
          <div className="size-1 bg-muted-foreground rounded-full" />
          <div className="size-1 bg-muted-foreground rounded-full" />
          <div className="size-1 bg-muted-foreground rounded-full" />
          <div className="size-1 bg-muted-foreground rounded-full" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold">{snippet.name}</span>
          {snippet.description && (
            <span className="text-xs text-muted-foreground">
              {snippet.description}
            </span>
          )}
        </div>
      </div>
      <span className="text-xs text-muted-foreground font-mono px-1">
        {snippet.content}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-7 gap-1.5"
          onClick={handleRun}
        >
          <Play className="size-3" />
          {t("newUi.sidebar.snippets.run")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground shrink-0"
          onClick={handleCopy}
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => onEdit(snippet)}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => onDelete(snippet.id)}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => onShare(snippet)}
        >
          <Share2 className="size-3.5" />
        </Button>
      </div>
    </div>
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
  const [snippetFormOpen, setSnippetFormOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<SnippetFolder | null>(null);
  const [editFolderOpen, setEditFolderOpen] = useState(false);
  const [shareSnippet, setShareSnippet] = useState<Snippet | null>(null);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(
    () =>
      new Set(
        activeTabId && terminalTabs.some((tab) => tab.id === activeTabId)
          ? [activeTabId]
          : [],
      ),
  );
  const [uncategorizedOpen, setUncategorizedOpen] = useState(true);

  useEffect(() => {
    getSnippets()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: Snippet[] = arr.map((s: any) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          content: s.content,
          folder: s.folder ?? null,
        }));
        setSnippets(mapped);
      })
      .catch(() => {});

    getSnippetFolders()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mapped: SnippetFolder[] = arr.map((f: any) => ({
          id: f.id,
          name: f.name,
          color: f.color ?? FOLDER_COLORS[0],
          icon: (f.icon as FolderIconId) ?? "folder",
          open: true,
        }));
        setFolders(mapped);
      })
      .catch(() => {});
  }, []);

  function toggleTab(id: string) {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSaveSnippet(data: Omit<Snippet, "id">, id?: number) {
    try {
      if (id !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await apiUpdateSnippet(id, data as any);
        setSnippets((prev) =>
          prev.map((s) => (s.id === id ? { ...s, ...data } : s)),
        );
        toast.success(t("newUi.sidebar.snippets.updateSuccess"));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created = (await apiCreateSnippet(data as any)) as any;
        setSnippets((prev) => [
          ...prev,
          {
            ...data,
            id: created.id ?? Math.max(0, ...prev.map((x) => x.id)) + 1,
          },
        ]);
        toast.success(t("newUi.sidebar.snippets.createSuccess"));
      }
    } catch {
      toast.error(
        id !== undefined
          ? t("newUi.sidebar.snippets.updateFailed")
          : t("newUi.sidebar.snippets.createFailed"),
      );
    }
  }

  async function handleCreateFolder(f: Omit<SnippetFolder, "id" | "open">) {
    try {
      const created = (await apiCreateSnippetFolder({
        name: f.name,
        color: f.color,
        icon: f.icon,
      })) as any;
      setFolders((prev) => [...prev, { ...f, id: created.id, open: true }]);
      toast.success(t("newUi.sidebar.snippets.folderCreateSuccess"));
    } catch {
      toast.error(t("newUi.sidebar.snippets.folderCreateFailed"));
    }
  }

  function toggleFolder(id: number) {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, open: !f.open } : f)),
    );
  }

  async function handleDeleteFolder(folder: SnippetFolder) {
    try {
      await apiDeleteSnippetFolder(folder.name);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      setSnippets((prev) =>
        prev.map((s) =>
          s.folder === folder.name ? { ...s, folder: null } : s,
        ),
      );
      toast.success(
        t("newUi.sidebar.snippets.folderDeleteSuccess", { name: folder.name }),
      );
    } catch {
      toast.error(t("newUi.sidebar.snippets.folderDeleteFailed"));
    }
  }

  async function handleSaveFolder(
    oldName: string,
    data: { name: string; color: string; icon: FolderIconId },
  ) {
    try {
      const nameChanged = data.name !== oldName;
      if (nameChanged) {
        await apiRenameSnippetFolder(oldName, data.name);
        setSnippets((prev) =>
          prev.map((s) =>
            s.folder === oldName ? { ...s, folder: data.name } : s,
          ),
        );
      }
      await apiUpdateSnippetFolderMetadata(nameChanged ? data.name : oldName, {
        color: data.color,
        icon: data.icon,
      });
      setFolders((prev) =>
        prev.map((f) =>
          f.name === oldName
            ? { ...f, name: data.name, color: data.color, icon: data.icon }
            : f,
        ),
      );
      toast.success(t("newUi.sidebar.snippets.folderEditSuccess"));
    } catch {
      toast.error(t("newUi.sidebar.snippets.folderEditFailed"));
    }
  }

  async function handleDeleteSnippet(id: number) {
    try {
      await apiDeleteSnippet(id);
      setSnippets((prev) => prev.filter((s) => s.id !== id));
    } catch {
      toast.error(t("newUi.sidebar.snippets.deleteFailed"));
    }
  }

  function handleEditSnippet(snippet: Snippet) {
    setEditingSnippet(snippet);
    setSnippetFormOpen(true);
  }

  const filtered = snippetSearch
    ? snippets.filter(
        (s) =>
          s.name.toLowerCase().includes(snippetSearch.toLowerCase()) ||
          s.content.toLowerCase().includes(snippetSearch.toLowerCase()),
      )
    : snippets;

  const uncategorizedSnippets = filtered.filter((s) => s.folder === null);

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
                    setSelectedTabIds(
                      new Set(terminalTabs.map((tab) => tab.id)),
                    )
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
            onClick={() => {
              setEditingSnippet(null);
              setSnippetFormOpen(true);
            }}
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
          {(!snippetSearch || uncategorizedSnippets.length > 0) && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setUncategorizedOpen((v) => !v)}
                className="flex items-center gap-1.5 w-full text-left"
              >
                <ChevronDown
                  className={`size-3 text-muted-foreground shrink-0 transition-transform ${uncategorizedOpen ? "" : "-rotate-90"}`}
                />
                <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-semibold flex-1 truncate text-muted-foreground">
                  {t("newUi.sidebar.snippets.uncategorized")}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {uncategorizedSnippets.length}
                </span>
              </button>
              {uncategorizedOpen && (
                <div className="flex flex-col gap-2 ml-1">
                  {uncategorizedSnippets.map((snippet) => (
                    <SnippetCard
                      key={snippet.id}
                      snippet={snippet}
                      selectedTabIds={selectedTabIds}
                      terminalTabs={terminalTabs}
                      onDelete={handleDeleteSnippet}
                      onEdit={handleEditSnippet}
                      onShare={setShareSnippet}
                      t={t}
                    />
                  ))}
                  {uncategorizedSnippets.length === 0 && (
                    <span className="text-xs text-muted-foreground/60 pl-1">
                      {t("newUi.sidebar.snippets.noSnippetsInFolder")}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {folders.map((folder) => {
            const folderSnippets = filtered.filter(
              (s) => s.folder === folder.name,
            );
            if (folderSnippets.length === 0 && snippetSearch) return null;
            return (
              <div key={folder.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 w-full group">
                  <button
                    onClick={() => toggleFolder(folder.id)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
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
                      style={{ color: folder.color }}
                    >
                      {folder.name}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 mr-1">
                      {folderSnippets.length}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="shrink-0 size-5 flex items-center justify-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="text-xs">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditFolder(folder);
                          setEditFolderOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5 mr-2" />
                        {t("newUi.sidebar.snippets.editFolder")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeleteFolder(folder)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="size-3.5 mr-2" />
                        {t("newUi.sidebar.snippets.deleteFolder")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {folder.open && (
                  <div className="flex flex-col gap-2 ml-1">
                    {folderSnippets.map((snippet) => (
                      <SnippetCard
                        key={snippet.id}
                        snippet={snippet}
                        selectedTabIds={selectedTabIds}
                        terminalTabs={terminalTabs}
                        onDelete={handleDeleteSnippet}
                        onEdit={handleEditSnippet}
                        onShare={setShareSnippet}
                        t={t}
                      />
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

      <SnippetFormDialog
        open={snippetFormOpen}
        onOpenChange={(v) => {
          setSnippetFormOpen(v);
          if (!v) setEditingSnippet(null);
        }}
        folders={folders}
        snippet={editingSnippet}
        onSave={handleSaveSnippet}
      />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onCreate={handleCreateFolder}
      />
      <EditFolderDialog
        open={editFolderOpen}
        onOpenChange={(v) => {
          setEditFolderOpen(v);
          if (!v) setEditFolder(null);
        }}
        folder={editFolder}
        onSave={handleSaveFolder}
      />
      <ShareSnippetDialog
        snippet={shareSnippet}
        onClose={() => setShareSnippet(null)}
      />
    </>
  );
}
