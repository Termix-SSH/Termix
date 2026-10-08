import {
  Database,
  FileText,
  FlaskConical,
  Globe,
  KeyRound,
  Keyboard,
  Lock,
  Monitor,
  Palette,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminSection } from "@/types/ui-types";
import type { DocsPage } from "@/lib/docs";
import { SETTINGS_SEARCH_INDEX } from "./settings-search-index";

export type SettingsBand = "you" | "app" | "plugins" | "instance";

export const SETTINGS_BAND_ORDER: SettingsBand[] = [
  "you",
  "app",
  "plugins",
  "instance",
];

export interface SettingsPage {
  id: string;
  band: SettingsBand;
  labelKey: string;
  /** Already translated, for plugin pages named after the plugin. */
  label?: string;
  icon: LucideIcon;
  /** Only for admins. */
  admin?: boolean;
  /** Left out of the desktop app. */
  browserOnly?: boolean;
  /** The profile section this page shows. */
  profileSection?: string;
  /** The admin section this page shows. */
  adminSection?: AdminSection;
  /** A plugin's settings page. */
  pluginId?: string;
  /** The docs page for this settings page. Plugin pages use the plugin's docs. */
  docs?: DocsPage;
  /** i18n keys whose text search matches. */
  searchKeys: string[];
}

function core(
  page: Omit<SettingsPage, "searchKeys"> & { indexId?: string },
): SettingsPage {
  return {
    ...page,
    searchKeys: SETTINGS_SEARCH_INDEX[page.indexId ?? page.id] ?? [],
  };
}

export const CORE_SETTINGS_PAGES: SettingsPage[] = [
  core({
    id: "account",
    docs: "account",
    band: "you",
    labelKey: "settings.account",
    icon: User,
    profileSection: "account",
  }),
  core({
    id: "security",
    docs: "accountSecurity",
    band: "you",
    labelKey: "settings.security",
    icon: Shield,
    profileSection: "security",
    browserOnly: true,
  }),
  core({
    id: "api-keys",
    docs: "apiKeys",
    band: "you",
    labelKey: "settings.apiKeys",
    icon: KeyRound,
    profileSection: "api-keys",
  }),
  core({
    id: "data",
    docs: "accountData",
    band: "you",
    labelKey: "settings.data",
    icon: Database,
    profileSection: "data",
  }),
  core({
    id: "interface",
    docs: "interfaceSettings",
    band: "app",
    labelKey: "settings.interface",
    icon: SlidersHorizontal,
    profileSection: "interface",
  }),
  core({
    id: "appearance",
    docs: "appearance",
    band: "app",
    labelKey: "settings.appearance",
    icon: Palette,
    profileSection: "appearance",
  }),
  core({
    id: "keybindings",
    docs: "keybindings",
    band: "app",
    labelKey: "settings.keybindings",
    icon: Keyboard,
    profileSection: "keybindings",
  }),
  core({
    id: "admin-general",
    docs: "adminGeneral",
    band: "instance",
    labelKey: "settings.adminGeneral",
    icon: Settings,
    admin: true,
    adminSection: "general",
  }),
  core({
    id: "updates",
    docs: "updating",
    band: "instance",
    labelKey: "settings.updates.title",
    icon: FlaskConical,
    admin: true,
  }),
  core({
    id: "admin-users",
    docs: "users",
    band: "instance",
    labelKey: "settings.adminUsers",
    icon: Users,
    admin: true,
    adminSection: "users",
  }),
  core({
    id: "admin-sessions",
    docs: "sessions",
    band: "instance",
    labelKey: "settings.adminSessions",
    icon: Monitor,
    admin: true,
    adminSection: "sessions",
  }),
  core({
    id: "admin-roles",
    docs: "roles",
    band: "instance",
    labelKey: "settings.adminRoles",
    icon: Lock,
    admin: true,
    adminSection: "roles",
  }),
  core({
    id: "admin-host-defaults",
    docs: "hostDefaults",
    band: "instance",
    labelKey: "settings.adminHostDefaults",
    icon: Server,
    admin: true,
    adminSection: "host-defaults",
  }),
  core({
    id: "admin-branding",
    docs: "branding",
    band: "instance",
    labelKey: "settings.adminBranding",
    icon: Palette,
    admin: true,
    adminSection: "branding",
  }),
  core({
    id: "admin-database",
    docs: "adminDatabase",
    band: "instance",
    labelKey: "settings.adminDatabase",
    icon: Database,
    admin: true,
    adminSection: "database",
  }),
  core({
    id: "admin-ssl",
    docs: "adminSsl",
    band: "instance",
    labelKey: "settings.adminSsl",
    icon: Globe,
    admin: true,
    adminSection: "ssl",
  }),
  core({
    id: "admin-api-keys",
    docs: "apiKeys",
    band: "instance",
    labelKey: "settings.adminApiKeys",
    icon: KeyRound,
    admin: true,
    adminSection: "api-keys",
  }),
  core({
    id: "admin-audit-log",
    docs: "auditLog",
    band: "instance",
    labelKey: "settings.adminAuditLog",
    icon: FileText,
    admin: true,
    adminSection: "audit-log",
  }),
];

/** The pages this user can reach, in nav order. */
export function visibleSettingsPages(
  pages: SettingsPage[],
  { isAdmin, isElectron }: { isAdmin: boolean; isElectron: boolean },
): SettingsPage[] {
  return pages.filter(
    (page) => (!page.admin || isAdmin) && (!page.browserOnly || !isElectron),
  );
}

export interface SettingsSearchHit {
  page: SettingsPage;
  /** The first matching phrase, to show under the page name. */
  match: string;
}

/** Pages whose name or any label on them contains the query. */
export function searchSettingsPages(
  pages: SettingsPage[],
  query: string,
  translate: (key: string) => string,
): SettingsSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return pages.map((page) => ({ page, match: "" }));
  const hits: SettingsSearchHit[] = [];
  for (const page of pages) {
    const label = page.label ?? translate(page.labelKey);
    if (label.toLowerCase().includes(needle)) {
      hits.push({ page, match: "" });
      continue;
    }
    const phrase = page.searchKeys
      .map((key) => translate(key))
      .find((text) => text.toLowerCase().includes(needle));
    if (phrase) hits.push({ page, match: phrase });
  }
  return hits;
}
