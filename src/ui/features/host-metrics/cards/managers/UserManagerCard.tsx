import { useMemo, useState } from "react";
import { Users, Plus, Trash2, ShieldCheck, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { managerPost } from "@/main-axios";
import { useManagerData, extractError } from "./useManagerData";
import { ManagerCardShell } from "./ManagerCardShell";
import { ManagerSearch } from "./ManagerToolbar";

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
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const sudoers = new Set(data?.sudoers ?? []);

  const users = useMemo(
    () =>
      (data?.users ?? []).filter(
        (u) => !filter || u.name.toLowerCase().includes(filter.toLowerCase()),
      ),
    [data?.users, filter],
  );

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
      <ManagerSearch value={filter} onChange={setFilter} count={users.length} />
      <div className="flex flex-col">
        {users.map((u) => {
          const isSudoer = sudoers.has(u.name);
          return (
            <div
              key={u.name}
              className="flex items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs font-semibold">{u.name}</span>
                {isSudoer && (
                  <ShieldCheck className="size-3 shrink-0 text-accent-brand" />
                )}
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {u.uid}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() =>
                    action(
                      isSudoer ? "removeFromGroup" : "addToGroup",
                      u.name,
                      "sudo",
                    )
                  }
                  disabled={busy === u.name}
                  title={
                    isSudoer
                      ? t("hostMetrics.managers.revokeSudo")
                      : t("hostMetrics.managers.grantSudo")
                  }
                  className={`disabled:opacity-40 ${
                    isSudoer
                      ? "text-accent-brand hover:text-muted-foreground"
                      : "text-muted-foreground hover:text-accent-brand"
                  }`}
                >
                  <Shield className="size-3.5" />
                </button>
                <button
                  onClick={() => action("delete", u.name)}
                  disabled={busy === u.name}
                  title={t("hostMetrics.managers.deleteUser")}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ManagerCardShell>
  );
}
