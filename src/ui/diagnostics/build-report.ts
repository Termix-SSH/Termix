/**
 * Collects every part of a diagnostics report and writes it as one Markdown
 * file. Collecting and writing are separate, so changing masking or a part
 * does not ask the server again.
 */
import { APP_VERSION } from "@/lib/app-version";
import { describeEnvironment } from "@/lib/issue-url";
import {
  getRequestInfo,
  getServerPart,
  type RequestInfoResponse,
  type ServerLogLine,
  type ServerPart,
} from "./diagnostics-api";
import { domOutline } from "./dom-outline";
import { Masker, noMask, type ReportMasker } from "./mask";
import { describeFrontends, describePage } from "./page-info";
import { runProbes, type ProbeResult } from "./probes";
import { findProblems, type Finding } from "./rules";
import { captureSnapshot, type CaptureSnapshot } from "./store";

export const REPORT_PARTS = [
  "server",
  "plugins",
  "sections",
  "logs",
  "request",
  "probes",
  "errors",
  "console",
  "network",
  "page",
  "dom",
] as const;

export type ReportPart = (typeof REPORT_PARTS)[number];

/** Parts only an admin can get. */
export const ADMIN_PARTS: ReadonlySet<ReportPart> = new Set([
  "server",
  "sections",
  "logs",
]);

export interface ReportOptions {
  parts: Record<ReportPart, boolean>;
  mask: boolean;
  domText: boolean;
  /** Only warnings and errors from the server log. */
  logsWarnOnly: boolean;
  focusPluginId?: string;
  description?: string;
}

export function defaultReportOptions(focusPluginId?: string): ReportOptions {
  return {
    parts: Object.fromEntries(REPORT_PARTS.map((p) => [p, true])) as Record<
      ReportPart,
      boolean
    >,
    mask: true,
    domText: false,
    logsWarnOnly: false,
    focusPluginId,
    description: "",
  };
}

export interface ReportContext {
  isAdmin: boolean;
  signedIn: boolean;
  username?: string | null;
  hosts?: Array<{ name?: string; ip?: string; username?: string }>;
}

export interface ReportData {
  madeAt: string;
  version: string | null;
  environment: string;
  context: ReportContext;
  request: RequestInfoResponse | null;
  requestError?: string;
  server: ServerPart | null;
  serverError?: string;
  probes: ProbeResult[];
  capture: CaptureSnapshot;
  page: Record<string, unknown>;
  frontends: Array<Record<string, unknown>>;
  dom: string;
  domWithText: string;
}

function message(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status) return `HTTP ${status}`;
  return error instanceof Error ? error.message : String(error);
}

export async function collectReport(
  context: ReportContext,
  focusPluginId?: string,
): Promise<ReportData> {
  const [request, server, probes, page] = await Promise.all([
    getRequestInfo().then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: null, error: message(error) }),
    ),
    context.isAdmin
      ? getServerPart({ logs: true, sections: true }).then(
          (value) => ({ value, error: undefined }),
          (error: unknown) => ({ value: null, error: message(error) }),
        )
      : Promise.resolve({ value: null, error: undefined }),
    runProbes(focusPluginId).catch(() => [] as ProbeResult[]),
    describePage(),
  ]);
  return {
    madeAt: new Date().toISOString(),
    version: request.value?.version ?? APP_VERSION ?? null,
    environment: describeEnvironment(),
    context,
    request: request.value,
    requestError: request.error,
    server: server.value,
    serverError: server.error,
    probes,
    capture: captureSnapshot(),
    page,
    frontends: describeFrontends(),
    dom: domOutline(document.body),
    domWithText: domOutline(document.body, { text: true }),
  };
}

export function reportMasker(data: ReportData, mask: boolean): ReportMasker {
  if (!mask) return noMask;
  const hosts = data.context.hosts ?? [];
  return new Masker({
    serverHost: typeof location === "undefined" ? null : location.hostname,
    hosts: hosts.flatMap((h) => [h.ip ?? "", h.name ?? ""]),
    users: [data.context.username ?? "", ...hosts.map((h) => h.username ?? "")],
  });
}

const MAX_BYTES = 5 * 1024 * 1024;

function json(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

function block(text: string, lang = "text"): string {
  return "```" + lang + "\n" + text.replace(/```/g, "'''") + "\n```";
}

function logLines(lines: ServerLogLine[]): string {
  return lines
    .map(
      (line) => `${line.at} ${line.level.toUpperCase().padEnd(7)} ${line.text}`,
    )
    .join("\n");
}

function keepLog(line: ServerLogLine, options: ReportOptions): boolean {
  if (options.logsWarnOnly && line.level !== "warn" && line.level !== "error") {
    return false;
  }
  return true;
}

export interface BuiltReport {
  text: string;
  findings: Finding[];
  bytes: number;
  cut: boolean;
}

export function buildReport(
  data: ReportData,
  options: ReportOptions,
): BuiltReport {
  const m = reportMasker(data, options.mask);
  const on = (part: ReportPart) => options.parts[part];
  const focus = options.focusPluginId;
  const findings = findProblems({
    request: data.request,
    server: data.server,
    probes: data.probes,
    capture: data.capture,
    frontends: data.frontends,
  });

  const head: string[] = [
    "# Termix diagnostics report",
    "",
    `Made ${data.madeAt} | Termix ${data.version ?? "unknown"} | ${data.environment}`,
    "",
    `Signed in: ${data.context.signedIn ? "yes" : "no"} | Admin: ${data.context.isAdmin ? "yes" : "no"} | Names and addresses: ${options.mask ? "masked" : "shown"}${focus ? ` | Focus plugin: ${focus}` : ""}`,
    "",
    "Secrets (passwords, keys, tokens, cookies) are always removed. Server parts need an admin.",
  ];
  if (options.description?.trim()) {
    head.push("", "## What happened", "", options.description.trim());
  }
  head.push(
    "",
    "## Detected problems",
    "",
    ...findings.map((f) => `- [${f.level}] ${f.text}`),
  );

  const body: string[] = [];
  const section = (title: string, content: string) =>
    body.push("", `## ${title}`, "", content);

  if (on("server")) {
    if (data.server) section("Server", json(data.server.server));
    else if (data.serverError) {
      section("Server", `Could not be read: ${data.serverError}`);
    }
  }
  if (on("plugins")) {
    if (data.server) {
      section(
        "Plugins on the server",
        json({
          plugins: data.server.plugins.plugins,
          skipped: data.server.plugins.skipped,
        }),
      );
    }
    section("Plugins in the browser", json(data.frontends));
  }
  if (on("sections") && data.server?.sections.length) {
    const parts = data.server.sections
      .filter((s) => !focus || s.pluginId === focus)
      .map(
        (s) =>
          `### ${s.title} (${s.pluginId})\n\n${s.error ? `Error: ${s.error}` : json(s.data)}`,
      );
    if (parts.length) section("Plugin sections", parts.join("\n\n"));
  }
  if (on("request")) {
    if (data.request)
      section("Request as the server saw it", json(data.request));
    else
      section(
        "Request as the server saw it",
        `Could not be read: ${data.requestError ?? "unknown"}`,
      );
  }
  if (on("probes") && data.probes.length) {
    section(
      "Probes",
      block(
        data.probes
          .map(
            (p) =>
              `${p.ok ? "ok  " : "FAIL"} ${p.name.padEnd(36)} ${String(p.status ?? (p.redirected ? "redirect" : "-")).padEnd(8)} ${String(p.contentType ?? "-").padEnd(34)} ${p.ms}ms${p.cookies ? "" : " no-cookies"}${p.gotHtml ? " got-html" : ""}${p.server ? ` server=${p.server}` : ""}${p.via ? ` via=${p.via}` : ""}${p.error ? ` error=${p.error}` : ""}`,
          )
          .join("\n"),
      ),
    );
  }
  const capture = data.capture;
  if (on("errors")) {
    section(
      `Browser errors (${capture.errors.length})`,
      capture.errors.length
        ? block(
            capture.errors
              .map(
                (e) =>
                  `${e.at} ${e.kind} [${e.source}] ${e.message}${e.where ? ` at ${e.where}` : ""}${e.blocked ? ` blocked=${e.blocked}` : ""}${e.stack ? `\n  ${e.stack.split("\n").slice(0, 8).join("\n  ")}` : ""}`,
              )
              .join("\n"),
          )
        : "None.",
    );
  }
  if (on("network")) {
    section(
      `Network (${capture.network.length}, dropped ${capture.dropped.network})`,
      block(
        capture.network
          .map(
            (n) =>
              `${n.at} ${n.via.padEnd(5)} ${n.method.padEnd(6)} ${String(n.status ?? "-").padEnd(4)} ${String(n.ms ?? "-").padStart(5)}ms ${n.url}${n.contentType ? ` (${n.contentType})` : ""}${n.finalUrl ? ` -> ${n.finalUrl}` : ""}${n.source !== "page" ? ` [${n.source}]` : ""}${n.error ? ` error=${n.error}` : ""}`,
          )
          .join("\n") || "None.",
      ),
    );
    if (capture.sockets.length) {
      section(
        "WebSockets",
        block(
          capture.sockets
            .map(
              (s) =>
                `${s.at} ${s.event.padEnd(5)} ${s.url}${s.code !== undefined ? ` code=${s.code}` : ""}${s.reason ? ` reason=${s.reason}` : ""}${s.afterMs !== undefined ? ` after=${s.afterMs}ms` : ""}`,
            )
            .join("\n"),
        ),
      );
    }
  }
  if (on("page")) section("Page", json(data.page));
  if (on("dom")) {
    section(
      "Page layout",
      block(options.domText ? data.domWithText : data.dom),
    );
  }

  // Long lists go last, so a cut never loses the parts above.
  const tail: { title: string; lines: string[] }[] = [];
  if (on("console")) {
    tail.push({
      title: `Browser console (${capture.console.length}, dropped ${capture.dropped.console})`,
      lines: capture.console.map(
        (c) =>
          `${c.at} ${c.level.toUpperCase().padEnd(5)} [${c.source}] ${c.text}`,
      ),
    });
  }
  if (on("logs") && data.server?.logs) {
    const logs = data.server.logs;
    const pick = (lines: ServerLogLine[]) =>
      lines.filter(
        (line) =>
          keepLog(line, options) &&
          (!focus || !line.pluginId || line.pluginId === focus),
      );
    tail.push({
      title: "Server log since start",
      lines: logLines(pick(logs.boot)).split("\n"),
    });
    tail.push({
      title: `Server log, recent${logs.droppedBefore ? ` (older lines before ${logs.droppedBefore} were dropped)` : ""}`,
      lines: logLines(pick(logs.recent)).split("\n"),
    });
  }

  const fixed = m.text([...head, ...body].join("\n"));
  let budget = MAX_BYTES - fixed.length - 2000;
  let cut = false;
  const tails = tail.map((part) => {
    let text = m.text(part.lines.join("\n"));
    if (text.length > budget) {
      cut = true;
      text = `...(older lines cut to fit 5 MB)\n${text.slice(text.length - Math.max(0, budget))}`;
    }
    budget -= text.length;
    return `\n## ${part.title}\n\n${block(text || "None.")}`;
  });

  const text = `${fixed}\n${tails.join("\n")}\n`;
  return {
    text,
    findings: findings.map((f) => ({ ...f, text: m.text(f.text) })),
    bytes: new Blob([text]).size,
    cut,
  };
}

/** A short version for the GitHub issue body, which has a size limit. */
export function issueSummary(report: BuiltReport, data: ReportData): string {
  return [
    `Termix ${data.version ?? "unknown"} | ${data.environment}`,
    "",
    "Detected problems:",
    ...report.findings.map((f) => `- [${f.level}] ${f.text}`),
    "",
    "The full diagnostics report is attached.",
  ].join("\n");
}

export function reportFileName(madeAt: string): string {
  const stamp = madeAt.replace(/[:]/g, "-").replace(/\..+$/, "");
  return `termix-report-${stamp}.md`;
}
