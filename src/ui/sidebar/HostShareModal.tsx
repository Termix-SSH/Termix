import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ListChecks,
  Plus,
  Shield,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { SectionCard } from "@/components/section-card";
import {
  getHostAccess,
  shareHost,
  revokeHostAccess,
  getUserList,
  getRoles,
} from "@/main-axios";
import type { Host } from "@/types/ui-types";

export function HostShareModal({
  open,
  onClose,
  host,
}: {
  open: boolean;
  onClose: () => void;
  host: Host | null;
}) {
  const { t } = useTranslation();
  const [shareType, setShareType] = useState<"user" | "role">("user");
  const [shareGranteeId, setShareGranteeId] = useState("");
  const [shareExpiryHours, setShareExpiryHours] = useState("");
  const [accessList, setAccessList] = useState<any[]>([]);
  const [shareUsers, setShareUsers] = useState<
    { id: string; username: string }[]
  >([]);
  const [shareRoles, setShareRoles] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [sharingLoaded, setSharingLoaded] = useState(false);
  const [sharingLoadError, setSharingLoadError] = useState(false);

  useEffect(() => {
    if (!open || !host) return;
    if (sharingLoaded) return;
    setSharingLoaded(true);
    Promise.all([
      getHostAccess(Number(host.id)).catch(() => ({ accessList: [] })),
      getUserList().catch(() => ({ users: [] })),
      getRoles().catch(() => ({ roles: [] })),
    ])
      .then(([accessRes, usersRes, rolesRes]) => {
        setAccessList((accessRes as any)?.accessList ?? []);
        setShareUsers(
          ((usersRes as any)?.users ?? []).map((u: any) => ({
            id: String(u.id ?? u.userId),
            username: u.username,
          })),
        );
        setShareRoles(
          ((rolesRes as any)?.roles ?? []).map((r: any) => ({
            id: String(r.id),
            name: r.name,
          })),
        );
      })
      .catch(() => setSharingLoadError(true));
  }, [open, host, sharingLoaded]);

  useEffect(() => {
    setSharingLoaded(false);
    setSharingLoadError(false);
    setAccessList([]);
    setShareGranteeId("");
    setShareExpiryHours("");
    setShareType("user");
  }, [host?.id]);

  async function refreshAccessList() {
    if (!host) return;
    const res = await getHostAccess(Number(host.id));
    setAccessList((res as any)?.accessList ?? []);
  }

  if (!open) return null;

  const hasCredential = !!host?.credentialId;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-sidebar">
      {/* Header */}
      <button
        onClick={onClose}
        className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <ArrowLeft className="size-3.5 shrink-0" />
        <span>{t("hosts.shareHostTitle", { name: host?.name ?? "" })}</span>
      </button>

      {/* Scrollable content */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-3 gap-3">
        {!hasCredential && host !== null && (
          <div className="flex items-start gap-3 p-3 border border-yellow-500/30 bg-yellow-500/5 text-xs text-yellow-500">
            <Shield className="size-3.5 shrink-0 mt-0.5" />
            <div>{t("hosts.sharing.requiresCredential")}</div>
          </div>
        )}

        {sharingLoadError && hasCredential && (
          <div className="flex items-start gap-3 p-3 border border-destructive/30 bg-destructive/5 text-xs text-destructive">
            <Shield className="size-3.5 shrink-0 mt-0.5" />
            <div>{t("hosts.guac.sharingLoadError")}</div>
          </div>
        )}

        {hasCredential && (
          <>
            <SectionCard
              title={t("hosts.guac.shareHostSection")}
              icon={<Users className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex gap-2">
                  {(["user", "role"] as const).map((shareTypeOpt) => (
                    <button
                      key={shareTypeOpt}
                      onClick={() => {
                        setShareType(shareTypeOpt);
                        setShareGranteeId("");
                      }}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${shareType === shareTypeOpt ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {shareTypeOpt === "user" ? (
                        <>
                          <User className="size-3 inline mr-1" />
                          {t("hosts.guac.shareWithUser")}
                        </>
                      ) : (
                        <>
                          <Shield className="size-3 inline mr-1" />
                          {t("hosts.guac.shareWithRole")}
                        </>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {shareType === "user"
                      ? t("hosts.guac.selectUser")
                      : t("hosts.guac.selectRole")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={shareGranteeId}
                    onChange={(e) => setShareGranteeId(e.target.value)}
                  >
                    <option value="">
                      {shareType === "user"
                        ? t("hosts.guac.selectUserOption")
                        : t("hosts.guac.selectRoleOption")}
                    </option>
                    {shareType === "user"
                      ? shareUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.username}
                          </option>
                        ))
                      : shareRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.expiresInHours")}
                  </label>
                  <Input
                    type="number"
                    placeholder={t("hosts.guac.noExpiryPlaceholder")}
                    value={shareExpiryHours}
                    onChange={(e) => setShareExpiryHours(e.target.value)}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                    disabled={!shareGranteeId}
                    onClick={async () => {
                      try {
                        await shareHost(Number(host!.id), {
                          targetType: shareType,
                          ...(shareType === "user"
                            ? { targetUserId: shareGranteeId }
                            : { targetRoleId: Number(shareGranteeId) }),
                          permissionLevel: "view",
                          ...(shareExpiryHours
                            ? { durationHours: Number(shareExpiryHours) }
                            : {}),
                        });
                        await refreshAccessList();
                        setShareGranteeId("");
                        setShareExpiryHours("");
                        toast.success(t("hosts.hostSharedSuccessfully"));
                      } catch {
                        toast.error(t("hosts.failedToShareHost"));
                      }
                    }}
                  >
                    <Plus className="size-3.5 mr-1.5" />
                    {t("hosts.guac.shareBtn")}
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.currentAccess")}
              icon={<ListChecks className="size-3.5" />}
            >
              <div className="py-2">
                {accessList.length === 0 && (
                  <div className="px-2 py-4 text-xs text-muted-foreground/50 text-center">
                    {t("hosts.guac.noAccessEntries")}
                  </div>
                )}
                {accessList.map((r: any, i: number) => {
                  const expired =
                    r.expiresAt && new Date(r.expiresAt) < new Date();
                  return (
                    <div
                      key={i}
                      className="flex flex-col gap-1 px-2 py-2.5 border-b border-border last:border-0 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {r.targetType === "user" ? (
                            <User className="size-3 text-muted-foreground shrink-0" />
                          ) : (
                            <Shield className="size-3 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-semibold truncate">
                            {r.username ??
                              r.roleName ??
                              r.roleDisplayName ??
                              r.userId ??
                              r.roleId}
                          </span>
                          <span className="text-muted-foreground capitalize shrink-0">
                            ({r.targetType})
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={async () => {
                            try {
                              await revokeHostAccess(Number(host!.id), r.id);
                              setAccessList((prev) =>
                                prev.filter((_, idx) => idx !== i),
                              );
                              toast.success(t("hosts.accessRevoked"));
                            } catch {
                              toast.error(t("hosts.failedToRevokeAccess"));
                            }
                          }}
                        >
                          {t("hosts.guac.revokeBtn")}
                        </Button>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-4">
                        <span>
                          {t("hosts.guac.grantedByHeader")}:{" "}
                          <span className="text-foreground/70">
                            {r.grantedByUsername ?? "—"}
                          </span>
                        </span>
                        <span className={expired ? "text-destructive" : ""}>
                          {t("hosts.guac.expiresHeader")}:{" "}
                          {expired ? (
                            <span className="inline-flex items-center gap-0.5 text-destructive">
                              <X className="size-3" />
                              {t("hosts.guac.expiredLabel")}
                            </span>
                          ) : r.expiresAt ? (
                            <span className="text-foreground/70">
                              {new Date(r.expiresAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span className="text-foreground/70">
                              {t("hosts.guac.neverLabel")}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}
