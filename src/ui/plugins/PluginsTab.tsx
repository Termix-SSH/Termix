import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownWideNarrow,
  Check,
  Download,
  Globe,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Input } from "@/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import { EmptyState } from "@/components/empty-state";
import { TabStrip } from "@/components/tab-strip";
import { FakeSwitch } from "@/components/section-card";
import {
  Facts,
  GroupHeading,
  PANEL,
  PanelShell,
} from "@/components/panel-layout";
import { InlineView, SurfaceScope } from "@/components/surface/surface-scope";
import { cn } from "@/lib/utils";
import {
  BetaBadge,
  InstallCountFact,
  PluginIconBox,
  UnverifiedBadge,
} from "./plugin-bits";
import { PluginConsentPrompt } from "./PluginConsentPrompt";
import { PluginDetail } from "./PluginDetail";
import {
  categoriesOf,
  describeContributions,
  isSevere,
  matchesQuery,
  orderByRisk,
  sortPlugins,
  type PluginEntry,
  type SortKey,
} from "./plugin-model";
import { usePluginsManager, type PluginsManager } from "./use-plugins-manager";
import { docsUrl } from "@/lib/docs";
import { DocsLink } from "@/components/docs-link";

type Section = "installed" | "browse" | "updates";

export function PluginsTab() {
  return (
    <SurfaceScope kind="tab" className="h-full min-h-0">
      <PluginsTabBody />
    </SurfaceScope>
  );
}

function PluginsTabBody() {
  const { t } = useTranslation();
  const manager = usePluginsManager();
  const [section, setSection] = useState<Section>("installed");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const installed = manager.plugins.filter((p) => p.installed);
  const available = manager.plugins.filter((p) => p.inRegistry);
  const updates = installed.filter((p) => p.updateAvailable);
  const running = installed.filter((p) => p.status === "running").length;
  const detail = manager.plugins.find((p) => p.id === detailId) ?? null;

  const tabs = [
    {
      id: "installed",
      label: t("plugins.manager.tabs.installed"),
      icon: <Puzzle className="size-3" />,
      count: installed.length,
    },
    {
      id: "browse",
      label: t("plugins.manager.tabs.browse"),
      icon: <Globe className="size-3" />,
    },
    {
      id: "updates",
      label: t("plugins.manager.tabs.updates"),
      icon: <Download className="size-3" />,
      count: updates.filter((p) => !p.pinnedVersion).length || undefined,
    },
  ];

  return (
    <>
      <PanelShell
        icon={<Puzzle className="size-4" />}
        title={t("nav.plugins")}
        docs={docsUrl("plugins")}
        status={t("plugins.manager.status.summary", {
          installed: installed.length,
          running,
        })}
        scroll={false}
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("plugins.manager.checkRegistry")}
            aria-label={t("plugins.manager.checkRegistry")}
            disabled={manager.refreshing}
            onClick={() => void manager.refresh()}
            className="text-muted-foreground"
          >
            <RefreshCw
              className={cn("size-3.5", manager.refreshing && "animate-spin")}
            />
          </Button>
        }
        tabs={
          <TabStrip
            tabs={tabs}
            activeTab={section}
            onTabChange={(id) => setSection(id as Section)}
          />
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
          {manager.managedByServer && (
            <Notice>{t("plugins.manager.managedByServer")}</Notice>
          )}
          {manager.registryError && (
            <Notice>
              {t("plugins.manager.registryUnreachable", {
                error: manager.registryError,
              })}
            </Notice>
          )}
          {manager.loading ? (
            <div className={PANEL.body}>
              <EmptyState icon={Puzzle} title={t("plugins.manager.loading")} />
            </div>
          ) : section === "installed" ? (
            <InstalledSection
              plugins={installed}
              manager={manager}
              query={query}
              onQuery={setQuery}
              onOpen={setDetailId}
            />
          ) : section === "browse" ? (
            <BrowseSection
              plugins={available}
              manager={manager}
              query={query}
              onQuery={setQuery}
              onOpen={setDetailId}
            />
          ) : (
            <UpdatesSection
              plugins={updates}
              manager={manager}
              onOpen={setDetailId}
            />
          )}
        </div>
      </PanelShell>

      <InlineView
        open={!!detail}
        onOpenChange={(open) => !open && setDetailId(null)}
        title={detail?.name ?? ""}
        icon={<Puzzle className="size-4" />}
        width="wide"
        bare
      >
        {detail && (
          <PluginDetail
            plugin={detail}
            manager={manager}
            onUninstalled={() => setDetailId(null)}
          />
        )}
      </InlineView>

      <PluginConsentPrompt
        request={manager.consent}
        onCancel={() => manager.setConsent(null)}
        onConfirm={() => void manager.confirmConsent()}
      />
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-b border-warning/30 bg-warning/5 px-3 py-2">
      <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" />
      <span className="text-[11px] leading-snug text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

function SortSelect({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (next: SortKey) => void;
}) {
  const { t } = useTranslation();
  const keys: SortKey[] = ["popular", "name", "updated", "category"];
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortKey)}>
      <SelectTrigger size="sm" className="w-auto gap-1.5 text-xs">
        <ArrowDownWideNarrow className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {keys.map((key) => (
          <SelectItem key={key} value={key} className="text-xs">
            {t(`plugins.manager.sort.${key}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Toolbar({
  query,
  onQuery,
  placeholder,
  children,
}: {
  query: string;
  onQuery: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 max-w-xs flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="h-8 pl-8 text-xs"
        />
      </div>
      {children}
    </div>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <GroupHeading title={title} count={count} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function InstalledSection({
  plugins,
  manager,
  query,
  onQuery,
  onOpen,
}: {
  plugins: PluginEntry[];
  manager: PluginsManager;
  query: string;
  onQuery: (v: string) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortKey>("name");
  const rows = sortPlugins(
    plugins.filter((p) => matchesQuery(p, query)),
    sort,
  );
  const running = rows.filter((p) => p.status === "running");
  const stopped = rows.filter((p) => p.status !== "running");
  const pending = plugins.filter((p) => p.updateAvailable && !p.pinnedVersion);

  return (
    <div className={`flex flex-col ${PANEL.gap} ${PANEL.body}`}>
      <Toolbar
        query={query}
        onQuery={onQuery}
        placeholder={t("plugins.manager.searchInstalled")}
      >
        <div className="ml-auto flex items-center gap-2">
          <SortSelect value={sort} onChange={setSort} />
          {manager.developerMode && !manager.signedOnly && (
            <UploadButton manager={manager} />
          )}
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={
              pending.length === 0 ||
              manager.busy.size > 0 ||
              manager.managedByServer
            }
            onClick={() => void manager.updateAll()}
          >
            <Download className="size-3.5" />
            {t("plugins.manager.updateAll")}
          </Button>
        </div>
      </Toolbar>

      {rows.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title={
            plugins.length === 0
              ? t("plugins.manager.noneInstalled")
              : t("plugins.manager.nothingMatches")
          }
        />
      ) : (
        <>
          {running.length > 0 && (
            <Group
              title={t("plugins.manager.groups.running")}
              count={running.length}
            >
              {running.map((p) => (
                <InstalledCard
                  key={p.id}
                  plugin={p}
                  manager={manager}
                  onOpen={() => onOpen(p.id)}
                />
              ))}
            </Group>
          )}
          {stopped.length > 0 && (
            <Group
              title={t("plugins.manager.groups.notRunning")}
              count={stopped.length}
            >
              {stopped.map((p) => (
                <InstalledCard
                  key={p.id}
                  plugin={p}
                  manager={manager}
                  onOpen={() => onOpen(p.id)}
                />
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}

function UploadButton({ manager }: { manager: PluginsManager }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".tmxplug"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void manager.requestUpload(file);
        }}
      />
      <Button
        variant="outline"
        className="gap-1.5"
        disabled={manager.busy.size > 0 || manager.managedByServer}
        onClick={() => input.current?.click()}
      >
        <Upload className="size-3.5" />
        {t("plugins.manager.developer.installFromFile")}
      </Button>
    </>
  );
}

function CardHead({
  plugin,
  muted,
  facts,
  onOpen,
}: {
  plugin: PluginEntry;
  muted?: boolean;
  facts: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group/open flex flex-1 items-start gap-3 p-3 text-left"
    >
      <PluginIconBox name={plugin.icon} muted={muted} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(
            "truncate text-sm font-semibold transition-colors group-hover/open:text-accent-brand",
            muted && "text-muted-foreground",
          )}
        >
          {plugin.name}
        </span>
        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {plugin.description}
        </span>
        <Facts className="text-[10px] text-muted-foreground/70">{facts}</Facts>
      </div>
    </button>
  );
}

function InstalledCard({
  plugin,
  manager,
  onOpen,
}: {
  plugin: PluginEntry;
  manager: PluginsManager;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const running = plugin.status === "running";
  const failed = plugin.status === "failed" || plugin.status === "blocked";
  const busy = manager.busy.has(plugin.id) || manager.busy.has("*");
  const locked = manager.managedByServer;
  const adds = describeContributions(plugin.contributes)
    .slice(0, 3)
    .map((c) => t(`plugins.manager.contributes.${c.kind}`, { count: c.count }));

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHead
        plugin={plugin}
        muted={!running}
        onOpen={onOpen}
        facts={
          <>
            {plugin.unverified && <UnverifiedBadge />}
            {plugin.isBeta && <BetaBadge />}
            {plugin.author && <span>{plugin.author}</span>}
            <span>v{plugin.version}</span>
            {adds.length > 0 && <span>{adds.join(", ")}</span>}
          </>
        }
      />

      {failed ? (
        <div className="flex items-center gap-2 border-t border-border bg-destructive/5 px-3 py-2">
          <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
          <span
            className="flex-1 truncate text-[11px] text-muted-foreground"
            title={plugin.lastError ?? undefined}
          >
            {plugin.status === "blocked"
              ? t("plugins.manager.status.blocked")
              : t("plugins.manager.status.failed")}
          </span>
        </div>
      ) : !running ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span className="size-1.5 shrink-0 bg-muted-foreground/40" />
          <span className="text-[11px] text-muted-foreground">
            {t("plugins.manager.status.disabled")}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span className="size-1.5 shrink-0 bg-green-500" />
          <span className="text-[11px] text-muted-foreground">
            {plugin.pinnedVersion
              ? t("plugins.manager.pinnedTo", {
                  version: plugin.pinnedVersion,
                })
              : t("plugins.manager.status.running")}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t border-border px-3 py-2">
        {plugin.updateAvailable && !plugin.pinnedVersion && !failed && (
          <Button
            variant="outline"
            size="xs"
            className="gap-1 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
            disabled={busy || locked}
            onClick={() => void manager.requestUpdate(plugin)}
          >
            <Download className="size-3" />
            {plugin.addedCapabilities.length > 0
              ? t("plugins.manager.reviewUpdate")
              : t("plugins.manager.updateTo", {
                  version: plugin.latestVersion,
                })}
          </Button>
        )}
        {failed ? (
          <Button
            variant="outline"
            size="xs"
            className="gap-1"
            disabled={busy || locked}
            onClick={() => void manager.retry(plugin)}
          >
            <RotateCcw className="size-3" />
            {t("plugins.manager.restart")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="xs"
            disabled={busy || locked}
            onClick={() => void manager.toggle(plugin)}
          >
            {plugin.enabled
              ? t("plugins.manager.disable")
              : t("plugins.manager.enable")}
          </Button>
        )}
        <DocsLink
          href={plugin.docs}
          variant="icon"
          className="ml-auto size-6"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy || locked}
          title={t("plugins.manager.uninstall")}
          aria-label={t("plugins.manager.uninstall")}
          className={cn(
            "text-muted-foreground hover:text-destructive",
            !plugin.docs && "ml-auto",
          )}
          onClick={() => void manager.uninstall(plugin)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </Card>
  );
}

function BrowseSection({
  plugins,
  manager,
  query,
  onQuery,
  onOpen,
}: {
  plugins: PluginEntry[];
  manager: PluginsManager;
  query: string;
  onQuery: (v: string) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("popular");
  const categories = useMemo(() => categoriesOf(plugins), [plugins]);

  const rows = sortPlugins(
    plugins.filter(
      (p) =>
        matchesQuery(p, query) &&
        (category === null || p.category === category),
    ),
    sort,
  );

  return (
    <div className={`flex flex-col ${PANEL.gap} ${PANEL.body}`}>
      <Toolbar
        query={query}
        onQuery={onQuery}
        placeholder={t("plugins.manager.searchPlugins")}
      >
        <div className="ml-auto flex items-center gap-2">
          <SortSelect value={sort} onChange={setSort} />
        </div>
      </Toolbar>

      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {[null, ...categories].map((c) => (
            <button
              key={c ?? "__all"}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "border px-2 py-1 text-[11px] font-medium transition-colors",
                category === c
                  ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c ?? t("plugins.manager.allCategories")}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title={t("plugins.manager.nothingHere")}
          hint={
            plugins.length === 0
              ? undefined
              : t("plugins.manager.nothingHereHint")
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((p) => (
            <BrowseCard
              key={p.id}
              plugin={p}
              manager={manager}
              onOpen={() => onOpen(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BrowseCard({
  plugin,
  manager,
  onOpen,
}: {
  plugin: PluginEntry;
  manager: PluginsManager;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const severe = orderByRisk(plugin.capabilities).filter(isSevere);
  const busy = manager.busy.has(plugin.id) || manager.busy.has("*");

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHead
        plugin={plugin}
        onOpen={onOpen}
        facts={
          <>
            {plugin.author && <span>{plugin.author}</span>}
            {plugin.latestVersion && <span>v{plugin.latestVersion}</span>}
            {plugin.category && <span>{plugin.category}</span>}
            <InstallCountFact
              count={plugin.installCount}
              source={plugin.installCountSource}
            />
          </>
        }
      />
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {severe.length > 0
            ? t(`plugins.capabilities.${severe[0]}.title`, {
                defaultValue: severe[0],
                nsSeparator: false,
              })
            : t("plugins.manager.noServerAccess")}
        </span>
        <DocsLink href={plugin.docs} variant="icon" className="size-6" />
        {plugin.installed ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent-brand">
            <Check className="size-3" />
            {t("plugins.manager.installedBadge")}
          </span>
        ) : (
          <Button
            variant="outline"
            size="xs"
            disabled={busy || manager.managedByServer || !plugin.latestVersion}
            onClick={() => manager.requestInstall(plugin)}
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
          >
            {t("plugins.manager.install")}
          </Button>
        )}
      </div>
    </Card>
  );
}

function UpdatesSection({
  plugins,
  manager,
  onOpen,
}: {
  plugins: PluginEntry[];
  manager: PluginsManager;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const pinned = plugins.filter((p) => p.pinnedVersion);
  const open = plugins.filter((p) => !p.pinnedVersion);
  const gated = open.filter((p) => p.addedCapabilities.length > 0);
  const plain = open.filter((p) => p.addedCapabilities.length === 0);

  if (plugins.length === 0) {
    return (
      <div className={PANEL.body}>
        <EmptyState
          icon={Check}
          title={t("plugins.manager.upToDate")}
          hint={
            manager.lastCheckedAt
              ? t("plugins.manager.lastChecked", {
                  time: new Date(manager.lastCheckedAt).toLocaleString(),
                })
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${PANEL.gap} ${PANEL.body}`}>
      {plain.length > 0 && (
        <Card className="flex-row items-center gap-3 px-3 py-2.5">
          <span className="flex-1 text-xs text-muted-foreground">
            {t("plugins.manager.updatesReady", { count: plain.length })}
            {gated.length > 0 &&
              ` ${t("plugins.manager.updatesNeedReview", { count: gated.length })}`}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
            disabled={manager.busy.size > 0 || manager.managedByServer}
            onClick={() => void manager.updateAll()}
          >
            <Download className="size-3.5" />
            {t("plugins.manager.updateAll")}
          </Button>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {[...gated, ...plain, ...pinned].map((p) => (
          <UpdateRow
            key={p.id}
            plugin={p}
            manager={manager}
            onOpen={() => onOpen(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function UpdateRow({
  plugin,
  manager,
  onOpen,
}: {
  plugin: PluginEntry;
  manager: PluginsManager;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const gated = plugin.addedCapabilities.length > 0;
  const busy = manager.busy.has(plugin.id) || manager.busy.has("*");
  const notes = plugin.versions.find((v) => v.version === plugin.latestVersion);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start gap-3 p-3">
        <PluginIconBox name={plugin.icon} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpen}
              className="truncate text-sm font-semibold hover:text-accent-brand"
            >
              {plugin.name}
            </button>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t("plugins.manager.versionChange", {
                from: plugin.version,
                to: plugin.latestVersion,
              })}
            </span>
          </div>
          {plugin.pinnedVersion ? (
            <span className="text-[11px] leading-snug text-muted-foreground">
              {t("plugins.manager.pinnedTo", { version: plugin.pinnedVersion })}
            </span>
          ) : gated ? (
            <span className="text-[11px] leading-snug text-muted-foreground">
              {t("plugins.manager.updateAsksMore")}
            </span>
          ) : null}
          {notes?.releaseNotesUrl && (
            <a
              href={notes.releaseNotesUrl}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-[11px] text-muted-foreground hover:text-accent-brand"
            >
              {t("plugins.manager.releaseNotes")}
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">
              {t("plugins.manager.auto")}
            </span>
            <FakeSwitch
              checked={plugin.autoUpdate}
              disabled={
                busy || manager.managedByServer || !!plugin.pinnedVersion
              }
              onChange={(v) =>
                void manager.setOptions(plugin, { autoUpdate: v })
              }
            />
          </label>
          {!plugin.pinnedVersion && (
            <Button
              variant="outline"
              size="xs"
              disabled={busy || manager.managedByServer}
              onClick={() => void manager.requestUpdate(plugin)}
              className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand dark:border-accent-brand/40 dark:bg-transparent dark:hover:bg-accent-brand/10"
            >
              {gated
                ? t("plugins.manager.review")
                : t("plugins.manager.update")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
