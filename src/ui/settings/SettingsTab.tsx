import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bug,
  ChevronDown,
  ExternalLink,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  GroupHeading,
  PANEL,
  PanelSearch,
  PanelShell,
} from "@/components/panel-layout";
import { SurfaceScope } from "@/components/surface/surface-scope";
import { EmptyState } from "@/components/empty-state";
import { isElectron } from "@/lib/electron";
import { reportCoreIssueUrl } from "@/lib/issue-url";
import { cn } from "@/lib/utils";
import { pluginKey } from "@/lib/plugin-i18n";
import { PluginIcon } from "@/lib/plugin-icon";
import type { Host } from "@/types/ui-types";
import type { UserPreferences } from "@/main-axios";
import { UserProfilePanel } from "@/sidebar/UserProfilePanel";
import { AdminSettingsPanel } from "@/sidebar/AdminSettingsPanel";
import {
  FeatureSettingsForm,
  useFeatureSettings,
} from "./FeatureSettingsSections";
import { KeybindingsSettings } from "./KeybindingsSettings";
import { UpdatesSettings } from "./UpdatesSettings";
import { SettingsEmbedContext } from "./settings-embed";
import { useSettingsPageFilter } from "./page-filter";
import {
  CORE_SETTINGS_PAGES,
  SETTINGS_BAND_ORDER,
  searchSettingsPages,
  visibleSettingsPages,
  type SettingsBand,
  type SettingsPage,
} from "./settings-pages";
import { usePluginDocsUrl } from "@/components/docs-link";
import { docsUrl } from "@/lib/docs";

export interface SettingsTabProps {
  /** The page to open, from the tab's data. */
  section?: string;
  /** Changes on every open request, so asking for the same page again still goes there. */
  sectionAt?: string | number;
  /** An element id on that page to scroll to, as "id@nonce". */
  reveal?: string;
  username: string;
  isAdmin: boolean;
  onLogout?: () => void;
  userPrefs?: UserPreferences;
  onPrefsChange?: (prefs: Partial<UserPreferences>) => void;
  onOpenHostTab?: (host: Host) => void;
}

const BAND_LABEL: Record<SettingsBand, string> = {
  you: "settings.bandYou",
  app: "settings.bandApp",
  plugins: "settings.bandPlugins",
  instance: "settings.bandInstance",
};

/** Scrolls to the first text on the page containing the query and marks it. */
function revealText(container: HTMLElement, needle: string): boolean {
  const lower = needle.toLowerCase();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.textContent?.toLowerCase().includes(lower)) {
      const el = node.parentElement;
      if (el && el.offsetParent !== null) {
        el.scrollIntoView?.({ block: "center", behavior: "smooth" });
        el.classList.add("settings-search-hit");
        window.setTimeout(
          () => el.classList.remove("settings-search-hit"),
          1600,
        );
        return true;
      }
    }
    node = walker.nextNode();
  }
  return false;
}

/** Everything that configures the app, one page at a time. */
export function SettingsTab({
  section,
  sectionAt,
  reveal,
  username,
  isAdmin,
  onLogout,
  userPrefs,
  onPrefsChange,
  onOpenHostTab,
}: SettingsTabProps) {
  const { t } = useTranslation();
  const userFeatures = useFeatureSettings("user");
  const adminFeatures = useFeatureSettings("admin");
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [pageQuery, setPageQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const pages = useMemo(() => {
    const plugins = new Map<string, SettingsPage>();
    for (const plugin of [...userFeatures, ...(isAdmin ? adminFeatures : [])]) {
      if (plugins.has(plugin.id)) continue;
      const fields = [
        ...(plugin.contributes?.settings?.user ?? []),
        ...(isAdmin ? (plugin.contributes?.settings?.admin ?? []) : []),
      ];
      plugins.set(plugin.id, {
        id: `plugin:${plugin.id}`,
        band: "plugins",
        labelKey: pluginKey(plugin.id, "plugin.name"),
        label: t(pluginKey(plugin.id, "plugin.name"), {
          defaultValue: plugin.name,
        }),
        icon: SettingsIcon,
        pluginId: plugin.id,
        searchKeys: fields.flatMap((field) =>
          [field.labelKey, field.descriptionKey]
            .filter((key): key is string => !!key)
            .map((key) => pluginKey(plugin.id, key)),
        ),
      });
    }
    return visibleSettingsPages(
      [
        ...CORE_SETTINGS_PAGES,
        ...[...plugins.values()].sort((a, b) =>
          (a.label ?? "").localeCompare(b.label ?? ""),
        ),
      ],
      { isAdmin, isElectron: isElectron() },
    );
  }, [userFeatures, adminFeatures, isAdmin, t]);

  const [current, setCurrent] = useState(section ?? "account");
  useEffect(() => {
    if (section) setCurrent(section);
  }, [section, sectionAt]);

  // The page renders lazily, so the target may take a moment to appear.
  useEffect(() => {
    const target = reveal?.split("@")[0];
    if (!target) return;
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      const el = contentRef.current?.querySelector<HTMLElement>(
        `#${CSS.escape(target)}`,
      );
      if (el) {
        el.scrollIntoView?.({ block: "start", behavior: "smooth" });
        el.classList.add("settings-search-hit");
        timer = window.setTimeout(
          () => el.classList.remove("settings-search-hit"),
          1600,
        );
        return;
      }
      if (++tries < 15) timer = window.setTimeout(attempt, 120);
    };
    timer = window.setTimeout(attempt, 60);
    return () => window.clearTimeout(timer);
  }, [reveal]);

  const page =
    pages.find((p) => p.id === current) ??
    pages.find((p) => p.id === "account")!;
  const pageHasMatches = useSettingsPageFilter(pageRef, pageQuery, page.id);
  const hits = searchSettingsPages(pages, query, (key) => t(key));
  const pageLabel = (p: SettingsPage) => p.label ?? t(p.labelKey);

  const go = (id: string) => {
    setCurrent(id);
    setNavOpen(false);
    setPageQuery("");
    contentRef.current?.scrollTo?.({ top: 0 });
    const needle = query.trim();
    if (!needle) return;
    let tries = 0;
    const attempt = () => {
      if (!contentRef.current) return;
      if (revealText(contentRef.current, needle) || ++tries > 12) return;
      window.setTimeout(attempt, 150);
    };
    window.setTimeout(attempt, 60);
  };

  const pluginDocs = usePluginDocsUrl(page.pluginId);
  const pageDocs = page.pluginId
    ? pluginDocs
    : page.docs
      ? docsUrl(page.docs)
      : null;

  const pluginFeature = page.pluginId
    ? {
        user: userFeatures.find((p) => p.id === page.pluginId),
        admin: isAdmin
          ? adminFeatures.find((p) => p.id === page.pluginId)
          : undefined,
      }
    : null;

  const nav = (
    <div className="flex flex-col gap-3 py-2.5">
      <div className="px-2.5">
        <PanelSearch
          value={query}
          onChange={setQuery}
          placeholder={t("settings.searchPlaceholder")}
          fill
        />
      </div>
      {query.trim() && hits.length === 0 && (
        <p className="px-3 text-xs text-muted-foreground">
          {t("settings.noResults")}
        </p>
      )}
      {SETTINGS_BAND_ORDER.map((band) => {
        const items = hits.filter((hit) => hit.page.band === band);
        const reportBug =
          band === "you" &&
          (!query.trim() ||
            t("dashboard.reportBug")
              .toLowerCase()
              .includes(query.trim().toLowerCase()));
        if (items.length === 0 && !reportBug) return null;
        return (
          <div key={band} className="flex flex-col">
            <GroupHeading
              title={t(BAND_LABEL[band])}
              className="px-2.5 pb-1.5"
            />
            {items.map(({ page: item, match }) => {
              const on = item.id === page.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex w-full flex-col border-l-2 py-1.5 pl-2 pr-2 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring",
                    on
                      ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
                      : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {item.pluginId ? (
                      <PluginIcon
                        name={
                          [...userFeatures, ...adminFeatures].find(
                            (p) => p.id === item.pluginId,
                          )?.icon
                        }
                        className="size-3.5 shrink-0"
                      />
                    ) : (
                      <Icon className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate text-xs font-medium">
                      {pageLabel(item)}
                    </span>
                  </span>
                  {match && (
                    <span className="truncate pl-5.5 text-[10px] text-muted-foreground">
                      {match}
                    </span>
                  )}
                </button>
              );
            })}
            {reportBug && (
              <a
                href={reportCoreIssueUrl(
                  import.meta.env.VITE_APP_VERSION || undefined,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-2 border-l-2 border-transparent py-1.5 pl-2 pr-2 text-left text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Bug className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-medium">
                  {t("dashboard.reportBug")}
                </span>
                <ExternalLink className="ml-auto size-3 shrink-0" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );

  const showProfile = !!page.profileSection && page.id !== "keybindings";
  const showAdmin = !!page.adminSection;

  return (
    <PanelShell
      icon={<SettingsIcon className="size-4" />}
      title={t("nav.settings")}
      status={pageLabel(page)}
      scroll={false}
      docs={pageDocs}
      actions={
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground md:hidden"
        >
          {t("settings.pages")}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              navOpen && "rotate-180",
            )}
          />
        </button>
      }
    >
      <div className="relative flex min-h-0 flex-1">
        <nav
          aria-label={t("settings.pages")}
          className={cn(
            "w-full shrink-0 overflow-y-auto border-r border-border bg-background thin-scrollbar md:static md:block md:w-60",
            navOpen ? "absolute inset-0 z-20 block" : "hidden",
          )}
        >
          {nav}
        </nav>

        <SurfaceScope kind="tab" className="min-w-0">
          <div className={`shrink-0 border-b border-border ${PANEL.band}`}>
            <div className="mx-auto w-full max-w-3xl">
              <PanelSearch
                value={pageQuery}
                onChange={setPageQuery}
                placeholder={t("settings.searchPage")}
                fill
              />
            </div>
          </div>
          <div
            ref={contentRef}
            className={`min-h-0 flex-1 overflow-y-auto thin-scrollbar ${PANEL.body}`}
          >
            {!pageHasMatches && (
              <EmptyState icon={Search} title={t("settings.noPageMatches")} />
            )}
            <div
              ref={pageRef}
              className={`mx-auto flex w-full max-w-3xl flex-col ${PANEL.gap} pb-6`}
            >
              <SettingsEmbedContext.Provider value>
                <div className={showProfile ? "contents" : "hidden"}>
                  <UserProfilePanel
                    section={page.profileSection ?? "__none__"}
                    username={username}
                    onLogout={onLogout}
                    userPrefs={userPrefs}
                    onPrefsChange={onPrefsChange}
                    onOpenSettingsPage={go}
                  />
                </div>
                {isAdmin && (
                  <div className={showAdmin ? "contents" : "hidden"}>
                    <AdminSettingsPanel
                      section={page.adminSection ?? ("__none__" as never)}
                      onOpenHostTab={onOpenHostTab}
                    />
                  </div>
                )}
              </SettingsEmbedContext.Provider>
              {page.id === "keybindings" && <KeybindingsSettings />}
              {page.id === "updates" && isAdmin && <UpdatesSettings />}
              {pluginFeature && (
                <>
                  {pluginFeature.user && (
                    <FeatureSettingsForm
                      plugin={pluginFeature.user}
                      scope="user"
                      fields={
                        pluginFeature.user.contributes?.settings?.user ?? []
                      }
                    />
                  )}
                  {pluginFeature.admin && (
                    <>
                      <GroupHeading
                        title={t("settings.instanceSettings")}
                        className="pt-2"
                      />
                      <FeatureSettingsForm
                        plugin={pluginFeature.admin}
                        scope="admin"
                        fields={
                          pluginFeature.admin.contributes?.settings?.admin ?? []
                        }
                      />
                    </>
                  )}
                  {!pluginFeature.user && !pluginFeature.admin && (
                    <EmptyState
                      icon={SettingsIcon}
                      title={t("settings.nothingHere")}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </SurfaceScope>
      </div>
    </PanelShell>
  );
}
