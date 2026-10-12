import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { cliCommands, capabilityIds, entryPoints, apiVersion, findProblems } =
  require("./check-sdk-guide.cjs") as {
    cliCommands: (source: string) => string[];
    capabilityIds: (source: string) => string[];
    entryPoints: (pkg: { exports?: Record<string, unknown> }) => string[];
    apiVersion: (source: string) => string | null;
    findProblems: (input: {
      guide: string;
      commands: string[];
      capabilities: string[];
      entries: string[];
      sdkVersion: string;
      api: string | null;
    }) => string[];
  };

const GUIDE = [
  "# Guide",
  "",
  "SDK 1.2.3 | Plugin API 1.4.0",
  "",
  "| `build` | builds |",
  "| `sign <file>` | signs |",
  "| `db:own` | tables |",
  "| `@termix-ssh/plugin-sdk/db` | tables |",
].join("\n");

const input = {
  guide: GUIDE,
  commands: ["build", "sign"],
  capabilities: ["db:own"],
  entries: ["@termix-ssh/plugin-sdk/db"],
  sdkVersion: "1.2.3",
  api: "1.4.0",
};

describe("readers", () => {
  it("reads command names from the COMMANDS map", () => {
    const source = [
      "const COMMANDS = {",
      "  build,",
      "  patch: async () => {},",
      "  test: async (options) => {",
      "    return run(options);",
      "  },",
      "  verify,",
      "};",
    ].join("\n");
    expect(cliCommands(source)).toEqual(["build", "patch", "test", "verify"]);
  });

  it("reads capability ids once each", () => {
    const source =
      'entry("db:own", "low"),\nentry("ssh:connect", "high"),\nentry("db:own", "low")';
    expect(capabilityIds(source)).toEqual(["db:own", "ssh:connect"]);
  });

  it("skips the root and internal exports", () => {
    expect(
      entryPoints({
        exports: {
          ".": {},
          "./db": {},
          "./testing/setup": {},
          "./theme.css": "",
        },
      }),
    ).toEqual(["@termix-ssh/plugin-sdk/db"]);
  });

  it("reads the plugin API version", () => {
    expect(apiVersion('export const PLUGIN_API_VERSION = "1.2.0";')).toBe(
      "1.2.0",
    );
  });
});

describe("findProblems", () => {
  it("passes a guide that covers everything", () => {
    expect(findProblems(input)).toEqual([]);
  });

  it("names what is missing", () => {
    expect(
      findProblems({
        ...input,
        commands: ["build", "dev"],
        capabilities: ["db:own", "kv:own"],
        entries: ["@termix-ssh/plugin-sdk/ui"],
      }),
    ).toEqual([
      'CLI command "dev" is not covered',
      'capability "kv:own" is not covered',
      'entry point "@termix-ssh/plugin-sdk/ui" is not covered',
    ]);
  });

  it("fails when the header is behind the SDK", () => {
    expect(
      findProblems({ ...input, sdkVersion: "1.2.4", api: "1.5.0" }),
    ).toEqual([
      "header says SDK 1.2.3, package is 1.2.4",
      "header says Plugin API 1.4.0, SDK has 1.5.0",
    ]);
    expect(findProblems({ ...input, guide: "no header" })).toContain(
      'missing the "SDK x.y.z | Plugin API x.y.z" header line',
    );
  });
});
