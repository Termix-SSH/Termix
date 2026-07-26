import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Link2, Search, Shield, User, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { getUserList } from "@/main-axios";
import {
  createSessionShare,
  getActiveSessionShares,
  revokeSessionShare,
  type SessionShareProtocol,
  type SessionSharePermissionLevel,
  type SessionShareRecord,
} from "@/api/session-sharing-api";

const EXPIRY_PRESETS = [
  { key: "oneHour", hours: 1 },
  { key: "oneDay", hours: 24 },
  { key: "sevenDays", hours: 24 * 7 },
  { key: "thirtyDays", hours: 24 * 30 },
  { key: "custom", hours: undefined },
] as const;

type ExpiryPresetKey = (typeof EXPIRY_PRESETS)[number]["key"];

export function ShareSessionModal({
  open,
  onClose,
  hostId,
  sessionId,
  protocol,
  tabInstanceId,
}: {
  open: boolean;
  onClose: () => void;
  hostId: number;
  sessionId: string | null;
  protocol: SessionShareProtocol;
  tabInstanceId?: string;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"link" | "user">("link");
  const [permissionLevel, setPermissionLevel] =
    useState<SessionSharePermissionLevel>("read-only");
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPresetKey>("oneDay");
  const [customHours, setCustomHours] = useState("");
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [shares, setShares] = useState<SessionShareRecord[]>([]);
  const [sharesLoaded, setSharesLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode("link");
    setPermissionLevel("read-only");
    setExpiryPreset("oneDay");
    setCustomHours("");
    setSearch("");
    setSelectedUserId(null);
    setCreatedLink(null);
    setSharesLoaded(false);
    setShares([]);
  }, [open, sessionId]);

  useEffect(() => {
    if (!open || sharesLoaded) return;
    setSharesLoaded(true);
    Promise.all([
      getUserList().catch(() => ({ users: [] })),
      getActiveSessionShares(hostId).catch(() => ({ shares: [] })),
    ]).then(([usersRes, sharesRes]) => {
      setUsers(
        (usersRes.users ?? []).map((u) => ({
          id: String(u.userId),
          username: u.username,
        })),
      );
      setShares(sharesRes.shares ?? []);
    });
  }, [open, hostId, sharesLoaded]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? users.filter((u) => u.username.toLowerCase().includes(q))
      : users;
  }, [users, search]);

  const expiryHours = (() => {
    if (expiryPreset === "custom") {
      const hours = Number(customHours);
      return Number.isFinite(hours) && hours > 0 ? hours : undefined;
    }
    return EXPIRY_PRESETS.find((p) => p.key === expiryPreset)?.hours;
  })();

  async function refreshShares() {
    try {
      const res = await getActiveSessionShares(hostId);
      setShares(res.shares ?? []);
    } catch {
      // silently ignore
    }
  }

  async function handleCreate() {
    if (!sessionId) return;
    if (mode === "user" && !selectedUserId) return;
    if (expiryPreset === "custom" && !expiryHours) return;

    setSubmitting(true);
    try {
      const result = await createSessionShare({
        hostId,
        sessionId,
        tabInstanceId,
        protocol,
        shareType: mode,
        targetUserId:
          mode === "user" ? (selectedUserId ?? undefined) : undefined,
        permissionLevel,
        expiryHours,
      });

      if (mode === "link" && result.linkToken) {
        const url = `${window.location.origin}${window.location.pathname}?view=shared&token=${result.linkToken}`;
        setCreatedLink(url);
        toast.success(t("sessionSharing.linkCreated"));
      } else {
        toast.success(t("sessionSharing.shareCreated"));
        setSelectedUserId(null);
      }
      await refreshShares();
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (mode === "user" && status === 403) {
        toast.error(t("sessionSharing.userLacksHostAccess"));
      } else {
        toast.error(t("sessionSharing.shareFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyLink() {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      toast.success(t("sessionSharing.linkCopied"));
    } catch {
      // clipboard API unavailable, ignore
    }
  }

  async function handleRevoke(shareId: string) {
    try {
      await revokeSessionShare(shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      toast.success(t("sessionSharing.revoked"));
    } catch {
      toast.error(t("sessionSharing.revokeFailed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sessionSharing.modalTitle")}</DialogTitle>
          <DialogDescription>
            {mode === "link"
              ? t("sessionSharing.linkModeDescription")
              : t("sessionSharing.userModeDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-1.5">
            {(["link", "user"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setCreatedLink(null);
                }}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${mode === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {m === "link" ? (
                  <Link2 className="size-3 shrink-0" />
                ) : (
                  <User className="size-3 shrink-0" />
                )}
                {m === "link"
                  ? t("sessionSharing.modeTab.link")
                  : t("sessionSharing.modeTab.user")}
              </button>
            ))}
          </div>

          {mode === "user" && (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
                <Input
                  placeholder={t("sessionSharing.searchUsersPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="flex flex-col border border-border h-28 overflow-y-auto">
                {filteredUsers.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
                    {t("sessionSharing.noUsersFound")}
                  </div>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelected = selectedUserId === user.id;
                    return (
                      <button
                        key={user.id}
                        onClick={() => setSelectedUserId(user.id)}
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs text-left border-b border-border/50 last:border-0 transition-colors shrink-0 ${isSelected ? "bg-accent-brand/10 text-accent-brand" : "hover:bg-muted/40"}`}
                      >
                        <div
                          className={`size-3.5 border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "border-accent-brand bg-accent-brand" : "border-border bg-background"}`}
                        >
                          {isSelected && (
                            <Check className="size-2.5 text-background" />
                          )}
                        </div>
                        <User className="size-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{user.username}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("sessionSharing.permissionLevel.label")}
              </span>
              <select
                value={permissionLevel}
                onChange={(e) =>
                  setPermissionLevel(
                    e.target.value as SessionSharePermissionLevel,
                  )
                }
                className="h-8 w-full px-2.5 text-xs border border-border bg-background hover:bg-muted/40 transition-colors"
              >
                <option value="read-only">
                  {t("sessionSharing.permissionLevel.readOnly")}
                </option>
                <option value="read-write">
                  {t("sessionSharing.permissionLevel.readWrite")}
                </option>
              </select>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex flex-col gap-1 shrink-0">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-left">
                    {t("sessionSharing.expiryLabel")}
                  </span>
                  <span className="h-8 flex items-center justify-center px-2.5 text-xs border border-border hover:bg-muted/40 transition-colors whitespace-nowrap">
                    {t(`hosts.sharing.expiry.${expiryPreset}`)}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-xs">
                {EXPIRY_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.key}
                    onClick={() => setExpiryPreset(preset.key)}
                  >
                    {expiryPreset === preset.key ? (
                      <Check className="size-3 mr-1.5" />
                    ) : (
                      <span className="size-3 mr-1.5" />
                    )}
                    {t(`hosts.sharing.expiry.${preset.key}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {expiryPreset === "custom" && (
            <Input
              type="number"
              autoFocus
              placeholder={t("hosts.sharing.customHoursPlaceholder")}
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          )}

          <p className="text-[11px] text-muted-foreground leading-snug">
            {permissionLevel === "read-only"
              ? t("sessionSharing.permissionLevel.readOnlyDescription")
              : t("sessionSharing.permissionLevel.readWriteDescription")}
          </p>

          <Button
            variant="outline"
            className="h-8 shrink-0 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            disabled={
              !sessionId ||
              submitting ||
              (mode === "user" && !selectedUserId) ||
              (expiryPreset === "custom" && !expiryHours)
            }
            onClick={handleCreate}
          >
            {mode === "link"
              ? t("sessionSharing.createLinkButton")
              : t("sessionSharing.createShareButton")}
          </Button>

          {createdLink && (
            <div className="flex items-center gap-1.5">
              <Input readOnly value={createdLink} className="text-xs" />
              <Button
                variant="outline"
                size="icon-sm"
                onClick={handleCopyLink}
                title={t("sessionSharing.copyLink")}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-0 border-t border-border pt-2">
            <div className="flex items-center gap-1.5 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              <Users className="size-3.5" />
              {t("sessionSharing.activeShares")}
              {shares.length > 0 && (
                <span className="text-muted-foreground/40">
                  ({shares.length})
                </span>
              )}
            </div>
            <div className="flex flex-col max-h-40 overflow-y-auto">
              {shares.length === 0 && (
                <div className="px-1 py-4 text-xs text-muted-foreground/50 text-center">
                  {t("sessionSharing.noActiveShares")}
                </div>
              )}
              {shares.map((share) => {
                const targetUser = users.find(
                  (u) => u.id === share.targetUserId,
                );
                return (
                  <div
                    key={share.id}
                    className="flex items-center justify-between gap-2 py-2 border-b border-border/60 last:border-0 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {share.shareType === "link" ? (
                        <Link2 className="size-3 text-muted-foreground shrink-0" />
                      ) : (
                        <Shield className="size-3 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="truncate font-semibold">
                          {share.shareType === "link"
                            ? t("sessionSharing.linkShareBadge")
                            : t("sessionSharing.userShareBadge", {
                                username:
                                  targetUser?.username ??
                                  share.targetUserId ??
                                  "?",
                              })}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60">
                          {share.permissionLevel === "read-write"
                            ? t("sessionSharing.permissionLevel.readWrite")
                            : t("sessionSharing.permissionLevel.readOnly")}
                          {" · "}
                          {t("sessionSharing.expiresAt", {
                            date: new Date(share.expiresAt).toLocaleString(),
                          })}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => handleRevoke(share.id)}
                    >
                      {t("sessionSharing.revoke")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
