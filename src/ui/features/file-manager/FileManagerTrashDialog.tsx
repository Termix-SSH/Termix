import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import {
  emptySSHTrash,
  getSSHTrash,
  permanentlyDeleteSSHTrashItem,
  restoreSSHTrashItem,
  updateSSHTrashRetention,
  type TrashItem,
} from "@/api/ssh-file-operations-api";

export function FileManagerTrashDialog({
  open,
  onOpenChange,
  sessionId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [retentionDays, setRetentionDays] = useState(7);
  const [canManageRetention, setCanManageRetention] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const result = await getSSHTrash(sessionId);
      setItems(result.items);
      setRetentionDays(result.retentionDays);
      setCanManageRetention(result.canManageRetention);
    } catch {
      toast.error(t("fileManager.trashLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [sessionId, t]);

  useEffect(() => {
    if (open) void load();
  }, [load, open]);

  async function restore(item: TrashItem) {
    if (!sessionId) return;
    try {
      await restoreSSHTrashItem(sessionId, item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      onChanged();
      toast.success(t("fileManager.trashRestored", { name: item.name }));
    } catch {
      toast.error(t("fileManager.trashRestoreFailed"));
    }
  }

  async function remove(item: TrashItem) {
    if (!sessionId) return;
    if (
      !window.confirm(t("fileManager.trashDeleteConfirm", { name: item.name }))
    )
      return;
    try {
      await permanentlyDeleteSSHTrashItem(sessionId, item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      toast.success(
        t("fileManager.trashPermanentlyDeleted", { name: item.name }),
      );
    } catch {
      toast.error(t("fileManager.trashDeleteFailed"));
    }
  }

  async function empty() {
    if (!sessionId || items.length === 0) return;
    if (!window.confirm(t("fileManager.trashEmptyConfirm"))) return;
    try {
      await emptySSHTrash(sessionId);
      setItems([]);
      toast.success(t("fileManager.trashEmptied"));
    } catch {
      toast.error(t("fileManager.trashDeleteFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("fileManager.trash")}</DialogTitle>
          <DialogDescription>
            {t("fileManager.trashDescription", { days: retentionDays })}{" "}
            <a
              href="https://docs.termix.site/features/files-and-hosts/trash"
              target="_blank"
              rel="noreferrer"
              className="text-accent-brand hover:underline"
            >
              {t("hosts.docsLink")}
            </a>
          </DialogDescription>
        </DialogHeader>

        {canManageRetention && (
          <div className="flex items-center gap-2 border border-border p-2 text-xs">
            <span className="flex-1">{t("fileManager.trashRetention")}</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(event) => setRetentionDays(Number(event.target.value))}
              className="h-8 w-20 border border-border bg-background px-2"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!sessionId || retentionDays < 1 || retentionDays > 3650)
                  return;
                try {
                  await updateSSHTrashRetention(sessionId, retentionDays);
                  toast.success(t("fileManager.trashRetentionSaved"));
                } catch {
                  toast.error(t("fileManager.trashRetentionFailed"));
                }
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        )}

        <div className="max-h-[55vh] overflow-y-auto border border-border">
          {loading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t("fileManager.trashEmpty")}
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b border-border p-3 last:border-b-0"
              >
                <Trash2 className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.originalPath} ·{" "}
                    {new Date(item.deletedAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void restore(item)}
                >
                  <RotateCcw className="mr-1 size-3.5" />
                  {t("fileManager.trashRestore")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void remove(item)}
                >
                  {t("fileManager.trashDeletePermanently")}
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <Button
            variant="destructive"
            disabled={items.length === 0}
            onClick={() => void empty()}
          >
            {t("fileManager.trashEmptyAction")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
