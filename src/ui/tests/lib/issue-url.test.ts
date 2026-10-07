import { describe, expect, it } from "vitest";
import {
  buildIssueUrl,
  describeEnvironment,
  normalizeGitHubRepo,
  reportCoreIssueUrl,
} from "@/lib/issue-url";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";

describe("normalizeGitHubRepo", () => {
  it("strips .git and trailing slashes", () => {
    expect(normalizeGitHubRepo(" https://github.com/a/b.git ")).toBe(
      "https://github.com/a/b",
    );
    expect(normalizeGitHubRepo("https://github.com/a/b/")).toBe(
      "https://github.com/a/b",
    );
  });

  it("rejects anything that is not a GitHub repo", () => {
    expect(normalizeGitHubRepo("https://gitlab.com/a/b")).toBeNull();
    expect(normalizeGitHubRepo("https://github.com/a")).toBeNull();
    expect(normalizeGitHubRepo(undefined)).toBeNull();
  });
});

describe("buildIssueUrl", () => {
  it("sets the template and skips empty fields", () => {
    const url = new URL(
      buildIssueUrl("https://github.com/a/b", {
        template: "bug_report.yml",
        fields: { "termix-version": "26.10.0", logs: "", other: undefined },
      }),
    );
    expect(url.pathname).toBe("/a/b/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("termix-version")).toBe("26.10.0");
    expect(url.searchParams.has("logs")).toBe(false);
    expect(url.searchParams.has("other")).toBe(false);
  });

  it("encodes values safely", () => {
    const url = new URL(
      buildIssueUrl("https://github.com/a/b", {
        template: "bug_report.yml",
        fields: { environment: "a & b\nc=d" },
      }),
    );
    expect(url.searchParams.get("environment")).toBe("a & b\nc=d");
  });

  it("cuts long logs to keep the URL short", () => {
    const url = buildIssueUrl("https://github.com/a/b", {
      template: "bug_report.yml",
      fields: { logs: "x".repeat(20000) },
    });
    expect(url.length).toBeLessThanOrEqual(7500);
    expect(new URL(url).searchParams.get("logs")).toMatch(/\(cut\)$/);
  });
});

describe("describeEnvironment", () => {
  it("names the browser and OS on the web", () => {
    expect(describeEnvironment(CHROME_WIN, false)).toBe(
      "Web, Chrome 141 on Windows",
    );
    expect(describeEnvironment(SAFARI_MAC, false)).toBe(
      "Web, Safari 18 on macOS",
    );
    expect(describeEnvironment(FIREFOX_LINUX, false)).toBe(
      "Web, Firefox 130 on Linux",
    );
  });

  it("names the desktop app", () => {
    expect(describeEnvironment(CHROME_WIN, true)).toBe(
      "Desktop app on Windows",
    );
  });
});

describe("reportCoreIssueUrl", () => {
  it("points at the core repo with the version filled in", () => {
    const url = new URL(reportCoreIssueUrl("26.10.0", "beta_feedback.yml"));
    expect(url.pathname).toBe("/Termix-SSH/Termix/issues/new");
    expect(url.searchParams.get("template")).toBe("beta_feedback.yml");
    expect(url.searchParams.get("termix-version")).toBe("26.10.0");
    expect(url.searchParams.get("environment")).toBeTruthy();
  });
});
