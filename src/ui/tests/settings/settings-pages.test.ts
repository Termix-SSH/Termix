import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import {
  CORE_SETTINGS_PAGES,
  searchSettingsPages,
  visibleSettingsPages,
} from "@/settings/settings-pages";
import { SETTINGS_SEARCH_INDEX } from "@/settings/settings-search-index";

function translate(key: string): string {
  let node: unknown = en;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === "string" ? node : key;
}

describe("settings pages", () => {
  it("hides admin pages from users and browser-only pages on desktop", () => {
    const user = visibleSettingsPages(CORE_SETTINGS_PAGES, {
      isAdmin: false,
      isElectron: true,
    }).map((page) => page.id);
    expect(user).not.toContain("admin-users");
    expect(user).not.toContain("security");
    expect(user).toContain("account");

    const admin = visibleSettingsPages(CORE_SETTINGS_PAGES, {
      isAdmin: true,
      isElectron: false,
    }).map((page) => page.id);
    expect(admin).toContain("admin-users");
    expect(admin).toContain("security");
  });

  it("finds a page by a label shown on it, not only its name", () => {
    const hits = searchSettingsPages(CORE_SETTINGS_PAGES, "theme", translate);
    expect(hits.some((hit) => hit.page.id === "appearance")).toBe(true);
    expect(
      hits.find((hit) => hit.page.id === "appearance")?.match,
    ).toBeTruthy();
  });

  it("lists every page for an empty query", () => {
    expect(
      searchSettingsPages(CORE_SETTINGS_PAGES, " ", translate),
    ).toHaveLength(CORE_SETTINGS_PAGES.length);
  });

  it("gives every core page labels to search, all of them real keys", () => {
    for (const page of CORE_SETTINGS_PAGES) {
      expect(translate(page.labelKey)).not.toBe(page.labelKey);
      expect(page.searchKeys.length).toBeGreaterThan(0);
    }
    const missing = Object.values(SETTINGS_SEARCH_INDEX)
      .flat()
      .filter((key) => translate(key) === key);
    expect(missing).toEqual([]);
  });
});
