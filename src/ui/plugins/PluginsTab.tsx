import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownWideNarrow,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe,
  Library,
  ListFilter,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  Upload,
  X,
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
  GRID_SIZES,
  ViewToggle,
  type GridSize,
  type PanelViewMode,
} from "@/components/panel-layout";
import { DataView, type DataColumn } from "@/components/data-view";
import { InlineView, SurfaceScope } from "@/components/surface/surface-scope";
import { cn } from "@/lib/utils";
import {
  BetaBadge,
  DownloadCount,
  PluginIconBox,
  SourceBadge,
  UnverifiedBadge,
} from "./plugin-bits";
import { RegistriesSection } from "./RegistriesSection";
import { PluginConsentPrompt } from "./PluginConsentPrompt";
import { PluginDetail } from "./PluginDetail";
import {
  categoriesOf,
  describeContributions,
  isSevere,
  kindsOf,
  matchesQuery,
  orderByRisk,
  pageOf,
  sortPlugins,
  type PluginEntry,
  type PluginKind,
  type SortKey,
} from "./plugin-model";
import { usePluginsManager, type PluginsManager } from "./use-plugins-manager";
import { docsUrl } from "@/lib/docs";
import { DocsLink } from "@/components/docs-link";

type Section = "installed" | "browse" | "updates" | "registries";

interface Layout {
  view: PanelViewMode;
  columns: GridSize;
}

function useStoredChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return allowed.includes(saved as T) ? (saved as T) : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // blocked storage just means the choice won't stick
    }
  }, [key, value]);
  return [value, setValue] as const;
}

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
  const [view, setView] = useStoredChoice<PanelViewMode>(
    "pluginsTab.view",
    ["grid", "list"],
    "grid",
  );
  const [columns, setColumns] = useStoredChoice<GridSize>(
    "pluginsTab.columns",
    GRID_SIZES,
    "auto",
  );
  const layout: Layout = { view, columns };
  const layoutControls = (
    <LayoutControls layout={layout} onView={setView} onColumns={setColumns} />
  );

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
    {
      id: "registries",
      label: t("plugins.manager.tabs.registries"),
      icon: <Library className="size-3" />,
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
        <div className="flex min-h-0 flex-1 flex-col">
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
              layout={layout}
              layoutControls={layoutControls}
            />
          ) : section === "browse" ? (
            <BrowseSection
              plugins={available}
              manager={manager}
              query={query}
              onQuery={setQuery}
              onOpen={setDetailId}
              layout={layout}
              layoutControls={layoutControls}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
              {section === "updates" ? (
                <UpdatesSection
                  plugins={updates}
                  manager={manager}
                  onOpen={setDetailId}
                />
              ) : (
                <RegistriesSection manager={manager} />
              )}
            </div>
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
      <div className="relative min-w-40 max-w-md flex-1">
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
      {children}
    </section>
  );
}

function LayoutControls({
  layout,
  onView,
  onColumns,
}: {
  layout: Layout;
  onView: (next: PanelViewMode) => void;
  onColumns: (next: GridSize) => void;
}) {
  return (
    <ViewToggle
      view={layout.view}
      onView={onView}
      columns={layout.columns}
      onColumns={onColumns}
    />
  );
}

function PluginCollection({
  plugins,
  layout,
  renderCard,
  listColumns,
  onOpen,
}: {
  plugins: PluginEntry[];
  layout: Layout;
  renderCard: (plugin: PluginEntry) => React.ReactNode;
  listColumns: DataColumn<PluginEntry>[];
  onOpen: (id: string) => void;
}) {
  if (layout.view === "list") {
    return (
      <DataView
        items={plugins}
        view="list"
        getKey={(p) => p.id}
        renderCard={renderCard}
        columns={{}}
        listColumns={listColumns}
        onRowClick={(p) => onOpen(p.id)}
        empty={null}
      />
    );
  }
  return (
    <DataView
      items={plugins}
      view="grid"
      getKey={(p) => p.id}
      renderCard={renderCard}
      columns={{}}
      size={layout.columns}
      minCardWidth={400}
      listColumns={listColumns}
      empty={null}
    />
  );
}

function NameCell({ plugin, muted }: { plugin: PluginEntry; muted?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PluginIconBox name={plugin.icon} size="sm" muted={muted} />
      <span
        className={cn(
          "truncate font-semibold",
          muted && "text-muted-foreground",
        )}
      >
        {plugin.name}
      </span>
      {plugin.unverified && <UnverifiedBadge />}
      <SourceBadge source={plugin.source} registryName={plugin.registryName} />
      {plugin.isBeta && <BetaBadge />}
    </div>
  );
}

function DescriptionCell({ plugin }: { plugin: PluginEntry }) {
  return (
    <span className="text-muted-foreground" title={plugin.description}>
      {plugin.description}
    </span>
  );
}

function stop(e: React.MouseEvent) {
  e.stopPropagation();
}

interface Facets {
  kind: PluginKind | null;
  category: string | null;
  registry: string | null;
}

const NO_FACETS: Facets = { kind: null, category: null, registry: null };

/** Rows that pass every facet but `skip`, so a group counts what picking it would show. */
function applyFacets(
  rows: PluginEntry[],
  facets: Facets,
  skip?: keyof Facets,
): PluginEntry[] {
  return rows.filter(
    (p) =>
      (skip === "kind" || !facets.kind || p.kinds.includes(facets.kind)) &&
      (skip === "category" ||
        !facets.category ||
        p.category === facets.category) &&
      (skip === "registry" ||
        !facets.registry ||
        p.registryId === facets.registry),
  );
}

function activeFacets(facets: Facets): number {
  return [facets.kind, facets.category, facets.registry].filter(Boolean).length;
}

const PAGE_SIZES = ["24", "48", "96"] as const;
type PageSize = (typeof PAGE_SIZES)[number];

/** A page number that goes back to 1 whenever what is listed changes. */
function usePage(signature: string) {
  const [state, setState] = useState({ signature, page: 1 });
  const page = state.signature === signature ? state.page : 1;
  return [page, (next: number) => setState({ signature, page: next })] as const;
}

function FacetGroup<T extends string>({
  title,
  allLabel,
  options,
  value,
  onChange,
}: {
  title: string;
  allLabel: string;
  options: Array<{ value: T; label: string; count: number }>;
  value: T | null;
  onChange: (next: T | null) => void;
}) {
  if (options.length === 0) return null;
  const row = (key: T | null, label: string, count?: number) => {
    const active = value === key;
    return (
      <button
        key={key ?? "__all"}
        type="button"
        aria-pressed={active}
        onClick={() => onChange(key)}
        className={cn(
          "flex w-full items-center gap-2 border-l-2 px-2.5 py-1 text-left text-xs transition-colors",
          active
            ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
            : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          count === 0 && !active && "opacity-50",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && (
          <span className="shrink-0 text-[10px] tabular-nums opacity-70">
            {count}
          </span>
        )}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {title}
      </span>
      {row(null, allLabel)}
      {options.map((o) => row(o.value, o.label, o.count))}
    </div>
  );
}

function FilterRail({
  rows,
  facets,
  onFacets,
  registries,
  children,
}: {
  /** What the search and toggles leave, before any facet. */
  rows: PluginEntry[];
  facets: Facets;
  onFacets: (next: Facets) => void;
  registries?: Array<{ id: string; name: string }>;
  /** Toggles shown under the groups. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const byKind = applyFacets(rows, facets, "kind");
  const kinds = kindsOf(rows).map(({ kind }) => ({
    value: kind,
    label: t(`plugins.manager.kinds.${kind}`),
    count: byKind.filter((p) => p.kinds.includes(kind)).length,
  }));
  const byCategory = applyFacets(rows, facets, "category");
  const categories = categoriesOf(rows).map((c) => ({
    value: c,
    label: c,
    count: byCategory.filter((p) => p.category === c).length,
  }));
  const byRegistry = applyFacets(rows, facets, "registry");
  const registryOptions =
    registries && registries.length > 1
      ? registries.map((r) => ({
          value: r.id,
          label: r.name,
          count: byRegistry.filter((p) => p.registryId === r.id).length,
        }))
      : [];
  return (
    <div className="flex flex-col gap-4 py-3">
      <FacetGroup
        title={t("plugins.manager.filters.type")}
        allLabel={t("plugins.manager.filters.allTypes")}
        options={kinds}
        value={facets.kind}
        onChange={(kind) => onFacets({ ...facets, kind })}
      />
      <FacetGroup
        title={t("plugins.manager.filters.category")}
        allLabel={t("plugins.manager.filters.allCategories")}
        options={categories}
        value={facets.category}
        onChange={(category) => onFacets({ ...facets, category })}
      />
      <FacetGroup
        title={t("plugins.manager.registries.filter")}
        allLabel={t("plugins.manager.registries.allRegistries")}
        options={registryOptions}
        value={facets.registry}
        onChange={(registry) => onFacets({ ...facets, registry })}
      />
      {children && (
        <div className="flex flex-col gap-2.5 border-t border-border px-2.5 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function RailToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2" title={hint}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <FakeSwitch checked={checked} onChange={onChange} />
    </label>
  );
}

/** Chips for the picked facets, so it is clear why the list is short. */
function ActiveFilters({
  facets,
  onFacets,
  registries,
  shown,
}: {
  facets: Facets;
  onFacets: (next: Facets) => void;
  registries?: Array<{ id: string; name: string }>;
  shown: number;
}) {
  const { t } = useTranslation();
  const chips: Array<{ key: keyof Facets; label: string }> = [];
  if (facets.kind) {
    chips.push({
      key: "kind",
      label: t(`plugins.manager.kinds.${facets.kind}`),
    });
  }
  if (facets.category) chips.push({ key: "category", label: facets.category });
  if (facets.registry) {
    chips.push({
      key: "registry",
      label:
        registries?.find((r) => r.id === facets.registry)?.name ??
        facets.registry,
    });
  }
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">
        {t("plugins.manager.filters.results", { count: shown })}
      </span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onFacets({ ...facets, [chip.key]: null })}
          className="flex items-center gap-1 border border-accent-brand/40 bg-accent-brand/10 px-1.5 py-0.5 text-[11px] text-accent-brand hover:bg-accent-brand/20"
          aria-label={t("plugins.manager.filters.remove", {
            name: chip.label,
          })}
        >
          {chip.label}
          <X className="size-3" />
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={() => onFacets(NO_FACETS)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {t("plugins.manager.filters.clear")}
        </button>
      )}
    </div>
  );
}

function Pager({
  page,
  pages,
  total,
  size,
  onPage,
  onSize,
}: {
  page: number;
  pages: number;
  total: number;
  size: PageSize;
  onPage: (next: number) => void;
  onSize: (next: PageSize) => void;
}) {
  const { t } = useTranslation();
  const per = Number(size);
  if (total <= Number(PAGE_SIZES[0])) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {t("plugins.manager.pager.range", {
          from: (page - 1) * per + 1,
          to: Math.min(page * per, total),
          total,
        })}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <Select value={size} onValueChange={(v) => onSize(v as PageSize)}>
          <SelectTrigger
            size="sm"
            className="w-auto text-xs"
            aria-label={t("plugins.manager.pager.perPageLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={n} className="text-xs">
                {t("plugins.manager.pager.perPage", { count: Number(n) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          title={t("plugins.manager.pager.previous")}
          aria-label={t("plugins.manager.pager.previous")}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
          {t("plugins.manager.pager.page", { page, pages })}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          title={t("plugins.manager.pager.next")}
          aria-label={t("plugins.manager.pager.next")}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Filters in a rail beside the results. A narrow tab folds the rail behind
 * a Filters button instead.
 */
function FilteredLayout({
  rail,
  activeCount,
  scrollRef,
  children,
}: {
  rail: React.ReactNode;
  activeCount: number;
  scrollRef?: React.Ref<HTMLDivElement>;
  children: (filtersButton: React.ReactNode) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      variant="outline"
      className={cn(
        "gap-1.5 @3xl:hidden",
        activeCount > 0 && "border-accent-brand/40 text-accent-brand",
      )}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      <ListFilter className="size-3.5" />
      {activeCount > 0
        ? t("plugins.manager.filters.buttonCount", { count: activeCount })
        : t("plugins.manager.filters.button")}
    </Button>
  );
  return (
    <div className="@container flex min-h-0 flex-1">
      <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-border thin-scrollbar @3xl:block">
        {rail}
      </aside>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto thin-scrollbar"
      >
        {open && (
          <div className="border-b border-border @3xl:hidden">{rail}</div>
        )}
        {children(button)}
      </div>
    </div>
  );
}

function InstalledSection({
  plugins,
  manager,
  query,
  onQuery,
  onOpen,
  layout,
  layoutControls,
}: {
  plugins: PluginEntry[];
  manager: PluginsManager;
  query: string;
  onQuery: (v: string) => void;
  onOpen: (id: string) => void;
  layout: Layout;
  layoutControls: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<SortKey>("name");
  const [facets, setFacets] = useState<Facets>(NO_FACETS);
  const searched = plugins.filter((p) => matchesQuery(p, query));
  const rows = sortPlugins(applyFacets(searched, facets), sort);
  const running = rows.filter((p) => p.status === "running");
  const onServer = rows.filter((p) => p.status === "server");
  const stopped = rows.filter(
    (p) => p.status !== "running" && p.status !== "server",
  );
  const pending = plugins.filter((p) => p.updateAvailable && !p.pinnedVersion);

  const listColumns: DataColumn<PluginEntry>[] = [
    {
      key: "name",
      header: t("plugins.manager.table.name"),
      width: "minmax(0,1.3fr)",
      cell: (p) => <NameCell plugin={p} muted={p.status !== "running"} />,
    },
    {
      key: "description",
      header: t("plugins.manager.table.description"),
      width: "minmax(0,2fr)",
      hideBelow: "md",
      cell: (p) => <DescriptionCell plugin={p} />,
    },
    {
      key: "version",
      header: t("plugins.manager.table.version"),
      width: "80px",
      cell: (p) => (
        <span className="tabular-nums text-muted-foreground">v{p.version}</span>
      ),
    },
    {
      key: "status",
      header: t("plugins.manager.table.status"),
      width: "140px",
      hideBelow: "lg",
      cell: (p) => <StatusCell plugin={p} />,
    },
    {
      key: "actions",
      header: "",
      width: "150px",
      align: "end",
      cell: (p) => <InstalledRowActions plugin={p} manager={manager} />,
    },
  ];
  const collection = (items: PluginEntry[]) => (
    <PluginCollection
      plugins={items}
      layout={layout}
      renderCard={(p) => (
        <InstalledCard
          plugin={p}
          manager={manager}
          onOpen={() => onOpen(p.id)}
        />
      )}
      listColumns={listColumns}
      onOpen={onOpen}
    />
  );

  return (
    <FilteredLayout
      activeCount={activeFacets(facets)}
      rail={<FilterRail rows={searched} facets={facets} onFacets={setFacets} />}
    >
      {(filtersButton) => (
        <div className={`flex flex-col ${PANEL.gap} ${PANEL.body}`}>
          <Toolbar
            query={query}
            onQuery={onQuery}
            placeholder={t("plugins.manager.searchInstalled")}
          >
            {filtersButton}
            <div className="ml-auto flex items-center gap-2">
              <SortSelect value={sort} onChange={setSort} />
              {layoutControls}
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

          {activeFacets(facets) > 0 && (
            <ActiveFilters
              facets={facets}
              onFacets={setFacets}
              shown={rows.length}
            />
          )}

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
                  {collection(running)}
                </Group>
              )}
              {onServer.length > 0 && (
                <Group
                  title={t("plugins.manager.groups.onServer")}
                  count={onServer.length}
                >
                  {collection(onServer)}
                </Group>
              )}
              {stopped.length > 0 && (
                <Group
                  title={t("plugins.manager.groups.notRunning")}
                  count={stopped.length}
                >
                  {collection(stopped)}
                </Group>
              )}
            </>
          )}
        </div>
      )}
    </FilteredLayout>
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
            <SourceBadge
              source={plugin.source}
              registryName={plugin.registryName}
            />
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
            {plugin.status === "server"
              ? t("plugins.manager.status.server")
              : plugin.status === "safeMode"
                ? t("plugins.manager.status.safeMode")
                : t("plugins.manager.status.disabled")}
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
            disabled={busy || plugin.managedByServer}
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
        {!plugin.defaultLook && (
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
        )}
      </div>
    </Card>
  );
}

function StatusCell({ plugin }: { plugin: PluginEntry }) {
  const { t } = useTranslation();
  const running = plugin.status === "running";
  const failed = plugin.status === "failed" || plugin.status === "blocked";
  const label =
    plugin.status === "blocked"
      ? t("plugins.manager.status.blocked")
      : failed
        ? t("plugins.manager.status.failed")
        : plugin.status === "server"
          ? t("plugins.manager.status.server")
          : plugin.status === "safeMode"
            ? t("plugins.manager.status.safeMode")
            : !running
              ? t("plugins.manager.status.disabled")
              : plugin.pinnedVersion
                ? t("plugins.manager.pinnedTo", {
                    version: plugin.pinnedVersion,
                  })
                : t("plugins.manager.status.running");
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-muted-foreground"
      title={failed ? (plugin.lastError ?? undefined) : undefined}
    >
      {failed ? (
        <TriangleAlert className="size-3 shrink-0 text-destructive" />
      ) : (
        <span
          className={cn(
            "size-1.5 shrink-0",
            running ? "bg-green-500" : "bg-muted-foreground/40",
          )}
        />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

function InstalledRowActions({
  plugin,
  manager,
}: {
  plugin: PluginEntry;
  manager: PluginsManager;
}) {
  const { t } = useTranslation();
  const failed = plugin.status === "failed" || plugin.status === "blocked";
  const busy = manager.busy.has(plugin.id) || manager.busy.has("*");
  const locked = manager.managedByServer;
  const updateLabel =
    plugin.addedCapabilities.length > 0
      ? t("plugins.manager.reviewUpdate")
      : t("plugins.manager.updateTo", { version: plugin.latestVersion });

  return (
    <div className="flex items-center justify-end gap-1" onClick={stop}>
      {plugin.updateAvailable && !plugin.pinnedVersion && !failed && (
        <Button
          variant="ghost"
          size="icon-xs"
          title={updateLabel}
          aria-label={updateLabel}
          className="text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
          disabled={busy || locked}
          onClick={() => void manager.requestUpdate(plugin)}
        >
          <Download className="size-3" />
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
          disabled={busy || plugin.managedByServer}
          onClick={() => void manager.toggle(plugin)}
        >
          {plugin.enabled
            ? t("plugins.manager.disable")
            : t("plugins.manager.enable")}
        </Button>
      )}
      <DocsLink href={plugin.docs} variant="icon" className="size-6" />
      {!plugin.defaultLook && (
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={busy || locked}
          title={t("plugins.manager.uninstall")}
          aria-label={t("plugins.manager.uninstall")}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => void manager.uninstall(plugin)}
        >
          <Trash2 className="size-3" />
        </Button>
      )}
    </div>
  );
}

function BrowseSection({
  plugins,
  manager,
  query,
  onQuery,
  onOpen,
  layout,
  layoutControls,
}: {
  plugins: PluginEntry[];
  manager: PluginsManager;
  query: string;
  onQuery: (v: string) => void;
  onOpen: (id: string) => void;
  layout: Layout;
  layoutControls: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [facets, setFacets] = useState<Facets>(NO_FACETS);
  const [sort, setSort] = useState<SortKey>("popular");
  const [installedChoice, setInstalledChoice] = useStoredChoice(
    "pluginsTab.browseInstalled",
    ["hide", "show"],
    "hide",
  );
  const [unsupportedChoice, setUnsupportedChoice] = useStoredChoice(
    "pluginsTab.browseUnsupported",
    ["hide", "show"],
    "hide",
  );
  const [pageSize, setPageSize] = useStoredChoice<PageSize>(
    "pluginsTab.pageSize",
    PAGE_SIZES,
    "24",
  );
  const scroller = useRef<HTMLDivElement>(null);
  const showInstalled = installedChoice === "show";
  const showUnsupported = unsupportedChoice === "show";
  const registries = manager.registries;
  const unsupportedCount = plugins.filter(
    (p) => p.unsupported && !p.installed,
  ).length;

  const searched = plugins.filter(
    (p) =>
      (showInstalled || !p.installed) &&
      (showUnsupported || !p.unsupported || p.installed) &&
      matchesQuery(p, query),
  );
  const rows = sortPlugins(applyFacets(searched, facets), sort);
  const [page, setPage] = usePage(
    JSON.stringify([query, facets, sort, showInstalled, showUnsupported]),
  );
  const paged = pageOf(rows, page, Number(pageSize));
  const goTo = (next: number) => {
    setPage(next);
    if (scroller.current) scroller.current.scrollTop = 0;
  };

  const allInstalledHidden =
    !showInstalled && plugins.length > 0 && plugins.every((p) => p.installed);

  const listColumns: DataColumn<PluginEntry>[] = [
    {
      key: "name",
      header: t("plugins.manager.table.name"),
      width: "minmax(0,1.3fr)",
      cell: (p) => <NameCell plugin={p} muted={p.unsupported} />,
    },
    {
      key: "description",
      header: t("plugins.manager.table.description"),
      width: "minmax(0,2fr)",
      hideBelow: "md",
      cell: (p) => <DescriptionCell plugin={p} />,
    },
    {
      key: "category",
      header: t("plugins.manager.table.category"),
      width: "120px",
      hideBelow: "lg",
      cell: (p) => (
        <span className="text-muted-foreground">{p.category ?? ""}</span>
      ),
    },
    {
      key: "downloads",
      header: t("plugins.manager.table.downloads"),
      width: "110px",
      hideBelow: "lg",
      cell: (p) => (
        <span className="text-muted-foreground">
          <DownloadCount count={p.downloads} />
        </span>
      ),
    },
    {
      key: "version",
      header: t("plugins.manager.table.version"),
      width: "80px",
      cell: (p) => (
        <span className="tabular-nums text-muted-foreground">
          {p.latestVersion ? `v${p.latestVersion}` : ""}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      width: "150px",
      align: "end",
      cell: (p) => <BrowseAction plugin={p} manager={manager} />,
    },
  ];

  return (
    <FilteredLayout
      activeCount={activeFacets(facets)}
      scrollRef={scroller}
      rail={
        <FilterRail
          rows={searched}
          facets={facets}
          onFacets={setFacets}
          registries={registries}
        >
          <RailToggle
            label={t("plugins.manager.showInstalled")}
            checked={showInstalled}
            onChange={(v) => setInstalledChoice(v ? "show" : "hide")}
          />
          {unsupportedCount > 0 && (
            <RailToggle
              label={t("plugins.manager.showUnsupported", {
                count: unsupportedCount,
              })}
              hint={t("plugins.manager.showUnsupportedHint")}
              checked={showUnsupported}
              onChange={(v) => setUnsupportedChoice(v ? "show" : "hide")}
            />
          )}
        </FilterRail>
      }
    >
      {(filtersButton) => (
        <div className={`flex flex-col ${PANEL.gap} ${PANEL.body}`}>
          <Toolbar
            query={query}
            onQuery={onQuery}
            placeholder={t("plugins.manager.searchPlugins")}
          >
            {filtersButton}
            <div className="ml-auto flex items-center gap-2">
              <SortSelect value={sort} onChange={setSort} />
              {layoutControls}
            </div>
          </Toolbar>

          <ActiveFilters
            facets={facets}
            onFacets={setFacets}
            registries={registries}
            shown={rows.length}
          />

          {rows.length === 0 ? (
            allInstalledHidden ? (
              <EmptyState
                icon={Puzzle}
                title={t("plugins.manager.allInstalled")}
                hint={t("plugins.manager.allInstalledHint")}
              />
            ) : (
              <EmptyState
                icon={Puzzle}
                title={t("plugins.manager.nothingHere")}
                hint={
                  plugins.length === 0
                    ? undefined
                    : t("plugins.manager.nothingHereHint")
                }
              />
            )
          ) : (
            <PluginCollection
              plugins={paged.items}
              layout={layout}
              renderCard={(p) => (
                <BrowseCard
                  plugin={p}
                  manager={manager}
                  onOpen={() => onOpen(p.id)}
                />
              )}
              listColumns={listColumns}
              onOpen={onOpen}
            />
          )}

          <Pager
            page={paged.page}
            pages={paged.pages}
            total={rows.length}
            size={pageSize}
            onPage={goTo}
            onSize={(next) => {
              setPageSize(next);
              goTo(1);
            }}
          />

          <p className="text-[11px] text-muted-foreground">
            {t("plugins.manager.registries.browseHint")}{" "}
            <DocsLink core="communityRegistry" className="text-[11px]">
              {t("plugins.manager.communitySubmit")}
            </DocsLink>
          </p>
        </div>
      )}
    </FilteredLayout>
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

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHead
        plugin={plugin}
        muted={plugin.unsupported}
        onOpen={onOpen}
        facts={
          <>
            <SourceBadge
              source={plugin.source}
              registryName={plugin.registryName}
            />
            {plugin.author && <span>{plugin.author}</span>}
            {plugin.latestVersion && <span>v{plugin.latestVersion}</span>}
            {plugin.category && <span>{plugin.category}</span>}
            <DownloadCount count={plugin.downloads} />
          </>
        }
      />
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
          {plugin.unsupported && !plugin.installed
            ? ""
            : severe.length > 0
              ? t(`plugins.capabilities.${severe[0]}.title`, {
                  defaultValue: severe[0],
                  nsSeparator: false,
                })
              : t("plugins.manager.noServerAccess")}
        </span>
        <BrowseAction plugin={plugin} manager={manager} />
      </div>
    </Card>
  );
}

function BrowseAction({
  plugin,
  manager,
}: {
  plugin: PluginEntry;
  manager: PluginsManager;
}) {
  const { t } = useTranslation();
  const busy = manager.busy.has(plugin.id) || manager.busy.has("*");
  return (
    <div
      className="flex shrink-0 items-center justify-end gap-2"
      onClick={stop}
    >
      <DocsLink href={plugin.docs} variant="icon" className="size-6" />
      {plugin.installed ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent-brand">
          <Check className="size-3" />
          {t("plugins.manager.installedBadge")}
        </span>
      ) : plugin.unsupported ? (
        <span
          className="shrink-0 text-[11px] text-muted-foreground"
          title={t("plugins.manager.unsupportedHint")}
        >
          {plugin.needsTermix
            ? t("plugins.manager.needsTermix", { range: plugin.needsTermix })
            : t("plugins.manager.unsupported")}
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
