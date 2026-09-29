import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { toast } from "sonner";
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
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@termix/plugin-sdk/ui";
import type {
  ShareableRole,
  ShareableUser,
  SnippetShareInput,
  SnippetsApi,
} from "./snippets-api";
import { errorMessage, type Snippet, type SnippetAccessEntry } from "./types";

export type ShareTarget =
  { kind: "snippet"; snippet: Snippet } | { kind: "folder"; name: string };

const EXPIRY_HOURS = [0, 1, 24, 168, 720] as const;

const DOCS_URL = "https://docs.termix.site/features/authentication/rbac";

export function SnippetShareView({
  target,
  client,
  onBack,
}: {
  target: ShareTarget;
  client: SnippetsApi;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ShareableUser[]>([]);
  const [roles, setRoles] = useState<ShareableRole[]>([]);
  const [access, setAccess] = useState<SnippetAccessEntry[]>([]);
  const [tab, setTab] = useState<"user" | "role">("user");
  const [search, setSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [expiryHours, setExpiryHours] = useState<number>(0);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [folderSummary, setFolderSummary] = useState<number | null>(null);

  const snippetId = target.kind === "snippet" ? target.snippet.id : null;
  const selectedCount = selectedUsers.size + selectedRoles.size;

  const loadAccess = useCallback(async () => {
    if (snippetId === null) return;
    const list = await client.getAccess(snippetId);
    setAccess(Array.isArray(list) ? list : []);
  }, [client, snippetId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.shareTargetUsers(),
      client.shareTargetRoles(),
      loadAccess(),
    ])
      .then(([usersRes, rolesRes]) => {
        if (cancelled) return;
        setUsers(usersRes.users ?? []);
        setRoles(rolesRes.roles ?? []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, loadAccess]);

  const query = search.trim().toLowerCase();
  const filteredUsers = useMemo(
    () => users.filter((u) => u.username.toLowerCase().includes(query)),
    [users, query],
  );
  const filteredRoles = useMemo(
    () =>
      roles.filter((r) =>
        (r.displayName || r.name).toLowerCase().includes(query),
      ),
    [roles, query],
  );

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  async function handleShare() {
    if (selectedCount === 0) return;
    const expiresAt =
      expiryHours > 0
        ? new Date(Date.now() + expiryHours * 3600_000).toISOString()
        : null;
    const bodies: SnippetShareInput[] = [
      ...[...selectedUsers].map((id) => ({
        targetType: "user" as const,
        targetUserId: id,
        expiresAt,
      })),
      ...[...selectedRoles].map((id) => ({
        targetType: "role" as const,
        targetRoleId: id,
        expiresAt,
      })),
    ];

    setSubmitting(true);
    try {
      if (target.kind === "snippet") {
        for (const body of bodies) await client.share(target.snippet.id, body);
        await loadAccess();
      } else {
        let shared = 0;
        for (const body of bodies) {
          const result = await client.shareFolder(target.name, body);
          shared = Math.max(shared, result.snippetsShared ?? 0);
        }
        setFolderSummary(shared);
      }
      toast.success(t("shareSuccess", { count: selectedCount }));
      setSelectedUsers(new Set());
      setSelectedRoles(new Set());
    } catch (err) {
      toast.error(errorMessage(err, t("shareFailed")));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(entry: SnippetAccessEntry) {
    if (snippetId === null) return;
    try {
      await client.revokeAccess(snippetId, entry.id);
      setAccess((prev) => prev.filter((a) => a.id !== entry.id));
      toast.success(t("revokeSuccess"));
    } catch (err) {
      toast.error(errorMessage(err, t("revokeFailed")));
    }
  }

  const rowClass = (selected: boolean) =>
    `flex items-center gap-2 px-2.5 py-1.5 text-xs text-left border-b border-border/50 last:border-0 transition-colors shrink-0 ${selected ? "bg-accent-brand/10 text-accent-brand" : "hover:bg-muted/40"}`;

  const checkbox = (selected: boolean) => (
    <div
      className={`size-3.5 border flex items-center justify-center shrink-0 transition-colors ${selected ? "border-accent-brand bg-accent-brand" : "border-border bg-background"}`}
    >
      {selected && <Check className="size-2.5 text-background" />}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        <ArrowLeft className="size-3.5 shrink-0" />
        <span className="truncate">
          {target.kind === "snippet"
            ? t("shareSnippetTitle", { name: target.snippet.name })
            : t("shareFolderTitle", { name: target.name })}
        </span>
      </button>

      {loadError && (
        <div className="flex items-start gap-2 px-3 py-2 shrink-0 border-b border-destructive/30 bg-destructive/5 text-xs text-destructive">
          <Shield className="size-3.5 shrink-0 mt-0.5" />
          <div>{t("shareLoadFailed")}</div>
        </div>
      )}

      <div className="flex flex-col gap-2 p-3 shrink-0 border-b border-border">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Users className="size-3.5" />
            {t("shareWith")}
          </div>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-accent-brand hover:underline shrink-0"
          >
            {t("docsLink")}
          </a>
        </div>

        <div className="flex gap-1.5">
          {(["user", "role"] as const).map((key) => {
            const count =
              key === "user" ? selectedUsers.size : selectedRoles.size;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${tab === key ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                {key === "user" ? (
                  <User className="size-3 shrink-0" />
                ) : (
                  <Shield className="size-3 shrink-0" />
                )}
                {t(key === "user" ? "usersTab" : "rolesTab")}
                {count > 0 && <span>({count})</span>}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <Input
            placeholder={t("shareSearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex flex-col border border-border h-28 overflow-y-auto">
          {tab === "user" &&
            (filteredUsers.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
                {t("shareNoMatches")}
              </div>
            ) : (
              filteredUsers.map((user) => {
                const selected = selectedUsers.has(user.id);
                return (
                  <button
                    key={user.id}
                    onClick={() =>
                      setSelectedUsers((prev) => toggle(prev, user.id))
                    }
                    className={rowClass(selected)}
                  >
                    {checkbox(selected)}
                    <User className="size-3 text-muted-foreground shrink-0" />
                    <span className="truncate">{user.username}</span>
                  </button>
                );
              })
            ))}
          {tab === "role" &&
            (filteredRoles.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground/50 text-center">
                {t("shareNoMatches")}
              </div>
            ) : (
              filteredRoles.map((role) => {
                const selected = selectedRoles.has(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() =>
                      setSelectedRoles((prev) => toggle(prev, role.id))
                    }
                    className={rowClass(selected)}
                  >
                    {checkbox(selected)}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-left">
                  {t("shareExpiry")}
                </span>
                <span className="h-8 flex items-center px-2.5 text-xs border border-border hover:bg-muted/40 transition-colors whitespace-nowrap">
                  {t(`shareExpiryOptions.h${expiryHours}`)}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="text-xs">
              {EXPIRY_HOURS.map((hours) => (
                <DropdownMenuItem
                  key={hours}
                  onClick={() => setExpiryHours(hours)}
                >
                  {expiryHours === hours ? (
                    <Check className="size-3 mr-1.5" />
                  ) : (
                    <span className="size-3 mr-1.5" />
                  )}
                  {t(`shareExpiryOptions.h${hours}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            className="h-8 shrink-0 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            disabled={selectedCount === 0 || submitting}
            onClick={() => void handleShare()}
          >
            <Share2 className="size-3.5 mr-1.5" />
            {selectedCount > 0
              ? t("shareWithCount", { count: selectedCount })
              : t("shareButton")}
          </Button>
        </div>

        {target.kind === "folder" && (
          <p className="text-[11px] text-muted-foreground leading-snug">
            {t("shareFolderHint")}
          </p>
        )}
      </div>

      {target.kind === "folder" && folderSummary !== null && (
        <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 text-xs text-muted-foreground">
          <ListChecks className="size-3.5 shrink-0" />
          {t("shareFolderSummary", { count: folderSummary })}
        </div>
      )}

      {target.kind === "snippet" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-1.5 px-3 py-2 shrink-0 border-b border-border text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <ListChecks className="size-3.5" />
            {t("currentAccess")}
            {access.length > 0 && (
              <span className="text-muted-foreground/40">
                ({access.length})
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {access.length === 0 && (
              <div className="px-3 py-6 text-xs text-muted-foreground/50 text-center">
                {t("notSharedYet")}
              </div>
            )}
            {access.map((entry) => {
              const expired =
                entry.expiresAt && new Date(entry.expiresAt) < new Date();
              return (
                <div
                  key={entry.id}
                  className="flex flex-col gap-1 px-3 py-2 border-b border-border/60 last:border-0 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {entry.targetType === "user" ? (
                        <User className="size-3 text-muted-foreground shrink-0" />
                      ) : (
                        <Shield className="size-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="font-semibold truncate">
                        {entry.username ??
                          entry.roleDisplayName ??
                          entry.roleName ??
                          entry.userId ??
                          entry.roleId}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/10"
                      onClick={() => void handleRevoke(entry)}
                    >
                      {t("revokeAccess")}
                    </Button>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-4">
                    <span>
                      {t("grantedBy")}:{" "}
                      <span className="text-foreground/70">
                        {entry.grantedByUsername ?? "?"}
                      </span>
                    </span>
                    <span className={expired ? "text-destructive" : ""}>
                      {t("shareExpiry")}:{" "}
                      {expired ? (
                        <span className="inline-flex items-center gap-0.5 text-destructive">
                          <X className="size-3" />
                          {t("expired")}
                        </span>
                      ) : (
                        <span className="text-foreground/70">
                          {entry.expiresAt
                            ? new Date(entry.expiresAt).toLocaleString()
                            : t("shareExpiryOptions.h0")}
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
