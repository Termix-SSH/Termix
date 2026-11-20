/**
 * Plain checks over the collected data, shown first in a report so the
 * likely cause is the first thing anyone reads.
 */
import type { RequestInfoResponse, ServerPart } from "./diagnostics-api";
import type { ProbeResult } from "./probes";
import type { CaptureSnapshot } from "./store";

export interface Finding {
  level: "problem" | "warning" | "info";
  text: string;
}

export interface RuleInput {
  request?: RequestInfoResponse | null;
  server?: ServerPart | null;
  probes?: ProbeResult[];
  capture?: CaptureSnapshot;
  frontends?: Array<Record<string, unknown>>;
}

export function findProblems(input: RuleInput): Finding[] {
  const out: Finding[] = [];
  const add = (level: Finding["level"], text: string) =>
    out.push({ level, text });

  const probes = input.probes ?? [];
  const blocked = probes.filter(
    (p) => p.redirected || p.gotHtml || p.status === 401 || p.status === 403,
  );
  if (blocked.length) {
    const frameOnly = blocked.every((p) => !p.cookies);
    add(
      "problem",
      `${blocked.length} request(s) to Termix were redirected, refused or got an HTML page back (${blocked
        .slice(0, 5)
        .map((p) => p.name)
        .join(", ")}). ${
        frameOnly
          ? "Only requests without cookies failed, which is what a login proxy in front of Termix does to plugin frames. See https://docs.termix.site/configure/reverse-proxy#login-proxies"
          : "Something between the browser and Termix answers instead of Termix."
      }`,
    );
  }
  const unreachable = probes.filter((p) => p.status === null && !p.redirected);
  if (unreachable.length) {
    add(
      "problem",
      `${unreachable.length} request(s) got no answer: ${unreachable
        .slice(0, 5)
        .map((p) => `${p.name} (${p.error ?? "no answer"})`)
        .join(", ")}`,
    );
  }

  const request = input.request;
  if (request) {
    if (request.safeMode) {
      add("warning", "The server runs in safe mode (TERMIX_SAFE_MODE).");
    }
    const r = request.request;
    if (r.proxySigns.length) {
      add(
        "info",
        `Headers show something in front of Termix: ${r.proxySigns.join(", ")}.`,
      );
    }
    if (r.forwarded.hops >= 2) {
      add(
        "info",
        `The request passed ${r.forwarded.hops} proxies, so a reverse proxy sits in front of Termix.`,
      );
    }
    const skew = Math.abs(Date.parse(request.serverTime) - Date.now());
    if (skew > 2 * 60 * 1000) {
      add(
        "warning",
        `The browser clock and the server clock differ by ${Math.round(skew / 1000)} seconds.`,
      );
    }
  }

  const server = input.server;
  if (server) {
    const db = server.server.database as { health?: string } | undefined;
    if (db?.health === "failed")
      add("problem", "The database health check failed.");
    const dataDir = server.server.dataDir as { writable?: boolean } | undefined;
    if (dataDir?.writable === false) {
      add("problem", "The data folder is not writable.");
    }
    for (const plugin of server.plugins.plugins) {
      const proc = plugin.process as {
        state?: string;
        crashes?: number;
      } | null;
      if (plugin.loader === "failed" || plugin.enabled === "failed") {
        add(
          "problem",
          `Plugin ${plugin.id} failed on the server${plugin.lastError ? `: ${String(plugin.lastError).slice(0, 200)}` : ""}.`,
        );
      } else if (proc?.crashes) {
        add(
          "warning",
          `Plugin ${plugin.id} process crashed ${proc.crashes} time(s).`,
        );
      }
    }
    for (const skipped of server.plugins.skipped) {
      add(
        "warning",
        `Plugin ${skipped.id} did not load: ${skipped.error.slice(0, 200)}`,
      );
    }
    const lines = [
      ...(server.logs?.boot ?? []),
      ...(server.logs?.recent ?? []),
    ];
    const errors = lines.filter((line) => line.level === "error").length;
    if (errors) add("info", `${errors} error line(s) in the server log.`);
  }

  for (const frontend of input.frontends ?? []) {
    if (frontend.frontend === "failed" || frontend.frontend === "blocked") {
      add(
        "problem",
        `Plugin ${String(frontend.id)} did not start in the browser (${String(frontend.frontend)})${frontend.error ? `: ${String(frontend.error).slice(0, 200)}` : ""}.`,
      );
    }
  }

  const capture = input.capture;
  if (capture) {
    const csp = capture.errors.filter((e) => e.kind === "csp");
    const extensions = csp.filter((e) =>
      /^(chrome|moz|safari-web)-extension:/i.test(e.blocked ?? ""),
    );
    if (extensions.length) {
      add(
        "info",
        `A browser extension tried to load into Termix ${extensions.length} time(s). This is usually harmless but can break pages.`,
      );
    }
    if (csp.length > extensions.length) {
      add(
        "warning",
        `${csp.length - extensions.length} content security policy block(s).`,
      );
    }
    const errors = capture.errors.filter((e) => e.kind !== "csp").length;
    if (errors) add("info", `${errors} uncaught error(s) in the browser.`);
    const server5xx = capture.network.filter((n) => (n.status ?? 0) >= 500);
    if (server5xx.length >= 3) {
      add("warning", `${server5xx.length} requests got a server error (5xx).`);
    }
    const sockets = capture.sockets.filter(
      (s) => s.event === "close" && s.code !== 1000 && s.code !== 1005,
    );
    if (sockets.length >= 3) {
      add(
        "warning",
        `${sockets.length} WebSocket(s) closed with an error code.`,
      );
    }
  }

  if (!out.length) add("info", "No problems found by the automatic checks.");
  return out;
}
