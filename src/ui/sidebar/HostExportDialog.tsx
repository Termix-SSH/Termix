import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { Checkbox } from "@/components/checkbox";
import { Input } from "@/components/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";
import { exportAllSSHHosts } from "@/main-axios";
import type { SSHHostWithStatus } from "@/main-axios";
import { isFolder } from "@/sidebar/SidebarTree";
import {
  buildExportPayload,
  hostKey,
  maskSecrets,
  type ExportPayload,
  type FieldGroup,
} from "@/sidebar/host-export-payload";

const GROUPS: { key: FieldGroup; label: string }[] = [
  { key: "connection", label: "groupConnection" },
  { key: "notes", label: "groupNotes" },
  { key: "tags", label: "groupTags" },
  { key: "tunnels", label: "groupTunnels" },
  { key: "jumpHosts", label: "groupJumpHosts" },
  { key: "quickActions", label: "groupQuickActions" },
  { key: "featureFlags", label: "groupFeatureFlags" },
  { key: "advanced", label: "groupAdvanced" },
];

const DEFAULT_GROUPS: FieldGroup[] = [
  "connection",
  "notes",
  "tags",
  "tunnels",
  "jumpHosts",
  "quickActions",
  "featureFlags",
  "advanced",
];

const PREVIEW_HOST_LIMIT = 20;

export function HostExportDialog({
  open,
  onClose,
  hosts,
  preselectedHostIds,
}: {
  open: boolean;
  onClose: () => void;
  hosts: SSHHostWithStatus[];
  preselectedHostIds?: Set<string>;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [withCredentials, setWithCredentials] = useState(false);
  const [groups, setGroups] = useState<Set<FieldGroup>>(
    () => new Set(DEFAULT_GROUPS),
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [raw, setRaw] = useState<ExportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Partial<Record<"share" | "full", ExportPayload>>>({});
  const prevOpen = useRef(false);

  const exportableHosts = useMemo(
    () =>
      hosts.filter(
        (h) =>
          !isFolder(h as unknown as Parameters<typeof isFolder>[0]) &&
          !h.isShared,
      ),
    [hosts],
  );

  useEffect(() => {
    const justOpened = open && !prevOpen.current;
    prevOpen.current = open;
    if (!justOpened) return;
    cache.current = {};
    setRaw(null);
    setSearch("");
    setWithCredentials(false);
    setGroups(new Set(DEFAULT_GROUPS));

    const preselected = preselectedHostIds ?? new Set<string>();
    if (preselected.size > 0) {
      setScope("selected");
      setSelectedKeys(
        new Set(
          exportableHosts
            .filter((h) => preselected.has(String(h.id)))
            .map((h) => hostKey(h as unknown as Record<string, unknown>)),
        ),
      );
    } else {
      setScope("all");
      setSelectedKeys(new Set());
    }
  }, [open, preselectedHostIds, exportableHosts]);

  useEffect(() => {
    if (!open) return;
    const mode = withCredentials ? "full" : "share";
    const cached = cache.current[mode];
    if (cached) {
      setRaw(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (withCredentials ? exportAllSSHHosts() : exportAllSSHHosts({ share: true }))
      .then((result) => {
        if (cancelled) return;
        cache.current[mode] = result as unknown as ExportPayload;
        setRaw(result as unknown as ExportPayload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRaw(null);
        const message = err instanceof Error ? err.message : "";
        toast.error(message || t("hosts.export.fetchFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, withCredentials, t]);

  const payload = useMemo(() => {
    if (!raw) return null;
    return buildExportPayload(
      raw,
      scope === "all" ? null : selectedKeys,
      groups,
      withCredentials,
    );
  }, [raw, scope, selectedKeys, groups, withCredentials]);

  const preview = useMemo(() => {
    if (!payload) return "";
    const masked = maskSecrets(payload);
    if (masked.hosts.length <= PREVIEW_HOST_LIMIT) {
      return JSON.stringify(masked, null, 2);
    }
    const text = JSON.stringify(
      { ...masked, hosts: masked.hosts.slice(0, PREVIEW_HOST_LIMIT) },
      null,
      2,
    );
    return (
      text +
      "\n" +
      t("hosts.export.moreHosts", {
        count: payload.hosts.length - PREVIEW_HOST_LIMIT,
      })
    );
  }, [payload, t]);

  function toggleGroup(group: FieldGroup) {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function toggleHost(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleExport() {
    if (!payload) return;
    const data = JSON.stringify(payload, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = withCredentials
      ? "termix-hosts.json"
      : "termix-hosts-share.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("hosts.hostsExported"));
    onClose();
  }

  const visibleHosts = exportableHosts.filter((h) =>
    (h.name ?? "").toLowerCase().includes(search.trim().toLowerCase()),
  );
  const count = payload?.hosts.length ?? 0;
  const canExport = !loading && count > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex flex-col w-[95vw] sm:max-w-6xl max-h-[85dvh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("hosts.export.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 min-w-0 overflow-y-auto md:overflow-visible">
          {/* Scope + host picker */}
          <div className="flex flex-col gap-2 md:w-56 shrink-0 min-h-0">
            <div className="text-xs text-muted-foreground">
              {t("hosts.export.scope")}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={scope === "all" ? "default" : "outline"}
                onClick={() => setScope("all")}
              >
                {t("hosts.export.scopeAll")}
              </Button>
              <Button
                size="sm"
                variant={scope === "selected" ? "default" : "outline"}
                onClick={() => setScope("selected")}
              >
                {t("hosts.export.scopeSelected")}
              </Button>
            </div>
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-7 h-8 text-xs"
                placeholder={t("hosts.export.searchHosts")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={scope === "all"}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto max-h-64 flex flex-col gap-1 pr-1">
              {visibleHosts.map((host) => {
                const key = hostKey(host as unknown as Record<string, unknown>);
                return (
                  <label
                    key={String(host.id)}
                    className="flex items-center gap-2 text-xs cursor-pointer"
                  >
                    <Checkbox
                      checked={scope === "all" || selectedKeys.has(key)}
                      disabled={scope === "all"}
                      onCheckedChange={() => toggleHost(key)}
                    />
                    <span className="truncate">{host.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Field groups */}
          <div className="flex flex-col gap-2 md:w-48 shrink-0 md:overflow-y-auto">
            <div className="text-xs text-muted-foreground">
              {t("hosts.export.include")}
            </div>
            <label className="flex items-center gap-2 text-xs opacity-60">
              <Checkbox checked disabled />
              <span>{t("hosts.export.groupConnection")}</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={withCredentials}
                onCheckedChange={(v) => setWithCredentials(v === true)}
              />
              <span>{t("hosts.export.groupCredentials")}</span>
            </label>
            {GROUPS.filter((g) => g.key !== "connection").map((group) => (
              <label
                key={group.key}
                className="flex items-center gap-2 text-xs cursor-pointer"
              >
                <Checkbox
                  checked={groups.has(group.key)}
                  onCheckedChange={() => toggleGroup(group.key)}
                />
                <span>{t(`hosts.export.${group.label}`)}</span>
              </label>
            ))}
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-2 flex-1 min-w-0 min-h-0">
            <div className="text-xs text-muted-foreground">
              {t("hosts.export.preview")}
            </div>
            <pre className="flex-1 w-full min-w-0 overflow-auto max-h-64 md:max-h-none rounded-sm bg-muted border border-border p-2 text-[11px] leading-relaxed whitespace-pre">
              {preview}
            </pre>
          </div>
        </div>

        <div className="shrink-0 text-xs text-muted-foreground">
          {count === 0
            ? t("hosts.export.noneSelected")
            : `${t("hosts.export.summary", {
                selected: count,
                total: exportableHosts.length,
              })} · ${
                withCredentials
                  ? t("hosts.export.credentialsIncluded")
                  : t("hosts.export.credentialsExcluded")
              }`}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            {t("hosts.export.cancel")}
          </Button>
          <Button onClick={handleExport} disabled={!canExport}>
            <Download className="size-3.5 mr-2" />
            {t("hosts.export.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
