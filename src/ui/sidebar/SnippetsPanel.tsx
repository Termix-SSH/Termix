import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
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
  reorderSnippets,
} from "@/main-axios";
import {
  exportSnippets,
  importSnippets,
  type SnippetExportData,
  executeSnippet as apiExecuteSnippet,
} from "@/api/snippets-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { SSHHost } from "@/types/index";
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
  Download,
  Folder,
  Globe,
  GripVertical,
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
  Upload,
  UserPlus,
  X,
  MoreHorizontal,
  Zap,
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
  availableHosts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folders: SnippetFolder[];
  snippet: Snippet | null;
  onSave: (data: Omit<Snippet, "id" | "order">, id?: number) => void;
  availableHosts: SSHHost[];
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [selectedHostIds, setSelectedHostIds] = useState<Set<number>>(
    new Set(),
  );

  useEffect(() => {
    if (open) {
      setName(snippet?.name ?? "");
      setDescription(snippet?.description ?? "");
      setFolder(snippet?.folder ?? null);
      setContent(snippet?.content ?? "");
      setSelectedHostIds(new Set(snippet?.hostIds ?? []));
    }
  }, [open, snippet]);

  function toggleHost(id: number) {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSave() {
    if (!name.trim() || !content.trim()) return;
    onSave(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        content: content.trim(),
        folder,
        hostIds:
          selectedHostIds.size > 0 ? Array.from(selectedHostIds) : undefined,
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
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Server className="size-3.5" />
              {t("newUi.sidebar.snippets.targetHostsLabel")}{" "}
              <span className="font-normal">
                ({t("newUi.sidebar.snippets.optional")})
              </span>
            </label>
            <p className="text-xs text-muted-foreground/70">
              {t("newUi.sidebar.snippets.targetHostsHint")}
            </p>
            {availableHosts.length === 0 ? (
              <span className="text-xs text-muted-foreground/50">
                {t("newUi.sidebar.snippets.noHostsAvailable")}
              </span>
            ) : (
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto border border-border p-1.5">
                {availableHosts.map((host) => {
                  const selected = selectedHostIds.has(host.id);
                  return (
                    <button
                      key={host.id}
                      type="button"
                      onClick={() => toggleHost(host.id)}
                      className={`flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                        selected
                          ? "bg-accent-brand/10 text-accent-brand"
                          : "text-muted-foreground hover:text-foreground"
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
                      <Server className="size-3 shrink-0 opacity-60" />
                      <span className="text-xs font-medium truncate flex-1">
                        {host.name || host.ip}
                      </span>
                      <span className="text-xs text-muted-foreground/60 shrink-0">
                        {host.ip}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedHostIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedHostIds(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground self-start"
              >
                {t("newUi.sidebar.snippets.clearTargetHosts")}
              </button>
            )}
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

type SnippetPayload = Omit<Snippet, "id" | "order">;
type RawSnippet = Omit<SnippetPayload, "hostIds"> & {
  id: number;
  order?: number | null;
  hostFilter?: string | null;
};

function parseHostFilter(raw: string | null | undefined): number[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "number")) {
      return parsed.length > 0 ? parsed : undefined;
    }
  } catch {
    // ignore malformed values
  }
  return undefined;
}

function mapRawSnippet(s: RawSnippet): Snippet {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    content: s.content,
    folder: s.folder ?? null,
    order: s.order ?? 0,
    hostIds: parseHostFilter(s.hostFilter),
  };
}
type RawSnippetFolder = {
  id: number;
  name: string;
  color?: string | null;
  icon?: FolderIconId | null;
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
          (usersData?.users || []).map((u) => ({
            id: u.userId,
            username: u.username,
          })),
        );
        setRoles(rolesData?.roles || []);
        setAccessList(accessData.accessList || []);
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
      const accessData = await getSnippetAccess(snippet.id);
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
      const accessData = await getSnippetAccess(snippet.id);
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
  activeTabId,
  onDelete,
  onEdit,
  onShare,
  onConfirmRun,
  onDirectExecute,
  onDragStart,
  onDragEnd,
  onDragOver,
  dropIndicator,
  isDragging,
  availableHosts,
  t,
}: {
  snippet: Snippet;
  selectedTabIds: Set<string>;
  terminalTabs: Tab[];
  activeTabId: string;
  onDelete: (id: number) => void;
  onEdit: (snippet: Snippet) => void;
  onShare: (snippet: Snippet) => void;
  onConfirmRun: (snippet: Snippet, execute: () => void) => void;
  onDirectExecute: (snippet: Snippet) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  dropIndicator: "above" | "below" | null;
  isDragging: boolean;
  availableHosts: SSHHost[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const hasTargetHosts = (snippet.hostIds?.length ?? 0) > 0;

  function executeRun() {
    if (hasTargetHosts) {
      onDirectExecute(snippet);
      return;
    }
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
      const activeTab =
        terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];
      activeTab.terminalRef?.current?.sendInput?.(snippet.content + "\r");
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

  function handleRun() {
    onConfirmRun(snippet, executeRun);
  }

  function handleCopy() {
    copyToClipboard(snippet.content);
    toast.success(
      t("newUi.sidebar.snippets.copySuccess", { name: snippet.name }),
    );
  }

  const targetHosts = hasTargetHosts
    ? availableHosts.filter((h) => snippet.hostIds!.includes(h.id))
    : [];

  return (
    <div className="relative" onDragOver={onDragOver}>
      {dropIndicator === "above" && (
        <div className="absolute -top-1 left-0 right-0 h-0.5 bg-accent-brand z-10 pointer-events-none" />
      )}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className={`border bg-background p-2.5 flex flex-col gap-2 group/card transition-opacity ${isDragging ? "opacity-40" : "opacity-100"} border-border`}
      >
        <div className="flex items-start gap-2">
          <GripVertical className="size-3.5 mt-0.5 shrink-0 text-muted-foreground/30 group-hover/card:text-muted-foreground/60 cursor-grab active:cursor-grabbing transition-colors" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-semibold">{snippet.name}</span>
            {snippet.description && (
              <span className="text-xs text-muted-foreground">
                {snippet.description}
              </span>
            )}
          </div>
          {hasTargetHosts && (
            <Zap
              className="size-3 shrink-0 mt-0.5 text-accent-brand/70"
              title={t("newUi.sidebar.snippets.hasTargetHosts")}
            />
          )}
        </div>
        <span className="text-xs text-muted-foreground font-mono px-1">
          {snippet.content}
        </span>
        {targetHosts.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {targetHosts.map((host) => (
              <span
                key={host.id}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-accent-brand/10 text-accent-brand border border-accent-brand/20"
              >
                <Server className="size-2.5" />
                {host.name || host.ip}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className={`flex-1 text-xs h-7 gap-1.5 ${hasTargetHosts ? "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand" : ""}`}
            onClick={handleRun}
          >
            {hasTargetHosts ? (
              <Zap className="size-3" />
            ) : (
              <Play className="size-3" />
            )}
            {hasTargetHosts
              ? t("newUi.sidebar.snippets.runOnTargets")
              : t("newUi.sidebar.snippets.run")}
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
      {dropIndicator === "below" && (
        <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-accent-brand z-10 pointer-events-none" />
      )}
    </div>
  );
}

function ImportSnippetsDialog({
  open,
  onOpenChange,
  onImportDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImportDone: () => void;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setOverwrite(false);
    }
  }, [open]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped?.name.endsWith(".json")) setFile(dropped);
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      let parsed: SnippetExportData;
      try {
        parsed = JSON.parse(text);
      } catch {
        toast.error(t("newUi.sidebar.snippets.importInvalidFile"));
        return;
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (!Array.isArray(parsed.snippets) && !Array.isArray(parsed.folders))
      ) {
        toast.error(t("newUi.sidebar.snippets.importInvalidFile"));
        return;
      }

      const result = await importSnippets(parsed, overwrite);
      toast.success(
        t("newUi.sidebar.snippets.importSuccess", {
          snippets: result.snippetsImported,
          updated: result.snippetsUpdated,
          skipped: result.snippetsSkipped,
          folders: result.foldersImported,
        }),
      );
      onImportDone();
      onOpenChange(false);
    } catch {
      toast.error(t("newUi.sidebar.snippets.importFailed"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("newUi.sidebar.snippets.importTitle")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("newUi.sidebar.snippets.importDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-1">
          <div
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border px-4 py-8 cursor-pointer hover:border-accent-brand/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-xs text-muted-foreground text-center">
              {file
                ? t("newUi.sidebar.snippets.importSelectedFile", {
                    name: file.name,
                  })
                : t("newUi.sidebar.snippets.importDropOrClick")}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="size-3.5"
            />
            {t("newUi.sidebar.snippets.importOverwrite")}
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("newUi.sidebar.snippets.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleImport}
            disabled={!file || importing}
          >
            {t("newUi.sidebar.snippets.importStartBtn")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ExecutionResult {
  hostLabel: string;
  success: boolean;
  output: string;
  error?: string;
}

function ExecutionResultDialog({
  open,
  onOpenChange,
  snippetName,
  results,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  snippetName: string;
  results: ExecutionResult[];
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {t("newUi.sidebar.snippets.executionResultTitle", {
              name: snippetName,
            })}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("newUi.sidebar.snippets.executionResultDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 max-h-80 overflow-y-auto">
          {results.map((r, i) => (
            <div
              key={i}
              className="flex flex-col gap-1 border border-border p-2.5"
            >
              <div className="flex items-center gap-2">
                <Server className="size-3 shrink-0 text-muted-foreground" />
                <span className="text-xs font-semibold">{r.hostLabel}</span>
                <span
                  className={`ml-auto text-[10px] px-1.5 py-0.5 ${r.success ? "bg-green-500/10 text-green-500" : "bg-destructive/10 text-destructive"}`}
                >
                  {r.success
                    ? t("newUi.sidebar.snippets.executionSuccess")
                    : t("newUi.sidebar.snippets.executionFailed")}
                </span>
              </div>
              {(r.output || r.error) && (
                <pre className="text-xs bg-muted/30 p-2 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground max-h-40">
                  {r.error ? r.error : r.output}
                </pre>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("newUi.sidebar.snippets.close")}
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
  const { confirmWithToast } = useConfirmation();
  const [snippetSearch, setSnippetSearch] = useState("");
  const [folders, setFolders] = useState<SnippetFolder[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const snippetsRef = useRef<Snippet[]>([]);
  const [snippetFormOpen, setSnippetFormOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [editFolder, setEditFolder] = useState<SnippetFolder | null>(null);
  const [editFolderOpen, setEditFolderOpen] = useState(false);
  const [shareSnippet, setShareSnippet] = useState<Snippet | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [availableHosts, setAvailableHosts] = useState<SSHHost[]>([]);
  const [executionResultOpen, setExecutionResultOpen] = useState(false);
  const [executionResults, setExecutionResults] = useState<ExecutionResult[]>(
    [],
  );
  const [executionSnippetName, setExecutionSnippetName] = useState("");
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(
    () =>
      new Set(
        activeTabId && terminalTabs.some((tab) => tab.id === activeTabId)
          ? [activeTabId]
          : [],
      ),
  );

  function updateSnippets(next: Snippet[] | ((prev: Snippet[]) => Snippet[])) {
    setSnippets((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      snippetsRef.current = resolved;
      return resolved;
    });
  }

  const getFoldersCollapsed = () =>
    localStorage.getItem("defaultSnippetFoldersCollapsed") !== "false";

  const [uncategorizedOpen, setUncategorizedOpen] = useState(
    () => !getFoldersCollapsed(),
  );

  useEffect(() => {
    const handler = () => {
      const collapsed = getFoldersCollapsed();
      setUncategorizedOpen(!collapsed);
      setFolders((prev) => prev.map((f) => ({ ...f, open: !collapsed })));
    };
    window.addEventListener("defaultSnippetFoldersCollapsedChanged", handler);
    return () =>
      window.removeEventListener(
        "defaultSnippetFoldersCollapsedChanged",
        handler,
      );
  }, []);

  const [draggedSnippet, setDraggedSnippet] = useState<Snippet | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: number;
    position: "above" | "below";
  } | null>(null);

  function handleDragStart(snippet: Snippet) {
    setDraggedSnippet(snippet);
  }

  function handleDragOver(e: React.DragEvent, snippetId: number) {
    e.preventDefault();
    if (!draggedSnippet || draggedSnippet.id === snippetId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
    setDropTarget((prev) =>
      prev?.id === snippetId && prev?.position === position
        ? prev
        : { id: snippetId, position },
    );
  }

  async function handleDrop(folder: string | null) {
    const dragged = draggedSnippet;
    const target = dropTarget;
    setDraggedSnippet(null);
    setDropTarget(null);

    if (!dragged || !target || dragged.id === target.id) return;

    const group = snippetsRef.current.filter((s) => s.folder === folder);
    const draggedIdx = group.findIndex((s) => s.id === dragged.id);
    const targetIdx = group.findIndex((s) => s.id === target.id);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const reordered = [...group];
    reordered.splice(draggedIdx, 1);
    const insertAt =
      target.position === "below"
        ? reordered.findIndex((s) => s.id === target.id) + 1
        : reordered.findIndex((s) => s.id === target.id);
    reordered.splice(insertAt, 0, dragged);

    const rest = snippetsRef.current.filter((s) => s.folder !== folder);
    const next = [...rest, ...reordered];
    snippetsRef.current = next;
    setSnippets(next);

    const payload = reordered.map((s, idx) => ({
      id: s.id,
      order: idx,
      folder: folder ?? undefined,
    }));
    try {
      await reorderSnippets(payload);
    } catch {
      toast.error(t("newUi.sidebar.snippets.reorderFailed"));
    }
  }

  function handleDragEnd() {
    setDraggedSnippet(null);
    setDropTarget(null);
  }

  const handleConfirmRun = useCallback(
    (snippet: Snippet, execute: () => void) => {
      const shouldConfirm =
        localStorage.getItem("confirmSnippetExecution") === "true";
      if (!shouldConfirm) {
        execute();
        return;
      }
      confirmWithToast(
        t("newUi.sidebar.snippets.confirmRunMessage", { name: snippet.name }),
        execute,
        t("newUi.sidebar.snippets.confirmRunButton"),
        t("newUi.sidebar.snippets.cancel"),
        { confirmOnEnter: true, duration: 6000 },
      );
    },
    [confirmWithToast, t],
  );

  useEffect(() => {
    const collapsed = getFoldersCollapsed();

    getSnippets()
      .then((data) => {
        const arr: RawSnippet[] = Array.isArray(data) ? data : [];
        updateSnippets(arr.map(mapRawSnippet));
      })
      .catch(() => {});

    getSnippetFolders()
      .then((data) => {
        const arr: RawSnippetFolder[] = Array.isArray(data) ? data : [];
        const mapped: SnippetFolder[] = arr.map((f) => ({
          id: f.id,
          name: f.name,
          color: f.color ?? FOLDER_COLORS[0],
          icon: (f.icon as FolderIconId) ?? "folder",
          open: !collapsed,
        }));
        setFolders(mapped);
      })
      .catch(() => {});

    getSSHHosts()
      .then((hosts) => setAvailableHosts(hosts))
      .catch(() => {});
  }, []);

  function toggleTab(id: string) {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSaveSnippet(
    data: Omit<Snippet, "id" | "order">,
    id?: number,
  ) {
    const { hostIds, ...rest } = data;
    const payload = {
      ...rest,
      hostFilter: hostIds && hostIds.length > 0 ? hostIds : null,
    };
    try {
      if (id !== undefined) {
        await apiUpdateSnippet(id, payload);
        updateSnippets((prev) =>
          prev.map((s) => (s.id === id ? { ...s, ...data } : s)),
        );
        toast.success(t("newUi.sidebar.snippets.updateSuccess"));
      } else {
        const created = await apiCreateSnippet(payload);
        updateSnippets((prev) => [
          ...prev,
          {
            ...data,
            id:
              (created.id as number) ??
              Math.max(0, ...prev.map((x) => x.id)) + 1,
            order: (created.order as number) ?? prev.length,
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
      const created = await apiCreateSnippetFolder({
        name: f.name,
        color: f.color,
        icon: f.icon,
      });
      const id =
        typeof created.id === "number" ? created.id : Number(created.id);
      setFolders((prev) => [...prev, { ...f, id, open: true }]);
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
      updateSnippets((prev) =>
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
        updateSnippets((prev) =>
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

  async function handleExport() {
    try {
      const data = await exportSnippets();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "snippets-export.json";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("newUi.sidebar.snippets.exportSuccess"));
    } catch {
      toast.error(t("newUi.sidebar.snippets.exportFailed"));
    }
  }

  function reloadData() {
    const collapsed = getFoldersCollapsed();
    getSnippets()
      .then((data) => {
        const arr: RawSnippet[] = Array.isArray(data) ? data : [];
        updateSnippets(arr.map(mapRawSnippet));
      })
      .catch(() => {});
    getSnippetFolders()
      .then((data) => {
        const arr: RawSnippetFolder[] = Array.isArray(data) ? data : [];
        const mapped: SnippetFolder[] = arr.map((f) => ({
          id: f.id,
          name: f.name,
          color: f.color ?? FOLDER_COLORS[0],
          icon: (f.icon as FolderIconId) ?? "folder",
          open: !collapsed,
        }));
        setFolders(mapped);
      })
      .catch(() => {});
  }

  async function handleDeleteSnippet(id: number) {
    try {
      await apiDeleteSnippet(id);
      updateSnippets((prev) => prev.filter((s) => s.id !== id));
    } catch {
      toast.error(t("newUi.sidebar.snippets.deleteFailed"));
    }
  }

  function handleEditSnippet(snippet: Snippet) {
    setEditingSnippet(snippet);
    setSnippetFormOpen(true);
  }

  async function handleDirectExecute(snippet: Snippet) {
    const hostIds = snippet.hostIds ?? [];
    if (hostIds.length === 0) return;

    setExecutionSnippetName(snippet.name);
    setExecutionResults([]);
    setExecutionResultOpen(true);

    const results: ExecutionResult[] = await Promise.all(
      hostIds.map(async (hostId) => {
        const host = availableHosts.find((h) => h.id === hostId);
        const hostLabel = host ? host.name || host.ip : String(hostId);
        try {
          const result = await apiExecuteSnippet(snippet.id, hostId);
          return {
            hostLabel,
            success: result.success,
            output: result.output,
            error: result.error,
          };
        } catch (err) {
          return {
            hostLabel,
            success: false,
            output: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    setExecutionResults(results);

    const allOk = results.every((r) => r.success);
    if (allOk) {
      toast.success(
        t("newUi.sidebar.snippets.directRunSuccess", {
          name: snippet.name,
          count: results.length,
        }),
      );
    } else {
      toast.error(
        t("newUi.sidebar.snippets.directRunPartialFail", {
          name: snippet.name,
        }),
      );
    }
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
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">
            {t("newUi.sidebar.snippets.title")}
          </span>
          <a
            href="https://docs.termix.site/features/terminal/snippets"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-accent-brand hover:underline"
          >
            {t("hosts.docsLink")}
          </a>
        </div>
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
        <div className="flex gap-2 min-w-0">
          <Button
            variant="ghost"
            className="flex-1 text-xs min-w-0 overflow-hidden text-muted-foreground hover:text-foreground"
            onClick={handleExport}
          >
            <Download className="size-3.5 shrink-0" />
            {t("newUi.sidebar.snippets.exportBtn")}
          </Button>
          <Button
            variant="ghost"
            className="flex-1 text-xs min-w-0 overflow-hidden text-muted-foreground hover:text-foreground"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-3.5 shrink-0" />
            {t("newUi.sidebar.snippets.importBtn")}
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
                <div
                  className="flex flex-col gap-2 ml-1"
                  onDrop={() => handleDrop(null)}
                  onDragOver={(e) => e.preventDefault()}
                >
                  {uncategorizedSnippets.map((snippet) => (
                    <SnippetCard
                      key={snippet.id}
                      snippet={snippet}
                      selectedTabIds={selectedTabIds}
                      terminalTabs={terminalTabs}
                      activeTabId={activeTabId}
                      onDelete={handleDeleteSnippet}
                      onEdit={handleEditSnippet}
                      onShare={setShareSnippet}
                      onConfirmRun={handleConfirmRun}
                      onDirectExecute={handleDirectExecute}
                      onDragStart={() => handleDragStart(snippet)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, snippet.id)}
                      dropIndicator={
                        dropTarget?.id === snippet.id
                          ? dropTarget.position
                          : null
                      }
                      isDragging={draggedSnippet?.id === snippet.id}
                      availableHosts={availableHosts}
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
                  <div
                    className="flex flex-col gap-2 ml-1"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(folder.name)}
                  >
                    {folderSnippets.map((snippet) => (
                      <SnippetCard
                        key={snippet.id}
                        snippet={snippet}
                        selectedTabIds={selectedTabIds}
                        terminalTabs={terminalTabs}
                        activeTabId={activeTabId}
                        onDelete={handleDeleteSnippet}
                        onEdit={handleEditSnippet}
                        onShare={setShareSnippet}
                        onConfirmRun={handleConfirmRun}
                        onDirectExecute={handleDirectExecute}
                        onDragStart={() => handleDragStart(snippet)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, snippet.id)}
                        dropIndicator={
                          dropTarget?.id === snippet.id
                            ? dropTarget.position
                            : null
                        }
                        isDragging={draggedSnippet?.id === snippet.id}
                        availableHosts={availableHosts}
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
        availableHosts={availableHosts}
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
      <ImportSnippetsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImportDone={reloadData}
      />
      <ExecutionResultDialog
        open={executionResultOpen}
        onOpenChange={setExecutionResultOpen}
        snippetName={executionSnippetName}
        results={executionResults}
      />
    </>
  );
}
