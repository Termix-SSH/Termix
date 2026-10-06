import { describe, expect, it } from "vitest";
import type { PluginSummary, RegistryPluginEntry } from "@/api/plugins-api";
import {
  categoriesOf,
  describeContributions,
  formatBytes,
  formatCount,
  matchesQuery,
  mergePlugins,
  orderByRisk,
  pluginSource,
  pluginStatus,
  reportIssueUrl,
  sortPlugins,
  uploadEntry,
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
  it("prefills id, version, source and state on the plugin repo", () => {
    const url = reportIssueUrl(
      {
        id: "docker",
        repository: "https://github.com/Termix-SSH/Plugin-Docker.git",
        version: "1.0.0",
        latestVersion: "1.1.0",
        status: "failed",
        source: "official",
      },
      "26.10.0",
    )!;
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://github.com/Termix-SSH/Plugin-Docker/issues/new",
    );
    expect(parsed.searchParams.get("title")).toBe("[docker] ");
    const body = parsed.searchParams.get("body")!;
    expect(body).toContain("**Plugin:** docker");
    expect(body).toContain("**Version:** 1.0.0");
    expect(body).toContain("**Source:** official");
    expect(body).toContain("**State:** failed");
    expect(body).toContain("**Termix:** 26.10.0");
  });

  it("gives nothing for a repo that is not on GitHub", () => {
    expect(
      reportIssueUrl({
        id: "x",
        repository: "https://gitlab.com/a/b",
        version: null,
        latestVersion: null,
        status: null,
        source: "official",
      }),
    ).toBeNull();
  });
});
