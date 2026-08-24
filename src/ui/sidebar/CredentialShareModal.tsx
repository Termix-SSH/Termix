import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Loader2, Trash2, Users, UserRound } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import {
  getCredentialAccess,
  getRoles,
  revokeCredentialAccess,
  shareCredential,
  type CredentialPermissionLevel,
  type ShareTarget,
} from "@/api/rbac-api";
import { getUserList, type AccessRecord, type Role } from "@/main-axios";
import type { Credential } from "@/types/ui-types";
import { getErrorMessage } from "@/lib/error-message";

const EXPIRY_PRESETS = [
  { key: "never", hours: undefined },
  { key: "oneDay", hours: 24 },
  { key: "sevenDays", hours: 24 * 7 },
  { key: "thirtyDays", hours: 24 * 30 },
] as const;

export function CredentialShareModal({
  credential,
  onClose,
}: {
  credential: Credential | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"user" | "role">("user");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<Array<{ id: string; username: string }>>(
    [],
  );
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [level, setLevel] = useState<CredentialPermissionLevel>("use");
  const [expiry, setExpiry] =
    useState<(typeof EXPIRY_PRESETS)[number]["key"]>("never");
  const [access, setAccess] = useState<AccessRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const credentialId = credential ? Number(credential.id) : null;

  const loadAccess = useCallback(async () => {
    if (!credentialId) return;
    try {
      setAccess((await getCredentialAccess(credentialId)).access);
    } catch {
      setAccess([]);
    }
  }, [credentialId]);

  useEffect(() => {
    if (!credential) return;
    setSelectedUsers(new Set());
    setSelectedRoles(new Set());
    setSearch("");
    setLoading(true);
    Promise.all([
      getUserList().catch(() => ({ users: [] })),
      getRoles().catch(() => ({ roles: [] as Role[] })),
      loadAccess(),
    ])
      .then(([userResult, roleResult]) => {
        setUsers(
          userResult.users.map((u) => ({ id: u.userId, username: u.username })),
        );
        setRoles(roleResult.roles);
      })
      .finally(() => setLoading(false));
  }, [credential, loadAccess]);

  const filteredUsers = useMemo(
    () =>
      users.filter((u) =>
        u.username.toLowerCase().includes(search.toLowerCase()),
      ),
    [users, search],
  );
  const filteredRoles = useMemo(
    () =>
      roles.filter((r) =>
        (r.displayName || r.name).toLowerCase().includes(search.toLowerCase()),
      ),
    [roles, search],
  );

  async function handleShare() {
    if (!credentialId) return;
    const targets: ShareTarget[] = [
      ...Array.from(selectedUsers, (id) => ({ type: "user" as const, id })),
      ...Array.from(selectedRoles, (id) => ({ type: "role" as const, id })),
    ];
    if (targets.length === 0) return;
    setSaving(true);
    try {
      const preset = EXPIRY_PRESETS.find((p) => p.key === expiry);
      await shareCredential(credentialId, targets, level, preset?.hours);
      toast.success(t("credentials.share.shared"));
      setSelectedUsers(new Set());
      setSelectedRoles(new Set());
      await loadAccess();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(entry: AccessRecord) {
    if (!credentialId) return;
    try {
      await revokeCredentialAccess(credentialId, entry.id);
      await loadAccess();
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  }

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  return (
    <Dialog open={!!credential} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("credentials.share.title", { name: credential?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {t("credentials.share.description")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex gap-1">
              {(["user", "role"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setTab(kind)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold border ${
                    tab === kind
                      ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {kind === "user" ? (
                    <UserRound className="size-3" />
                  ) : (
                    <Users className="size-3" />
                  )}
                  {t(
                    kind === "user"
                      ? "credentials.share.users"
                      : "credentials.share.roles",
                  )}
                </button>
              ))}
            </div>
            <Input
              className="h-8 text-xs"
              placeholder={t("credentials.share.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {tab === "user"
                ? filteredUsers.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 text-xs px-1 py-0.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.has(u.id)}
                        onChange={() =>
                          setSelectedUsers((s) => toggle(s, u.id))
                        }
                      />
                      {u.username}
                    </label>
                  ))
                : filteredRoles.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 text-xs px-1 py-0.5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoles.has(r.id)}
                        onChange={() =>
                          setSelectedRoles((s) => toggle(s, r.id))
                        }
                      />
                      {r.displayName || r.name}
                    </label>
                  ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("credentials.share.permission")}
                </span>
                <select
                  value={level}
                  onChange={(e) =>
                    setLevel(e.target.value as CredentialPermissionLevel)
                  }
                  className="h-8 border border-border bg-background px-2 text-xs outline-none"
                >
                  <option value="use">{t("credentials.share.levelUse")}</option>
                  <option value="manage">
                    {t("credentials.share.levelManage")}
                  </option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("credentials.share.expires")}
                </span>
                <select
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value as typeof expiry)}
                  className="h-8 border border-border bg-background px-2 text-xs outline-none"
                >
                  {EXPIRY_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {t(`credentials.share.expiry.${p.key}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t(
                level === "manage"
                  ? "credentials.share.levelManageDesc"
                  : "credentials.share.levelUseDesc",
              )}
            </p>

            {access.length > 0 && (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("credentials.share.currentAccess")}
                </span>
                {access.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 text-xs px-1 py-0.5"
                  >
                    {entry.targetType === "role" ? (
                      <Users className="size-3 text-muted-foreground" />
                    ) : (
                      <UserRound className="size-3 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">
                      {entry.targetType === "role"
                        ? entry.roleDisplayName || entry.roleName
                        : entry.username}
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {entry.permissionLevel}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void handleRevoke(entry)}
                      title={t("credentials.share.revoke")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            onClick={() => void handleShare()}
            disabled={
              saving || (selectedUsers.size === 0 && selectedRoles.size === 0)
            }
          >
            {saving && <Loader2 className="size-3.5 mr-1 animate-spin" />}
            {t("credentials.share.shareButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
