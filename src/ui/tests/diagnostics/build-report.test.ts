import { describe, expect, it } from "vitest";
import {
  buildReport,
  defaultReportOptions,
  issueSummary,
  reportFileName,
  type ReportData,
} from "@/diagnostics/build-report";
import { domOutline } from "@/diagnostics/dom-outline";

function data(patch: Partial<ReportData> = {}): ReportData {
  return {
    madeAt: "2026-11-20T10:00:00.000Z",
    version: "26.11.3",
    environment: "Web, Chrome 141 on Windows",
    context: {
      signedIn: true,
      isAdmin: true,
      username: "alice",
      hosts: [{ name: "prod-db", ip: "10.0.0.9", username: "deploy" }],
    },
    request: null,
    requestError: "HTTP 502",
    server: {
      server: { version: "26.11.3", database: { health: "ok" } },
      plugins: { plugins: [{ id: "ai", loader: "active" }], skipped: [] },
      sections: [{ pluginId: "ai", title: "AI", data: { model: "x" } }],
      logs: {
        boot: [
          {
            seq: 1,
            at: "t",
            level: "info",
            service: "S",
            text: "alice signed in from 10.0.0.9",
          },
        ],
        recent: [
          {
            seq: 2,
            at: "t",
            level: "error",
            service: "S",
            text: "bad thing",
            pluginId: "ai",
          },
          {
            seq: 3,
            at: "t",
            level: "info",
            service: "S",
            text: "docker line",
            pluginId: "docker",
          },
        ],
        latest: 3,
        droppedBefore: null,
      },
      request: {} as never,
    },
    probes: [],
    capture: {
      startedAt: "",
      console: [
        { at: "t", level: "error", source: "page", text: "prod-db failed" },
      ],
      errors: [],
      network: [],
      sockets: [],
      dropped: { console: 0, errors: 0, network: 0, sockets: 0 },
    },
    page: { language: "en" },
    frontends: [],
    dom: "body {0,0 10x10}",
    domWithText: 'body {0,0 10x10} "secret text"',
    ...patch,
  };
}

describe("buildReport", () => {
  it("has every part and masks names by default", () => {
    const report = buildReport(data(), defaultReportOptions());
    const text = report.text;
    for (const heading of [
      "# Termix diagnostics report",
      "## Detected problems",
      "## Server",
      "## Plugins on the server",
      "## Plugin sections",
      "## Request as the server saw it",
      "## Browser errors",
      "## Network",
      "## Page",
      "## Page layout",
      "## Browser console",
      "## Server log since start",
      "## Server log, recent",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).not.toContain("alice");
    expect(text).not.toContain("10.0.0.9");
    expect(text).not.toContain("prod-db");
    expect(text).toMatch(/user-1 signed in from host-\d/);
    expect(text).not.toContain("secret text");
    expect(report.bytes).toBeGreaterThan(0);
  });

  it("shows real names when asked and leaves out parts", () => {
    const options = defaultReportOptions();
    options.mask = false;
    options.parts.logs = false;
    options.parts.dom = false;
    const text = buildReport(data(), options).text;
    expect(text).toContain("prod-db failed");
    expect(text).not.toContain("## Server log");
    expect(text).not.toContain("## Page layout");
  });

  it("filters logs to a focus plugin and to warnings", () => {
    const options = defaultReportOptions("ai");
    options.logsWarnOnly = true;
    const text = buildReport(data(), options).text;
    expect(text).toContain("bad thing");
    expect(text).not.toContain("docker line");
    expect(text).not.toContain("signed in from");
  });

  it("includes the description and a summary for the issue", () => {
    const options = defaultReportOptions();
    options.description = "Plugins page will not open";
    const report = buildReport(data(), options);
    expect(report.text).toContain(
      "## What happened\n\nPlugins page will not open",
    );
    expect(issueSummary(report, data())).toContain("Termix 26.11.3");
  });

  it("cuts long logs to fit", () => {
    const big = data();
    big.server!.logs!.recent = Array.from({ length: 2000 }, (_, i) => ({
      seq: i + 10,
      at: "t",
      level: "info" as const,
      service: "S",
      text: "x".repeat(4000),
    }));
    const report = buildReport(big, defaultReportOptions());
    expect(report.cut).toBe(true);
    expect(report.text.length).toBeLessThan(5.1 * 1024 * 1024);
  });

  it("names the file after the time", () => {
    expect(reportFileName("2026-11-20T10:00:00.000Z")).toBe(
      "termix-report-2026-11-20T10-00-00.md",
    );
  });
});

describe("domOutline", () => {
  it("outlines elements without text or input values", () => {
    document.body.innerHTML = `
      <div id="app" data-slot="shell"><p>hello there</p><input value="pw" />
      <div data-diagnostics-view><span>skip me</span></div></div>`;
    const outline = domOutline(document.body);
    expect(outline).toContain("div#app [data-slot=shell]");
    expect(outline).not.toContain("hello there");
    expect(outline).not.toContain("pw");
    expect(outline).not.toContain("skip me");
    expect(domOutline(document.body, { text: true })).toContain(
      '"hello there"',
    );
  });
});
