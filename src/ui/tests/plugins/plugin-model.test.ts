import { describe, expect, it } from "vitest";
import type { PluginSummary, RegistryPluginEntry } from "@/api/plugins-api";
import {
  betaFeedbackUrl,
  betaToTry,
  isPrerelease,
  categoriesOf,
  describeContributions,
  formatBytes,
  formatCount,
  groupChanges,
  matchesQuery,
  mergeReleaseNotes,
  mergePlugins,
  orderByRisk,
  pluginSource,
  pluginStatus,
  reportIssueUrl,
  requestFeatureUrl,
  sortPlugins,
  uploadEntry,
  youtubeEmbedUrl,
} from "@/plugins/plugin-model";

function summary(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "docker",
    name: "Docker",
    version: "1.0.0",
    enabled: true,
    state: "active",
    contributes: null,
    capabilities: ["kv:own"],
    ...overrides,
  };
}

function entry(
  overrides: Partial<RegistryPluginEntry> = {},
): RegistryPluginEntry {
  return {
    id: "docker",
    name: "Docker",
    description: "Containers",
    author: "Termix",
    category: "Infrastructure",
    versions: [
      {
        version: "1.1.0",
        compatible: true,
        capabilities: ["kv:own", "ssh:connect"],
        publishedAt: "2026-10-02",
        size: 1,
      },
    ],
    latestVersion: "1.1.0",
    installed: true,
    installedVersion: "1.0.0",
    updateAvailable: true,
    addedCapabilities: ["ssh:connect"],
    pinnedVersion: null,
    autoUpdate: false,
    bundled: true,
    installCount: null,
    installCountSource: null,
    ...overrides,
  };
}

describe("mergePlugins", () => {
  it("joins an installed plugin with its registry entry", () => {
    const [row] = mergePlugins([summary()], [entry()]);
    expect(row).toMatchObject({
      installed: true,
      version: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
      addedCapabilities: ["ssh:connect"],
      capabilities: ["kv:own"],
      category: "Infrastructure",
      inRegistry: true,
      status: "running",
    });
  });

  it("lists registry plugins that are not installed with the latest capabilities", () => {
    const rows = mergePlugins(
      [],
      [entry({ installed: false, installedVersion: null })],
    );
    expect(rows[0]).toMatchObject({
      installed: false,
      version: null,
      status: null,
      capabilities: ["kv:own", "ssh:connect"],
    });
  });

  it("uses the installed features and falls back to the registry", () => {
    const registry = entry({ features: ["From registry"] });
    expect(
      mergePlugins([summary({ features: ["Installed"] })], [registry])[0]
        .features,
    ).toEqual(["Installed"]);
    expect(mergePlugins([summary()], [registry])[0].features).toEqual([
      "From registry",
    ]);
    expect(mergePlugins([summary()], null)[0].features).toEqual([]);
  });

  it("keeps installed plugins when the registry is unreachable", () => {
    const rows = mergePlugins([summary()], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].inRegistry).toBe(false);
  });
});

describe("pluginStatus", () => {
  it("maps loader and stored states", () => {
    expect(pluginStatus(summary({ state: "failed" }))).toBe("failed");
    expect(pluginStatus(summary({ state: "blocked" }))).toBe("blocked");
    expect(pluginStatus(summary({ enabled: false, state: "disabled" }))).toBe(
      "disabled",
    );
    expect(pluginStatus(summary())).toBe("running");
  });
});

describe("sorting and filtering", () => {
  const rows = mergePlugins(
    [],
    [
      entry({ id: "b", name: "Beta", category: "Monitoring" }),
      entry({
        id: "a",
        name: "Alpha",
        category: "Access",
        description: "Sign in",
        features: ["Works with Podman"],
        versions: [
          {
            version: "1.0.0",
            compatible: true,
            capabilities: [],
            publishedAt: "2026-10-05",
            size: 1,
          },
        ],
      }),
    ],
  );

  it("sorts by name, date and category", () => {
    expect(sortPlugins(rows, "name").map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortPlugins(rows, "updated").map((r) => r.id)).toEqual(["a", "b"]);
    expect(sortPlugins(rows, "category").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("searches name, description and id", () => {
    expect(
      rows.filter((r) => matchesQuery(r, "sign")).map((r) => r.id),
    ).toEqual(["a"]);
    expect(
      rows.filter((r) => matchesQuery(r, "podman")).map((r) => r.id),
    ).toEqual(["a"]);
    expect(rows.filter((r) => matchesQuery(r, "  ")).length).toBe(2);
  });

  it("collects categories", () => {
    expect(categoriesOf(rows)).toEqual(["Access", "Monitoring"]);
  });
});

describe("helpers", () => {
  it("orders capabilities worst first", () => {
    expect(orderByRisk(["kv:own", "hosts:write", "credentials:read"])).toEqual([
      "credentials:read",
      "hosts:write",
      "kv:own",
    ]);
  });

  it("counts contributions", () => {
    expect(
      describeContributions({
        tabs: [{}, {}],
        settings: { admin: [] },
        auth: { loginMethods: [{}], secondFactors: [] },
        panels: [],
      }),
    ).toEqual([
      { kind: "tabs", count: 2 },
      { kind: "auth", count: 1 },
      { kind: "settings", count: 1 },
    ]);
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });
});

describe("popularity", () => {
  it("sorts by install count, unknown counts last", () => {
    const rows = mergePlugins(
      [],
      [
        entry({ id: "a", name: "A", installed: false, installCount: 5 }),
        entry({ id: "b", name: "B", installed: false, installCount: null }),
        entry({ id: "c", name: "C", installed: false, installCount: 90 }),
      ],
    );
    expect(sortPlugins(rows, "popular").map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("formats counts roughly", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(1234)).toBe("1.2k");
    expect(formatCount(45_000)).toBe("45k");
    expect(formatCount(2_500_000)).toBe("2.5M");
  });
});

describe("source and trust", () => {
  it("tells bundled, signed and unverified copies apart", () => {
    expect(pluginSource(summary({ source: "bundled", tier: "bundled" }))).toBe(
      "bundled",
    );
    expect(
      pluginSource(
        summary({ source: "user", tier: "official", signedBy: "k" }),
      ),
    ).toBe("official");
    expect(pluginSource(summary({ source: "user", tier: "community" }))).toBe(
      "unverified",
    );
    expect(
      pluginSource(
        summary({ source: "user", tier: "unverified", signedBy: "k" }),
      ),
    ).toBe("unverified");
  });

  it("marks an upload as unverified", () => {
    const row = uploadEntry({
      token: "t",
      id: "notes",
      name: "Notes",
      version: "0.2.0",
      description: "",
      author: "me",
      capabilities: ["kv:own"],
      replaces: "0.1.0",
    });
    expect(row).toMatchObject({
      unverified: true,
      installed: true,
      version: "0.1.0",
      latestVersion: "0.2.0",
    });
  });
});

describe("reportIssueUrl", () => {
  const base = {
    id: "docker",
    repository: "https://github.com/Termix-SSH/Plugin-Docker.git",
    version: "1.0.0",
    latestVersion: "1.1.0",
    status: "failed" as const,
    source: "official" as const,
    lastError: "boom",
  };

  it("fills the bug form on an official plugin repo", () => {
    const parsed = new URL(reportIssueUrl(base, "26.10.0")!);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://github.com/Termix-SSH/Plugin-Docker/issues/new",
    );
    expect(parsed.searchParams.get("template")).toBe("bug_report.yml");
    expect(parsed.searchParams.get("termix-version")).toBe("26.10.0");
    expect(parsed.searchParams.get("plugin-version")).toBe("1.0.0");
    expect(parsed.searchParams.get("environment")).toContain(
      "Plugin docker, official, failed",
    );
    expect(parsed.searchParams.get("logs")).toBe("boom");
    expect(parsed.searchParams.has("body")).toBe(false);
  });

  it("fills the same bug form on an unverified plugin repo", () => {
    const parsed = new URL(
      reportIssueUrl({ ...base, source: "unverified" }, "26.10.0")!,
    );
    expect(parsed.searchParams.get("template")).toBe("bug_report.yml");
    expect(parsed.searchParams.get("plugin-version")).toBe("1.0.0");
    expect(parsed.searchParams.get("environment")).toContain(
      "Plugin docker, unverified, failed",
    );
    expect(parsed.searchParams.has("body")).toBe(false);
  });

  it("gives nothing for a repo that is not on GitHub", () => {
    expect(
      reportIssueUrl({
        ...base,
        repository: "https://gitlab.com/a/b",
      }),
    ).toBeNull();
  });
});

describe("requestFeatureUrl", () => {
  it("opens the feature form on the plugin repo", () => {
    const parsed = new URL(
      requestFeatureUrl({
        repository: "https://github.com/Termix-SSH/Plugin-Docker/",
      })!,
    );
    expect(parsed.origin + parsed.pathname).toBe(
      "https://github.com/Termix-SSH/Plugin-Docker/issues/new",
    );
    expect(parsed.searchParams.get("template")).toBe("feature_request.yml");
  });

  it("gives nothing for a repo that is not on GitHub", () => {
    expect(
      requestFeatureUrl({ repository: "https://gitlab.com/a/b" }),
    ).toBeNull();
  });
});

describe("mergeReleaseNotes", () => {
  const registryVersion = (version: string, extra = {}) => ({
    version,
    compatible: true,
    capabilities: [],
    size: 1,
    publishedAt: "2026-10-01T00:00:00Z",
    ...extra,
  });

  it("joins registry and local notes newest first, local winning", () => {
    const rows = mergeReleaseNotes(
      [
        registryVersion("1.2.0", {
          compatible: false,
          notes: { changes: [{ type: "added", text: "Registry" }] },
        }),
        registryVersion("1.0.0", {
          releaseNotesUrl: "https://github.com/x/y/releases/tag/v1.0.0",
          notes: { changes: [{ type: "added", text: "Old" }] },
        }),
      ],
      [
        {
          version: "1.0.0",
          date: "2026-09-01",
          summary: "First.",
          changes: [{ type: "added", text: "Local" }],
        },
        { version: "0.9.0", changes: [{ type: "fixed", text: "Beta" }] },
      ],
    );
    expect(rows.map((r) => r.version)).toEqual(["1.2.0", "1.0.0", "0.9.0"]);
    expect(rows[0]).toMatchObject({ compatible: false });
    expect(rows[1]).toEqual({
      version: "1.0.0",
      date: "2026-09-01",
      summary: "First.",
      changes: [{ type: "added", text: "Local" }],
      compatible: true,
      releaseNotesUrl: "https://github.com/x/y/releases/tag/v1.0.0",
    });
    expect(rows[2]).toMatchObject({ date: null, compatible: true });
  });

  it("is empty with nothing to show", () => {
    expect(mergeReleaseNotes([], [])).toEqual([]);
  });
});

describe("groupChanges", () => {
  it("groups by type in a fixed order", () => {
    expect(
      groupChanges([
        { type: "fixed", text: "b" },
        { type: "added", text: "a" },
        { type: "fixed", text: "c" },
      ]),
    ).toEqual([
      { type: "added", items: ["a"] },
      { type: "fixed", items: ["b", "c"] },
    ]);
  });
});

describe("youtubeEmbedUrl", () => {
  it("builds a privacy embed from a video id only", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    );
  });

  it("refuses anything that is not an id", () => {
    for (const value of [
      undefined,
      "",
      "https://evil.example/x",
      "dQw4w9WgXcQ/../../x",
      "javascript:alert(1)",
    ]) {
      expect(youtubeEmbedUrl(value)).toBeNull();
    }
  });
});

describe("betas", () => {
  it("knows a prerelease", () => {
    expect(isPrerelease("1.2.0-beta.1")).toBe(true);
    expect(isPrerelease("1.2.0")).toBe(false);
    expect(isPrerelease(null)).toBe(false);
  });

  it("offers a beta only when newer than what is installed on stable", () => {
    const base = {
      installed: true,
      version: "1.1.0",
      latestBeta: "1.2.0-beta.1",
      channel: "stable" as const,
    };
    expect(betaToTry(base)).toBe("1.2.0-beta.1");
    expect(betaToTry({ ...base, channel: "beta" })).toBeNull();
    expect(betaToTry({ ...base, version: "1.2.0-beta.1" })).toBeNull();
    expect(betaToTry({ ...base, installed: false })).toBeNull();
    expect(betaToTry({ ...base, latestBeta: null })).toBeNull();
  });

  it("sends beta feedback to the plugin's repo", () => {
    const url = new URL(
      betaFeedbackUrl(
        {
          id: "docker",
          repository: "https://github.com/Termix-SSH/Plugin-Docker",
          version: "1.2.0-beta.1",
          lastError: null,
        },
        "26.11.0",
      )!,
    );
    expect(url.pathname).toBe("/Termix-SSH/Plugin-Docker/issues/new");
    expect(url.searchParams.get("template")).toBe("beta_feedback.yml");
    expect(url.searchParams.get("plugin-version")).toBe("1.2.0-beta.1");
    expect(
      betaFeedbackUrl({
        id: "x",
        repository: "https://gitlab.com/a/b",
        version: "1.0.0",
        lastError: null,
      }),
    ).toBeNull();
  });
});
