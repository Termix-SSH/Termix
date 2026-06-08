import { useState } from "react";
import { Users, Plus, Trash2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";

interface SystemUser {
  name: string;
  uid: number;
  shell: string;
}
interface UsersData {
  users: SystemUser[];
  sudoers: string[];
}

export function UserManagerCard({ hostId }: { hostId: number | null }) {
  const { t } = useTranslation();
  const { data, loading, error, refresh } = useManagerData<UsersData>(
    hostId,
    "users",
  );
  const [newUser, setNewUser] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const sudoers = new Set(data?.sudoers ?? []);

  const action = async (act: string, username: string, group?: string) => {
    if (hostId == null) return;
    setBusy(username);
    try {
      const res = await managerPost<{ success: boolean; output: string }>(
        hostId,
        "users",
        { action: act, username, group },
        "action",
      );
      if (res.success) {
        toast.success(t("hostMetrics.managers.actionDone", { name: username }));
        if (act === "create") setNewUser("");
        refresh();
      } else {
        toast.error(res.output || t("hostMetrics.managers.actionFailed"));
      }
    } catch (e) {
      toast.error(extractError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ManagerCardShell
      title={t("hostMetrics.managers.users")}
      icon={<Users className="size-3.5" />}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <input
          value={newUser}
          onChange={(e) => setNewUser(e.target.value)}
          placeholder={t("hostMetrics.managers.newUsername")}
          className="h-7 flex-1 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          variant="outline"
          size="xs"
          disabled={!newUser || busy === newUser}
          onClick={() => action("create", newUser)}
        >
          <Plus className="size-3" />
          {t("hostMetrics.managers.addUser")}
        </Button>
      </div>
      <div className="flex flex-col">
        {(data?.users ?? []).map((u) => (
          <div
            key={u.name}
            className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs font-semibold">{u.name}</span>
              {sudoers.has(u.name) && (
                <ShieldCheck className="size-3 shrink-0 text-accent-brand" />
              )}
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {u.uid}
              </span>
            </div>
            <button
              onClick={() => action("delete", u.name)}
              disabled={busy === u.name}
              title={t("hostMetrics.managers.deleteUser")}
              className="text-muted-foreground hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ManagerCardShell>
  );
}
