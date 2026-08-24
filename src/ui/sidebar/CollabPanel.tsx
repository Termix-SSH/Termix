import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Plus, Presentation, RefreshCw } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Badge } from "@/components/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import {
  createCollabRoom,
  listCollabRooms,
  type CollabRoom,
} from "@/api/collab-api";
import { getErrorMessage } from "@/lib/error-message";

export function CollabPanel({
  onOpenRoom,
}: {
  onOpenRoom: (room: CollabRoom) => void;
}) {
  const { t } = useTranslation();
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [persistent, setPersistent] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await listCollabRooms();
      setRooms(result.rooms);
    } catch {
      /* the list stays as-is */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { room } = await createCollabRoom(name.trim(), persistent);
      toast.success(t("collab.created"));
      setCreateOpen(false);
      setName("");
      setPersistent(false);
      await refresh();
      onOpenRoom(room);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          className="h-7 text-xs flex-1"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-3.5 mr-1" />
          {t("collab.createRoom")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : rooms.length === 0 ? (
        <p className="text-xs text-muted-foreground px-1 py-4 text-center">
          {t("collab.noRooms")}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => onOpenRoom(room)}
              className="flex items-center gap-2 px-2 py-1.5 text-left border border-border hover:bg-muted/50"
            >
              <Presentation className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-xs truncate">{room.name}</span>
              {room.presenterUserId && (
                <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
              )}
              {room.persistent && (
                <Badge variant="outline" className="text-[9px] px-1 py-0">
                  {t("collab.persistentRoom")}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("collab.createRoom")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder={t("collab.roomName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={persistent}
                onChange={(e) => setPersistent(e.target.checked)}
              />
              <span>
                <span className="font-medium">
                  {t("collab.persistentRoom")}
                </span>
                <br />
                <span className="text-muted-foreground">
                  {t("collab.persistentRoomHint")}
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={creating || !name.trim()}
            >
              {creating && <Loader2 className="size-3.5 mr-1 animate-spin" />}
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
