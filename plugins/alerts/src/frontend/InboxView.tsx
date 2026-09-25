import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BellOff, CheckCheck, Loader2, Maximize2, Trash2 } from "lucide-react";
import {
  usePluginApi,
  useTabs,
  useTranslation,
} from "@termix/plugin-sdk/frontend";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@termix/plugin-sdk/ui";
import { SEVERITIES, type AlertItem, type Severity } from "../types";
import { createAlertsApi } from "./api";
import { AlertList } from "./AlertList";
import { sourceLabel } from "./format";
import { useAlertsVersion, type AlertsStore } from "./store";

const ALL = "__all";

export function InboxView({
  store,
  compact = false,
  onOpenAll,
}: {
  store: AlertsStore;
  compact?: boolean;
  onOpenAll?: () => void;
}) {
  const { t } = useTranslation();
  const client = usePluginApi();
  const api = useMemo(() => createAlertsApi(client), [client]);
  const tabs = useTabs();
  const version = useAlertsVersion(store);

  const [items, setItems] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [severity, setSeverity] = useState<Severity | "">("");
  const [source, setSource] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const pageSize = compact ? 25 : 50;

  const load = useCallback(async () => {
    try {
      const result = await api.items({
        unread: unreadOnly,
        severity: severity || undefined,
        source: source || undefined,
        limit: pageSize,
      });
      setItems(result.items);
      setHasMore(result.items.length === pageSize);
      store.setUnread(result.unread);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [api, pageSize, severity, source, store, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load, version]);

  useEffect(() => {
    if (compact) return;
    api
      .categories()
      .then((rows) =>
        setSources([...new Set(rows.map((row) => row.source))].sort()),
      )
      .catch(() => {});
  }, [api, compact, version]);

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    try {
      const result = await api.items({
        unread: unreadOnly,
        severity: severity || undefined,
        source: source || undefined,
        limit: pageSize,
        before: last.id,
      });
      setItems((current) => [...current, ...result.items]);
      setHasMore(result.items.length === pageSize);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const setRead = async (ids: number[] | "all", read: boolean) => {
    const { count } = await api.setRead(ids, read);
    store.setUnread(count);
    const now = new Date().toISOString();
    setItems((current) =>
      current
        .map((item) =>
          ids === "all" || ids.includes(item.id)
            ? { ...item, readAt: read ? (item.readAt ?? now) : null }
            : item,
        )
        .filter((item) => !unreadOnly || !item.readAt),
    );
  };

  const open = (item: AlertItem) => {
    if (!item.readAt) void setRead([item.id], true).catch(() => {});
    if (item.link?.tab) tabs.openSingletonTab(item.link.tab);
  };

  const remove = async (item: AlertItem) => {
    try {
      await api.remove(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      store.setUnread((await api.unread()).count);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const clearRead = async () => {
    try {
      const { removed } = await api.clear(true);
      toast.success(t("inbox.cleared", { count: removed }));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const unread = items.some((item) => !item.readAt);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5 border-b border-border shrink-0",
          compact ? "px-2 py-1.5" : "px-3 py-2",
        )}
      >
        <div className="flex border border-border">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setUnreadOnly(value)}
              className={cn(
                "px-2 py-1 text-xs font-medium transition-colors",
                unreadOnly === value
                  ? "bg-accent-brand/10 text-accent-brand"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value ? t("inbox.filterUnread") : t("inbox.filterAll")}
            </button>
          ))}
        </div>
        {!compact && (
          <>
            <Select
              value={severity || ALL}
              onValueChange={(value) =>
                setSeverity(value === ALL ? "" : (value as Severity))
              }
            >
              <SelectTrigger className="h-7 w-[140px] rounded-none text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("inbox.anySeverity")}</SelectItem>
                {SEVERITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`severity.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={source || ALL}
              onValueChange={(value) => setSource(value === ALL ? "" : value)}
            >
              <SelectTrigger className="h-7 w-[160px] rounded-none text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("inbox.anySource")}</SelectItem>
                {sources.map((value) => (
                  <SelectItem key={value} value={value}>
                    {sourceLabel(value, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-none"
          disabled={!unread}
          title={t("inbox.markAllRead")}
          aria-label={t("inbox.markAllRead")}
          onClick={() => void setRead("all", true).catch(() => {})}
        >
          <CheckCheck className="size-4" />
        </Button>
        {!compact && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-none"
            title={t("inbox.clearRead")}
            aria-label={t("inbox.clearRead")}
            onClick={() => void clearRead()}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
        {onOpenAll && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-none"
            title={t("inbox.openAll")}
            aria-label={t("inbox.openAll")}
            onClick={onOpenAll}
          >
            <Maximize2 className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center p-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
            <BellOff className="size-6" />
            <p className="text-sm">
              {unreadOnly ? t("inbox.emptyUnread") : t("inbox.empty")}
            </p>
          </div>
        ) : (
          <>
            <AlertList
              items={items}
              compact={compact}
              onOpen={open}
              onToggleRead={(item) =>
                void setRead([item.id], !item.readAt).catch(() => {})
              }
              onDelete={(item) => void remove(item)}
            />
            {hasMore && (
              <div className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full rounded-none text-xs"
                  onClick={() => void loadMore()}
                >
                  {t("inbox.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
