import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  ListChecks,
  Search,
  Share2,
  Shield,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import {
  getHostAccess,
  shareHost,
  shareFolder,
  updateHostAccess,
  revokeHostAccess,
  getUserList,
  getRoles,
  type AccessRecord,
  type SharePermissionLevel,
  type ShareTarget,
} from "@/main-axios";
import type { Host } from "@/types/ui-types";

const PERMISSION_LEVELS: SharePermissionLevel[] = [
  "connect",
  "view",
  "edit",
  "manage",
];

const EXPIRY_PRESETS = [
  { key: "never", hours: null },
  { key: "oneHour", hours: 1 },
  { key: "oneDay", hours: 24 },
  { key: "sevenDays", hours: 24 * 7 },
  { key: "thirtyDays", hours: 24 * 30 },
  { key: "custom", hours: undefined },
] as const;

type ExpiryPresetKey = (typeof EXPIRY_PRESETS)[number]["key"];

export function HostShareModal({
  open,
  onClose,
  host,
  folder,
}: {
  open: boolean;
  onClose: () => void;
  host: Host | null;
  folder?: string | null;
}) {
  const { t } = useTranslation();
  const isFolderShare = !host && !!folder;
  const [targetTab, setTargetTab] = useState<"user" | "role">("user");
  const [search, setSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<number>>(
    new Set(),
  );
  const [permissionLevel, setPermissionLevel] =
    useState<SharePermissionLevel>("connect");
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPresetKey>("never");
  const [customHours, setCustomHours] = useState("");
  const [accessList, setAccessList] = useState<AccessRecord[]>([]);
  const [shareUsers, setShareUsers] = useState<
    { id: string; username: string }[]
  >([]);
  const [shareRoles, setShareRoles] = useState<
    { id: number; name: string; displayName?: string }[]
  >([]);
  const [sharingLoaded, setSharingLoaded] = useState(false);
  const [sharingLoadError, setSharingLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [folderShareSummary, setFolderShareSummary] = useState<{
    hostsShared: number;
    hostsTotal: number;
  } | null>(null);

  useEffect(() => {
    if (!open || (!host && !folder)) return;
    if (sharingLoaded) return;
    setSharingLoaded(true);
    Promise.all([
      host
        ? getHostAccess(Number(host.id)).catch(() => ({ accessList: [] }))
        : Promise.resolve({ accessList: [] }),
      getUserList().catch(() => ({ users: [] })),
      getRoles().catch(() => ({ roles: [] })),
    ])
      .then(([accessRes, usersRes, rolesRes]) => {
        setAccessList(accessRes.accessList ?? []);
        setShareUsers(
          (usersRes.users ?? []).map((u) => ({
            id: String(u.id ?? u.userId),
            username: u.username,
          })),
        );
        setShareRoles(
          (rolesRes.roles ?? [])
            .filter((r) => !r.isSystem)
            .map((r) => ({
              id: Number(r.id),
              name: r.name,
              displayName: r.displayName,
            })),
        );
      })
      .catch(() => setSharingLoadError(true));
  }, [open, host, folder, sharingLoaded]);

  useEffect(() => {
    setSharingLoaded(false);
    setSharingLoadError(false);
    setAccessList([]);
    setSearch("");
    setSelectedUserIds(new Set());
    setSelectedRoleIds(new Set());
    setPermissionLevel("connect");
    setExpiryPreset("never");
    setCustomHours("");
    setTargetTab("user");
    setFolderShareSummary(null);
  }, [host?.id, folder]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? shareUsers.filter((u) => u.username.toLowerCase().includes(q))
      : shareUsers;
  }, [shareUsers, search]);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? shareRoles.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            (r.displayName ?? "").toLowerCase().includes(q),
        )
      : shareRoles;
  }, [shareRoles, search]);

  const selectedCount = selectedUserIds.size + selectedRoleIds.size;

  const durationHours = (() => {
    if (expiryPreset === "never") return undefined;
    if (expiryPreset === "custom") {
      const hours = Number(customHours);
      return Number.isFinite(hours) && hours > 0 ? hours : undefined;
    }
    return (
      EXPIRY_PRESETS.find((p) => p.key === expiryPreset)?.hours ?? undefined
    );
  })();

  async function refreshAccessList() {
    if (!host) return;
    const res = await getHostAccess(Number(host.id));
    setAccessList(res.accessList ?? []);
  }

  async function handleShare() {
    if ((!host && !folder) || selectedCount === 0) return;
    const targets: ShareTarget[] = [
      ...[...selectedUserIds].map(
        (id) => ({ type: "user", id }) as ShareTarget,
      ),
      ...[...selectedRoleIds].map(
        (id) => ({ type: "role", id }) as ShareTarget,
      ),
    ];

    setSubmitting(true);
    try {
      if (isFolderShare && folder) {
        const result = await shareFolder(folder, {
          targets,
          permissionLevel,
          ...(durationHours ? { durationHours } : {}),
        });
        setFolderShareSummary({
          hostsShared: result.hostsShared,
          hostsTotal: result.hostsTotal,
        });
        setSelectedUserIds(new Set());
        setSelectedRoleIds(new Set());
        toast.success(
          t("hosts.folderSharedSuccessfully", {
            count: result.hostsShared,
          }),
        );
      } else if (host) {
        await shareHost(Number(host.id), {
          targets,
          permissionLevel,
          ...(durationHours ? { durationHours } : {}),
        });
        await refreshAccessList();
        setSelectedUserIds(new Set());
        setSelectedRoleIds(new Set());
        toast.success(t("hosts.hostSharedSuccessfully"));
      }
    } catch {
      toast.error(
        isFolderShare
          ? t("hosts.failedToShareFolder")
          : t("hosts.failedToShareHost"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLevelChange(
    record: AccessRecord,
    level: SharePermissionLevel,
  ) {
    if (!host || record.permissionLevel === level) return;
    try {
      await updateHostAccess(Number(host.id), record.id, {
        permissionLevel: level,
      });
      setAccessList((prev) =>
        prev.map((entry) =>
          entry.id === record.id ? { ...entry, permissionLevel: level } : entry,
        ),
      );
      toast.success(t("hosts.sharing.accessUpdated"));
    } catch {
      toast.error(t("hosts.sharing.accessUpdateFailed"));
    }
  }

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-sidebar">
      {/* Header */}
      <button
        onClick={onClose}
        className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <ArrowLeft className="size-3.5 shrink-0" />
        <span className="truncate">
          {isFolderShare
            ? t("hosts.shareFolderTitle", { name: folder ?? "" })
            : t("hosts.shareHostTitle", { name: host?.name ?? "" })}
        </span>
      </button>

      {sharingLoadError && (
        <div className="flex items-start gap-2 px-3 py-2 shrink-0 border-b border-destructive/30 bg-destructive/5 text-xs text-destructive">
          <Shield className="size-3.5 shrink-0 mt-0.5" />
          <div>{t("hosts.sharing.loadError")}</div>
        </div>
      )}

      {/* Share form: fixed, non-scrolling */}
      <div className="flex flex-col gap-2 p-3 shrink-0 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Users className="size-3.5" />
            {t("hosts.sharing.shareWithSection")}
          </div>
          <a
            href="https://docs.termix.site/features/authentication/rbac"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-accent-brand hover:underline shrink-0"
          >
            {t("hosts.docsLink")}
          </a>
        </div>

        <div className="flex gap-1.5">
          {(["user", "role"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setTargetTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${targetTab === tab ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {tab === "user" ? (
                <User className="size-3 shrink-0" />
              ) : (
                <Shield className="size-3 shrink-0" />
              )}
              {tab === "user"
                ? t("hosts.sharing.usersTab")
                : t("hosts.sharing.rolesTab")}
              {tab === "user" && selectedUserIds.size > 0 && (
                <span>({selectedUserIds.size})</span>
              )}
              {tab === "role" && selectedRoleIds.size > 0 && (
                <span>({selectedRoleIds.size})</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <Input
            placeholder={t("hosts.sharing.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex flex-col border border-border h-28 overflow-y-auto">
          {targetTab === "user" &&
            (filteredUsers.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
                {t("hosts.sharing.noMatches")}
              </div>
            ) : (
              filteredUsers.map((user) => {
                const isSelected = selectedUserIds.has(user.id);
                return (
                  <button
                    key={user.id}
                    onClick={() =>
                      setSelectedUserIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(user.id)) next.delete(user.id);
                        else next.add(user.id);
                        return next;
                      })
                    }
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
            ))}
          {targetTab === "role" &&
            (filteredRoles.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
                {t("hosts.sharing.noMatches")}
              </div>
            ) : (
              filteredRoles.map((role) => {
                const isSelected = selectedRoleIds.has(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() =>
                      setSelectedRoleIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(role.id)) next.delete(role.id);
                        else next.add(role.id);
                        return next;
                      })
                    }
                    className={`flex items-center gap-2 px-2.5 py-1.5 text-xs text-left border-b border-border/50 last:border-0 transition-colors shrink-0 ${isSelected ? "bg-accent-brand/10 text-accent-brand" : "hover:bg-muted/40"}`}
                  >
                    <div
                      className={`size-3.5 border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "border-accent-brand bg-accent-brand" : "border-border bg-background"}`}
                    >
                      {isSelected && (
                        <Check className="size-2.5 text-background" />
                      )}
                    </div>
                    <Shield className="size-3 text-muted-foreground shrink-0" />
                    <span className="truncate">
                      {role.displayName || role.name}
                    </span>
                  </button>
                );
              })
            ))}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("hosts.sharing.permissionLevelLabel")}
            </span>
            <select
              value={permissionLevel}
              onChange={(e) =>
                setPermissionLevel(e.target.value as SharePermissionLevel)
              }
              className="h-8 w-full px-2.5 text-xs border border-border bg-background hover:bg-muted/40 transition-colors"
            >
              {PERMISSION_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(`hosts.sharing.levels.${level}.label`)}
                </option>
              ))}
            </select>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex flex-col gap-1 shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-left">
                  {t("hosts.sharing.expiryLabel")}
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

          <Button
            variant="outline"
            className="h-8 shrink-0 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            disabled={
              selectedCount === 0 ||
              submitting ||
              (expiryPreset === "custom" && !durationHours)
            }
            onClick={handleShare}
          >
            <Share2 className="size-3.5 mr-1.5" />
            {selectedCount > 0
              ? t("hosts.sharing.shareWithCount", { count: selectedCount })
              : t("hosts.sharing.shareButton")}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground leading-snug">
          {t(`hosts.sharing.levels.${permissionLevel}.description`)}
        </p>

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
      </div>

      {/* Folder share summary */}
      {isFolderShare && folderShareSummary && (
        <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 text-xs text-muted-foreground">
          <ListChecks className="size-3.5 shrink-0" />
          {t("hosts.sharing.folderShareSummary", {
            shared: folderShareSummary.hostsShared,
            total: folderShareSummary.hostsTotal,
          })}
        </div>
      )}

      {/* Current access: takes remaining space, scrolls independently */}
      {!isFolderShare && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 border-b border-border text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <ListChecks className="size-3.5" />
            {t("hosts.sharing.currentAccess")}
            {accessList.length > 0 && (
              <span className="text-muted-foreground/40">
                ({accessList.length})
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {accessList.length === 0 && (
              <div className="px-3 py-6 text-xs text-muted-foreground/50 text-center">
                {t("hosts.sharing.noAccessEntries")}
              </div>
            )}
            {accessList.map((record) => {
              const expired =
                record.expiresAt && new Date(record.expiresAt) < new Date();
              return (
                <div
                  key={record.id}
                  className="flex flex-col gap-1 px-3 py-2 border-b border-border/60 last:border-0 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {record.targetType === "user" ? (
                        <User className="size-3 text-muted-foreground shrink-0" />
                      ) : (
                        <Shield className="size-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-semibold truncate">
                        {record.username ??
                          record.roleDisplayName ??
                          record.roleName ??
                          record.userId ??
                          record.roleId}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest border border-accent-brand/30 bg-accent-brand/10 text-accent-brand transition-colors hover:bg-accent-brand/20">
                            {t(
                              `hosts.sharing.levels.${record.permissionLevel ?? "connect"}.label`,
                            )}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          {PERMISSION_LEVELS.map((level) => (
                            <DropdownMenuItem
                              key={level}
                              onClick={() => handleLevelChange(record, level)}
                            >
                              {record.permissionLevel === level ? (
                                <Check className="size-3 mr-1.5" />
                              ) : (
                                <span className="size-3 mr-1.5" />
                              )}
                              {t(`hosts.sharing.levels.${level}.label`)}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/10"
                        onClick={async () => {
                          try {
                            await revokeHostAccess(Number(host!.id), record.id);
                            setAccessList((prev) =>
                              prev.filter((entry) => entry.id !== record.id),
                            );
                            toast.success(t("hosts.accessRevoked"));
                          } catch {
                            toast.error(t("hosts.failedToRevokeAccess"));
                          }
                        }}
                      >
                        {t("hosts.sharing.revoke")}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-4">
                    <span>
                      {t("hosts.sharing.grantedBy")}:{" "}
                      <span className="text-foreground/70">
                        {record.grantedByUsername ?? "?"}
                      </span>
                    </span>
                    <span className={expired ? "text-destructive" : ""}>
                      {t("hosts.sharing.expires")}:{" "}
                      {expired ? (
                        <span className="inline-flex items-center gap-0.5 text-destructive">
                          <X className="size-3" />
                          {t("hosts.sharing.expired")}
                        </span>
                      ) : record.expiresAt ? (
                        <span className="text-foreground/70">
                          {new Date(record.expiresAt).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-foreground/70">
                          {t("hosts.sharing.never")}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
