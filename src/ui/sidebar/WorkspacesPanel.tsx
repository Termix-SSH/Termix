import { getErrorMessage } from "../lib/error-message.js";
import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  LayoutTemplate,
  Loader2,
  Plus,
  Save,
  Settings2,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Badge } from "@/components/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { FOLDER_COLORS } from "@/lib/theme";
import {
  listWorkspaces,
  createWorkspace,
  renameWorkspace,
  updateWorkspaceContent,
  deleteWorkspace,
  duplicateWorkspace,
  setDefaultWorkspace,
  unsetDefaultWorkspace,
} from "@/api/workspaces-api";
import type { Workspace, WorkspacePayload } from "@/types/ui-types";

function timeAgo(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function WorkspaceSaveDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, color: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FOLDER_COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setColor(FOLDER_COLORS[0]);
  }, [open]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t("newUi.sidebar.workspaces.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await onSave(name.trim(), color);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("newUi.sidebar.workspaces.saveCurrentTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("newUi.sidebar.workspaces.saveCurrentDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.workspaces.nameLabel")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("newUi.sidebar.workspaces.namePlaceholder")}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.workspaces.colorLabel")}
            </label>
            <div className="flex gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-6 transition-all ${
                    color === c
                      ? "ring-2 ring-offset-2 ring-offset-background ring-white/50"
                      : "opacity-75 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="size-3.5 mr-2 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceRenameDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FOLDER_COLORS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    setName(workspace.name);
    setColor(workspace.color ?? FOLDER_COLORS[0]);
  }, [workspace]);

  async function handleSave() {
    if (!workspace) return;
    if (!name.trim()) {
      toast.error(t("newUi.sidebar.workspaces.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await renameWorkspace(workspace.id, { name: name.trim(), color });
      toast.success(t("newUi.sidebar.workspaces.workspaceUpdated"));
      onSaved();
      onClose();
    } catch (error) {
      const message = getErrorMessage(error, "");
      toast.error(message || t("newUi.sidebar.workspaces.updateFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!workspace} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("newUi.sidebar.workspaces.rename")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.workspaces.nameLabel")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.workspaces.colorLabel")}
            </label>
            <div className="flex gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-6 transition-all ${
                    color === c
                      ? "ring-2 ring-offset-2 ring-offset-background ring-white/50"
                      : "opacity-75 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="size-3.5 mr-2 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceRow({
  workspace,
  isLastSession,
  onApply,
  onUpdateWithCurrent,
  onRename,
  onDuplicate,
  onDelete,
  onSetDefault,
}: {
  workspace: Workspace;
  isLastSession: boolean;
  onApply: () => void;
  onUpdateWithCurrent: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col gap-1 border border-border p-2.5 cursor-pointer hover:bg-muted/40 group"
      onClick={onApply}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className="size-2.5 shrink-0"
          style={{ backgroundColor: workspace.color ?? "#6b7280" }}
        />
        <span
          className={`text-xs font-semibold truncate min-w-0 ${isLastSession ? "italic text-muted-foreground" : ""}`}
        >
          {isLastSession
            ? t("newUi.sidebar.workspaces.lastSession")
            : workspace.name}
        </span>
        {workspace.isDefault && (
          <Star className="size-3 shrink-0 fill-accent-brand text-accent-brand" />
        )}
        <Badge variant="secondary" className="shrink-0 ml-auto">
          {t("newUi.sidebar.workspaces.tabCount", {
            count: workspace.tabCount,
          })}
        </Badge>
      </div>

      <span className="text-[11px] text-muted-foreground truncate pl-4">
        {isLastSession
          ? t("newUi.sidebar.workspaces.lastSessionDescription")
          : workspace.lastUsedAt
            ? t("newUi.sidebar.workspaces.lastUsed", {
                time: timeAgo(workspace.lastUsedAt),
              })
            : t("newUi.sidebar.workspaces.neverUsed")}
      </span>

      {!isLastSession && (
        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            title={
              workspace.isDefault
                ? t("newUi.sidebar.workspaces.unsetDefault")
                : t("newUi.sidebar.workspaces.setDefault")
            }
            onClick={(e) => {
              e.stopPropagation();
              onSetDefault();
            }}
          >
            <Star
              className={`size-3.5 ${workspace.isDefault ? "fill-accent-brand text-accent-brand" : ""}`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("newUi.sidebar.workspaces.updateWithCurrent")}
            onClick={(e) => {
              e.stopPropagation();
              onUpdateWithCurrent();
            }}
          >
            <Save className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("newUi.sidebar.workspaces.rename")}
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
          >
            <Settings2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("newUi.sidebar.workspaces.duplicate")}
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:text-destructive"
            title={t("newUi.sidebar.workspaces.deleteWorkspaceTitle")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function WorkspacesPanel({
  active,
  currentPayload,
  onApplyWorkspace,
}: {
  active?: boolean;
  currentPayload: () => WorkspacePayload;
  onApplyWorkspace: (workspace: Workspace) => void;
}) {
  const { t } = useTranslation();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [applyTarget, setApplyTarget] = useState<Workspace | null>(null);
  const hasLoadedRef = useRef(false);

  const loadWorkspaces = useCallback(async () => {
    try {
      const data = await listWorkspaces();
      setWorkspaces(data);
    } catch (error) {
      const message = getErrorMessage(error, "");
      toast.error(message || t("newUi.sidebar.workspaces.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (!active || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    setLoading(true);
    loadWorkspaces().finally(() => setLoading(false));
  }, [active, loadWorkspaces]);

  async function handleSaveNew(name: string, color: string) {
    try {
      await createWorkspace({ name, color, payload: currentPayload() });
      toast.success(t("newUi.sidebar.workspaces.workspaceCreated"));
      loadWorkspaces();
    } catch (error) {
      const message = getErrorMessage(error, "");
      toast.error(message || t("newUi.sidebar.workspaces.saveFailed"));
      throw error;
    }
  }

  async function handleUpdateWithCurrent(workspace: Workspace) {
    try {
      await updateWorkspaceContent(workspace.id, currentPayload());
      toast.success(t("newUi.sidebar.workspaces.workspaceUpdated"));
      loadWorkspaces();
    } catch (error) {
      const message = getErrorMessage(error, "");
      toast.error(message || t("newUi.sidebar.workspaces.updateFailed"));
    }
  }

  async function handleDuplicate(workspace: Workspace) {
    try {
      await duplicateWorkspace(
        workspace.id,
        t("newUi.sidebar.workspaces.duplicateNameSuffix", {
          name: workspace.name,
        }),
      );
      toast.success(t("newUi.sidebar.workspaces.workspaceDuplicated"));
      loadWorkspaces();
    } catch (error) {
      const message = getErrorMessage(error, "");
      toast.error(message || t("newUi.sidebar.workspaces.duplicateFailed"));
    }
  }

  async function handleToggleDefault(workspace: Workspace) {
    try {
      if (workspace.isDefault) {
        await unsetDefaultWorkspace(workspace.id);
      } else {
        await setDefaultWorkspace(workspace.id);
      }
      loadWorkspaces();
    } catch (error) {
      const message = getErrorMessage(error, "");
      toast.error(message || t("newUi.sidebar.workspaces.updateFailed"));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteWorkspace(deleteTarget.id);
      toast.success(t("newUi.sidebar.workspaces.workspaceDeleted"));
      setDeleteTarget(null);
      loadWorkspaces();
    } catch (error) {
      const message = getErrorMessage(error, "");
      toast.error(message || t("newUi.sidebar.workspaces.deleteFailed"));
    }
  }

  function handleApplyClick(workspace: Workspace) {
    setApplyTarget(workspace);
  }

  function confirmApply() {
    if (!applyTarget) return;
    onApplyWorkspace(applyTarget);
    setApplyTarget(null);
  }

  const manualWorkspaces = workspaces.filter((w) => w.kind === "manual");
  const lastSession = workspaces.find((w) => w.kind === "last_session");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
        <LayoutTemplate className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">
          {t("newUi.sidebar.workspaces.title")}
        </span>
        <a
          href="https://docs.termix.site/features/workspaces"
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 text-[10px] text-accent-brand hover:underline"
        >
          {t("hosts.docsLink")}
        </a>
        <Button
          variant="outline"
          size="sm"
          className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
          onClick={() => setSaveDialogOpen(true)}
        >
          <Plus className="size-3.5 mr-1.5" />
          {t("newUi.sidebar.workspaces.saveCurrent")}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : manualWorkspaces.length === 0 && !lastSession ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            {t("newUi.sidebar.workspaces.noWorkspaces")}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {lastSession && (
              <WorkspaceRow
                key={lastSession.id}
                workspace={lastSession}
                isLastSession
                onApply={() => handleApplyClick(lastSession)}
                onUpdateWithCurrent={() => {}}
                onRename={() => {}}
                onDuplicate={() => {}}
                onDelete={() => {}}
                onSetDefault={() => {}}
              />
            )}
            {manualWorkspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                isLastSession={false}
                onApply={() => handleApplyClick(workspace)}
                onUpdateWithCurrent={() => {
                  if (
                    window.confirm(
                      t("newUi.sidebar.workspaces.updateWithCurrentConfirm", {
                        name: workspace.name,
                      }),
                    )
                  ) {
                    handleUpdateWithCurrent(workspace);
                  }
                }}
                onRename={() => setRenameTarget(workspace)}
                onDuplicate={() => handleDuplicate(workspace)}
                onDelete={() => setDeleteTarget(workspace)}
                onSetDefault={() => handleToggleDefault(workspace)}
              />
            ))}
          </div>
        )}
      </div>

      <WorkspaceSaveDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSaveNew}
      />

      <WorkspaceRenameDialog
        workspace={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSaved={loadWorkspaces}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("newUi.sidebar.workspaces.deleteWorkspaceTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("newUi.sidebar.workspaces.deleteWorkspaceDescription", {
                name: deleteTarget?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <X className="size-3.5 mr-2" />
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!applyTarget}
        onOpenChange={(next) => !next && setApplyTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("newUi.sidebar.workspaces.applyConfirmTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("newUi.sidebar.workspaces.applyConfirmDescription", {
                name: applyTarget?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="outline"
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
              onClick={confirmApply}
            >
              {t("newUi.sidebar.workspaces.applyConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
