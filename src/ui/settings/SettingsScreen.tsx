/**
 * Everything that configures the app rather than operating a server.
 *
 * Profile and admin were two separate rail panels, each a fixed accordion of
 * hardcoded sections. That is the wrong shape for the number of sections they
 * hold, and it left no place at all for a plugin to contribute one. This is a
 * single screen with a banded left nav, and a plugin's page is an entry in it
 * that appears and disappears with the plugin.
 *
 * Both rail buttons still open this, each on its own section, so the Navigation
 * visibility toggles and the habit of reaching for either one keep working.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Puzzle,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
import { Separator } from "@/components/separator";
import { PluginIcon } from "@/lib/plugin-icon";
import { getPlugins, type PluginSummary } from "@/api/plugins-api";
import { PluginSettingsPage } from "./PluginSettingsPage";
import { registerLegacySettingsComponents } from "./legacy-settings-components";

const UserProfilePanel = lazy(() =>
  import("@/sidebar/UserProfilePanel").then((m) => ({
    default: m.UserProfilePanel,
  })),
);
const AdminSettingsPanel = lazy(() =>
  import("@/sidebar/AdminSettingsPanel").then((m) => ({
    default: m.AdminSettingsPanel,
  })),
);

// Taken from the panels themselves: this screen only forwards them, so
// restating their shapes here would be one more thing to keep in step.
type ProfileProps = ComponentProps<typeof UserProfilePanel>;
type AdminProps = ComponentProps<typeof AdminSettingsPanel>;

/** Built-in sections, plus "plugin:<id>" for a plugin's own settings page. */
export type SettingsSectionId = "profile" | "admin" | `plugin:${string}`;

export interface SettingsScreenProps {
  /** Which page to land on. Both rail entries come in here. */
  initialSection?: SettingsSectionId;
  isAdmin?: boolean;
  /** Forwarded to the profile panel. */
  username?: ProfileProps["username"];
  onLogout?: ProfileProps["onLogout"];
  userPrefs?: ProfileProps["userPrefs"];
  onPrefsChange?: ProfileProps["onPrefsChange"];
  remoteSyncInitialServerUrl?: ProfileProps["remoteSyncInitialServerUrl"];
  remoteSyncReconnectRequested?: ProfileProps["remoteSyncReconnectRequested"];
  onRemoteSyncReconnectHandled?: ProfileProps["onRemoteSyncReconnectHandled"];
  /** Forwarded to the admin panel. */
  onEditingChange?: AdminProps["onEditingChange"];
  onOpenHostTab?: AdminProps["onOpenHostTab"];
}

interface NavItem {
  id: SettingsSectionId;
  label: string;
  icon: React.ElementType;
  iconName?: string;
}

export function SettingsScreen({
  initialSection = "profile",
  isAdmin = false,
  username,
  onLogout,
  userPrefs,
  onPrefsChange,
  remoteSyncInitialServerUrl,
  remoteSyncReconnectRequested,
  onRemoteSyncReconnectHandled,
  onEditingChange,
  onOpenHostTab,
}: SettingsScreenProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const [navOpen, setNavOpen] = useState(false);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);

  // Registered here rather than at module scope so a custom field's component
  // exists before any page that renders one. A7 moves this into the loader.
  useEffect(() => {
    registerLegacySettingsComponents();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPlugins()
      .then((loaded) => {
        if (!cancelled) setPlugins(loaded);
      })
      .catch(() => {
        // The plugin band is additive: the core sections still work without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The rail can switch which entry opened the screen while it is mounted.
  useEffect(() => setSection(initialSection), [initialSection]);

  /**
   * A plugin gets a page when it is enabled and declares settings this user
   * could actually change. A non-admin seeing a page of admin-only fields
   * would be a page they can read and never act on.
   */
  const pluginPages = useMemo(
    () =>
      plugins.filter((plugin) => {
        if (!plugin.enabled) return false;
        const settings = plugin.contributes?.settings;
        if (!settings) return false;
        if ((settings.user?.length ?? 0) > 0) return true;
        return isAdmin && (settings.admin?.length ?? 0) > 0;
      }),
    [plugins, isAdmin],
  );

  const bands = useMemo(() => {
    const result: { heading: string; items: NavItem[] }[] = [
      {
        heading: t("settings.bandYou"),
        items: [{ id: "profile", label: t("settings.account"), icon: User }],
      },
    ];

    if (pluginPages.length > 0) {
      result.push({
        heading: t("settings.bandPlugins"),
        items: pluginPages.map((plugin) => ({
          id: `plugin:${plugin.id}` as SettingsSectionId,
          label: plugin.name,
          icon: Puzzle,
          iconName: plugin.icon,
        })),
      });
    }

    if (isAdmin) {
      result.push({
        heading: t("settings.bandInstance"),
        items: [{ id: "admin", label: t("nav.admin"), icon: SettingsIcon }],
      });
    }

    return result;
  }, [t, pluginPages, isAdmin]);

  const sections = bands.flatMap((band) => band.items);
  const active = sections.find((item) => item.id === section) ?? sections[0];

  // A plugin page can vanish under you: the plugin is disabled from the admin
  // section in the same screen. Fall back rather than render an empty pane.
  useEffect(() => {
    if (
      section.startsWith("plugin:") &&
      !sections.some((s) => s.id === section)
    ) {
      setSection("profile");
    }
  }, [section, sections]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-12.5 shrink-0 flex-row items-center border-b border-border">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
          <SettingsIcon className="size-4 shrink-0 text-accent-brand" />
          <span className="truncate text-base font-bold tracking-tight">
            {t("settings.title")}
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="hidden truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground md:inline">
            {active?.label}
          </span>
          {/* The nav column does not fit beside the content on a phone, so
              there it collapses behind the section name. */}
          <button
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            className="flex min-w-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground md:hidden"
          >
            <span className="truncate">{active?.label}</span>
            <ChevronDown
              className={`size-3 shrink-0 transition-transform ${navOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          className={`${navOpen ? "flex" : "hidden"} w-full shrink-0 flex-col gap-3 overflow-y-auto border-r border-border py-2.5 md:flex md:w-60`}
        >
          {bands.map((band) => (
            <div key={band.heading} className="flex flex-col">
              <span className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {band.heading}
              </span>
              {band.items.map((item) => {
                const Icon = item.icon;
                const on = item.id === section;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSection(item.id);
                      setNavOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 border-l-2 py-2.5 pl-2 pr-2 text-left transition-colors md:py-1.5 ${
                      on
                        ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
                        : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {item.iconName ? (
                      <PluginIcon
                        name={item.iconName}
                        className="size-3.5 shrink-0"
                      />
                    ) : (
                      <Icon className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate text-xs font-medium">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div
          className={`${navOpen ? "hidden" : ""} min-h-0 flex-1 overflow-y-auto md:block`}
        >
          <Suspense fallback={null}>
            {section === "profile" && (
              <UserProfilePanel
                username={username}
                onLogout={onLogout}
                userPrefs={userPrefs}
                onPrefsChange={onPrefsChange}
                remoteSyncInitialServerUrl={remoteSyncInitialServerUrl}
                remoteSyncReconnectRequested={remoteSyncReconnectRequested}
                onRemoteSyncReconnectHandled={onRemoteSyncReconnectHandled}
              />
            )}

            {section === "admin" && isAdmin && (
              <AdminSettingsPanel
                onEditingChange={onEditingChange}
                onOpenHostTab={onOpenHostTab}
              />
            )}

            {section.startsWith("plugin:") &&
              (() => {
                const plugin = pluginPages.find(
                  (candidate) => `plugin:${candidate.id}` === section,
                );
                if (!plugin) return null;
                return <PluginSettingsPage plugin={plugin} isAdmin={isAdmin} />;
              })()}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
