import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Cloud,
  CloudOff,
  Loader2,
  RefreshCw,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/button";
import { Switch } from "@/components/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { refreshSyncStatus, setSyncStatus } from "@/lib/sync-status";
import { notifySyncChanged } from "@/lib/linked-server";
import { invalidateServerStatusCache } from "@/lib/hosts-request-cache";
import {
  getSyncConflicts,
  getSyncErrors,
  retrySyncErrors,
  settleSyncConflict,
  syncNow,
  unlinkServer,
  updateSyncSettings,
  type SyncBasicAuth,
  type SyncConflictItem,
  type SyncEntityInfo,
  type SyncErrorItem,
  type SyncProxyHeader,
  type SyncStatus,
} from "@/api/sync-api";
import { LinkServerDialog } from "./LinkServerDialog";
import { ProxySettingsFields } from "./ProxySettingsFields";

type DesktopSettings = { defaultConnectionOrigin: "local" | "remote" };

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-border bg-muted/10 p-3 flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
        {description && (
          <span className="text-[10px] text-muted-foreground leading-relaxed">
            {description}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function useRelativeTime() {
  const { t } = useTranslation();
  return (value: string | null | undefined) => {
    if (!value) return t("sync.never");
    const seconds = Math.max(
      0,
      Math.round((Date.now() - new Date(value).getTime()) / 1000),
    );
    if (seconds < 60) return t("sync.justNow");
    if (seconds < 3600)
      return t("sync.minutesAgo", { count: Math.round(seconds / 60) });
    if (seconds < 86400)
      return t("sync.hoursAgo", { count: Math.round(seconds / 3600) });
    return new Date(value).toLocaleString();
  };
}

function entityLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  entity: SyncEntityInfo,
): string {
  return t(`sync.entities.${entity.type}`, { defaultValue: entity.type });
}

export function SyncPanel() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const relativeTime = useRelativeTime();
  const [linkOpen, setLinkOpen] = useState(false);
  const [reloginOpen, setReloginOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [keepData, setKeepData] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflictItem[]>([]);
  const [errors, setErrors] = useState<SyncErrorItem[]>([]);
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>({
    defaultConnectionOrigin: "local",
  });
  const [proxyDraft, setProxyDraft] = useState<{
    customHeaders: SyncProxyHeader[];
    basicAuth: SyncBasicAuth | null;
    allowInvalidCertificate: boolean;
  } | null>(null);

  const apply = useCallback((next: SyncStatus) => {
    setSyncStatus(next);
    notifySyncChanged();
  }, []);

  useEffect(() => {
    window.electronAPI
      ?.invoke?.("get-desktop-settings")
      .then((settings) => {
        if (settings) setDesktopSettings(settings as DesktopSettings);
      })
      .catch(() => {});
  }, []);

  const conflictCount = status?.conflicts ?? 0;
  const errorCount = status?.errors ?? 0;
  useEffect(() => {
    if (!status?.linked) return;
    getSyncConflicts()
      .then(setConflicts)
      .catch(() => {});
  }, [status?.linked, conflictCount, status?.lastSyncAt]);
  useEffect(() => {
    if (!status?.linked) return;
    getSyncErrors()
      .then(setErrors)
      .catch(() => {});
  }, [status?.linked, errorCount, status?.lastSyncAt]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch {
      toast.error(t("sync.actionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const groups = useMemo(() => {
    const byOwner = new Map<string, SyncEntityInfo[]>();
    for (const entity of status?.entities ?? []) {
      const key = entity.owner === "core" ? "core" : entity.owner;
      const list = byOwner.get(key) ?? [];
      list.push(entity);
      byOwner.set(key, list);
    }
    return [...byOwner.entries()].sort(([a], [b]) =>
      a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b),
    );
  }, [status?.entities]);

  if (!status) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const linkDialog = (
    <LinkServerDialog
      open={linkOpen}
      onOpenChange={setLinkOpen}
      onLinked={apply}
    />
  );

  if (!status.linked) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="border border-border bg-muted/10 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CloudOff className="size-4 text-muted-foreground" />
            <span className="text-sm font-bold">{t("sync.unlinkedTitle")}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("sync.unlinkedBody")}
          </p>
          <ul className="text-xs text-muted-foreground list-disc pl-4 flex flex-col gap-1">
            <li>{t("sync.unlinkedPointHosts")}</li>
            <li>{t("sync.unlinkedPointOffline")}</li>
            <li>{t("sync.unlinkedPointAccount")}</li>
          </ul>
          <Button
            className="self-start rounded-none"
            onClick={() => setLinkOpen(true)}
          >
            <Cloud className="size-4" />
            {t("sync.linkButton")}
          </Button>
        </div>
        {linkDialog}
      </div>
    );
  }

  const state = status.status ?? "idle";
  const stateText =
    state === "syncing"
      ? t("sync.state.syncing")
      : state === "offline"
        ? t("sync.state.offline")
        : state === "error"
          ? t("sync.state.error")
          : state === "signed_out"
            ? t("sync.state.signedOut")
            : t("sync.state.synced", { time: relativeTime(status.lastSyncAt) });

  const toggleType = (type: string, enabled: boolean) =>
    run(`type:${type}`, async () => {
      const disabled = new Set<string>(
        (status.entities ?? [])
          .filter((entity) => !entity.enabled)
          .map((entity) => entity.type),
      );
      if (enabled) disabled.delete(type);
      else disabled.add(type);
      apply(await updateSyncSettings({ disabledTypes: [...disabled] }));
    });

  const handleOriginChange = async (origin: "local" | "remote") => {
    const next = { ...desktopSettings, defaultConnectionOrigin: origin };
    setDesktopSettings(next);
    await window.electronAPI?.invoke?.("save-desktop-settings", next);
    invalidateServerStatusCache();
    window.dispatchEvent(new CustomEvent("hosts:refresh"));
  };

  const draft = proxyDraft ?? {
    customHeaders: status.customHeaders ?? [],
    basicAuth: status.basicAuth ?? null,
    allowInvalidCertificate: !!status.allowInvalidCertificate,
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="border border-border bg-muted/10 p-3 flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <Cloud className="size-4 text-accent-brand mt-0.5 shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold truncate">
              {status.serverName || t("sync.server")}
            </span>
            <span className="text-[10px] text-muted-foreground break-all">
              {status.serverUrl}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              {t("sync.account")}
            </span>
            <span className="font-semibold truncate">
              {status.account?.username || "—"}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              {t("sync.status")}
            </span>
            <span
              className={`font-semibold flex items-center gap-1 ${
                state === "idle" || state === "syncing"
                  ? ""
                  : "text-destructive"
              }`}
            >
              {state === "syncing" && (
                <Loader2 className="size-3 animate-spin" />
              )}
              {stateText}
            </span>
          </div>
        </div>
        {status.lastError && state !== "idle" && state !== "syncing" && (
          <p className="text-[10px] text-muted-foreground break-words">
            {status.lastError}
          </p>
        )}
        {!!status.pending && (
          <p className="text-[10px] text-muted-foreground">
            {t("sync.pending", { count: status.pending })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {state === "signed_out" ? (
            <Button
              size="sm"
              className="h-7 text-[10px] rounded-none"
              onClick={() => setReloginOpen(true)}
            >
              {t("sync.signInAgain")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px] rounded-none"
              disabled={busy === "sync" || state === "syncing"}
              onClick={() =>
                run("sync", async () => {
                  apply(await syncNow());
                })
              }
            >
              {busy === "sync" || state === "syncing" ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              {t("sync.syncNow")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] rounded-none"
            onClick={() => {
              setKeepData(true);
              setUnlinkOpen(true);
            }}
          >
            <Unlink className="size-3" />
            {t("sync.unlink")}
          </Button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <Section
          title={t("sync.conflictsTitle")}
          description={t("sync.conflictsDescription")}
        >
          {conflicts.map((conflict) => (
            <div
              key={conflict.id}
              className="flex items-center justify-between gap-2 border border-border p-2"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold truncate">
                  {conflict.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {t(`sync.entities.${conflict.entityType}`, {
                    defaultValue: conflict.entityType,
                  })}
                </span>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] rounded-none"
                  disabled={busy === `conflict:${conflict.id}`}
                  onClick={() =>
                    run(`conflict:${conflict.id}`, async () => {
                      await settleSyncConflict(conflict.id, "mine");
                      refreshSyncStatus();
                    })
                  }
                >
                  {t("sync.keepMine")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] rounded-none"
                  disabled={busy === `conflict:${conflict.id}`}
                  onClick={() =>
                    run(`conflict:${conflict.id}`, async () => {
                      await settleSyncConflict(conflict.id, "server");
                      refreshSyncStatus();
                    })
                  }
                >
                  {t("sync.keepServer")}
                </Button>
              </div>
            </div>
          ))}
        </Section>
      )}

      {errors.length > 0 && (
        <Section
          title={t("sync.errorsTitle")}
          description={t("sync.errorsDescription")}
        >
          {errors.map((error) => (
            <div
              key={`${error.entityType}:${error.syncId}`}
              className="flex items-start gap-2 border border-border p-2"
            >
              <AlertTriangle className="size-3.5 text-destructive shrink-0 mt-0.5" />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold">
                  {t(`sync.entities.${error.entityType}`, {
                    defaultValue: error.entityType,
                  })}
                </span>
                <span className="text-[10px] text-muted-foreground break-words">
                  {error.reason === "permission"
                    ? t("sync.errorPermission")
                    : error.reason}
                </span>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="self-start h-7 text-[10px] rounded-none"
            disabled={busy === "retry"}
            onClick={() =>
              run("retry", async () => {
                apply(await retrySyncErrors());
              })
            }
          >
            {t("sync.retry")}
          </Button>
        </Section>
      )}

      <Section
        title={t("sync.whatSyncs")}
        description={t("sync.whatSyncsDescription")}
      >
        {groups.map(([owner, entities]) => (
          <div key={owner} className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground">
              {owner === "core"
                ? t("sync.coreGroup")
                : (entities[0]?.ownerName ?? owner)}
            </span>
            {entities.map((entity) => (
              <div
                key={entity.type}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs">{entityLabel(t, entity)}</span>
                  {!entity.onServer && (
                    <span className="text-[10px] text-muted-foreground">
                      {t("sync.notOnServer")}
                    </span>
                  )}
                  {entity.onServer && !entity.onDevice && (
                    <span className="text-[10px] text-muted-foreground">
                      {t("sync.notOnDevice")}
                    </span>
                  )}
                </div>
                <Switch
                  checked={entity.enabled}
                  disabled={busy === `type:${entity.type}`}
                  onCheckedChange={(checked) =>
                    void toggleType(entity.type, checked)
                  }
                />
              </div>
            ))}
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {t("sync.localOnlyHint")}
        </p>
      </Section>

      <Section
        title={t("sync.originTitle")}
        description={t("sync.originDescription")}
      >
        <div className="flex border border-border overflow-hidden w-fit">
          {(["local", "remote"] as const).map((origin) => (
            <button
              key={origin}
              type="button"
              onClick={() => void handleOriginChange(origin)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                desktopSettings.defaultConnectionOrigin === origin
                  ? "bg-accent-brand text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {origin === "local"
                ? t("sync.originLocal")
                : t("sync.originRemote")}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title={t("sync.proxy.title")}
        description={t("sync.proxy.description")}
      >
        <ProxySettingsFields
          customHeaders={draft.customHeaders}
          basicAuth={draft.basicAuth}
          onChange={(next) => setProxyDraft({ ...draft, ...next })}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs">
              {t("sync.proxy.allowInvalidCertificate")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {t("sync.proxy.allowInvalidCertificateHint")}
            </span>
          </div>
          <Switch
            checked={draft.allowInvalidCertificate}
            onCheckedChange={(checked) =>
              setProxyDraft({ ...draft, allowInvalidCertificate: checked })
            }
          />
        </div>
        {proxyDraft && (
          <Button
            size="sm"
            className="self-start h-7 text-[10px] rounded-none"
            disabled={busy === "proxy"}
            onClick={() =>
              run("proxy", async () => {
                apply(await updateSyncSettings(proxyDraft));
                setProxyDraft(null);
                toast.success(t("sync.proxy.saved"));
              })
            }
          >
            {t("common.save")}
          </Button>
        )}
      </Section>

      <LinkServerDialog
        open={reloginOpen}
        onOpenChange={setReloginOpen}
        onLinked={apply}
        relogin={status.serverUrl ? { serverUrl: status.serverUrl } : undefined}
      />

      <Dialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
        <DialogContent className="bg-card border border-border rounded-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sync.unlinkTitle")}</DialogTitle>
            <DialogDescription>{t("sync.unlinkDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {(
              [
                {
                  value: true,
                  title: t("sync.unlinkKeepTitle"),
                  body: t("sync.unlinkKeepBody"),
                },
                {
                  value: false,
                  title: t("sync.unlinkRemoveTitle"),
                  body: t("sync.unlinkRemoveBody"),
                },
              ] as const
            ).map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setKeepData(option.value)}
                className={`text-left border p-3 flex flex-col gap-1 transition-colors ${
                  keepData === option.value
                    ? "border-accent-brand bg-accent-brand/10"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <span className="text-sm font-semibold">{option.title}</span>
                <span className="text-xs text-muted-foreground">
                  {option.body}
                </span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-none"
              onClick={() => setUnlinkOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="rounded-none"
              disabled={busy === "unlink"}
              onClick={() =>
                run("unlink", async () => {
                  apply(await unlinkServer(keepData));
                  setUnlinkOpen(false);
                  toast.success(t("sync.unlinked"));
                })
              }
            >
              {busy === "unlink" && <Loader2 className="size-4 animate-spin" />}
              {t("sync.unlink")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {linkDialog}
    </div>
  );
}
