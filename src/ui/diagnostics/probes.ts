/**
 * Requests made while a report is built, to see what the browser really gets
 * back. A login proxy in front of Termix shows up here as a redirect or an
 * HTML page where a script was expected.
 */
import { getBackendUrl } from "@/main-axios";
import { frameUrl } from "@/plugin-host/frames/frame-connection";
import { getPluginStoreState } from "@/plugin-host/plugin-store";
import { redactUrl } from "./redact";

export interface ProbeResult {
  name: string;
  url: string;
  /** Sent the way a plugin frame does: no cookies, no redirects. */
  cookies: boolean;
  expect: "json" | "js" | "html";
  status: number | null;
  ok: boolean;
  redirected: boolean;
  contentType: string | null;
  server: string | null;
  via: string | null;
  ms: number;
  /** HTML came back where JSON or a script was expected. */
  gotHtml: boolean;
  error?: string;
}

const TIMEOUT_MS = 8000;
const MAX_PLUGIN_PROBES = 60;

async function probe(
  name: string,
  url: string,
  expect: ProbeResult["expect"],
  cookies: boolean,
): Promise<ProbeResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const base = {
    name,
    url: redactUrl(url),
    cookies,
    expect,
  };
  try {
    const response = await fetch(url, {
      credentials: cookies ? "include" : "omit",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    const redirected = response.type === "opaqueredirect";
    const contentType = response.headers.get("content-type");
    const gotHtml =
      expect !== "html" && !!contentType && /text\/html/i.test(contentType);
    return {
      ...base,
      status: redirected ? null : response.status,
      ok: response.ok && !redirected && !gotHtml,
      redirected,
      contentType,
      server: response.headers.get("server"),
      via: response.headers.get("via"),
      ms: Math.round(performance.now() - started),
      gotHtml,
    };
  } catch (error) {
    return {
      ...base,
      status: null,
      ok: false,
      redirected: false,
      contentType: null,
      server: null,
      via: null,
      ms: Math.round(performance.now() - started),
      gotHtml: false,
      error: controller.signal.aborted
        ? "Timed out"
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Core routes, then each enabled plugin's bundle and frame page. */
export async function runProbes(
  focusPluginId?: string,
): Promise<ProbeResult[]> {
  const jobs: Promise<ProbeResult>[] = [
    probe("version", getBackendUrl("/version"), "json", true),
    probe(
      "diagnostics request",
      getBackendUrl("/diagnostics/request"),
      "json",
      true,
    ),
    probe("plugins list", getBackendUrl("/plugins/public"), "json", false),
  ];
  const records = [...getPluginStoreState().records.values()]
    .filter((record) => record.summary.enabled && record.summary.frontend)
    .sort((a, b) =>
      a.summary.id === focusPluginId
        ? -1
        : b.summary.id === focusPluginId
          ? 1
          : a.summary.id.localeCompare(b.summary.id),
    )
    .slice(0, MAX_PLUGIN_PROBES);
  for (const { summary } of records) {
    const version = summary.assetVersion
      ? `?v=${encodeURIComponent(summary.assetVersion)}`
      : "";
    const bundle = getBackendUrl(
      `/plugin-assets/${encodeURIComponent(summary.id)}/frontend.js${version}`,
    );
    jobs.push(probe(`${summary.id} bundle`, bundle, "js", true));
    if (summary.frontendIsolation !== "page") {
      jobs.push(
        probe(
          `${summary.id} frame page`,
          frameUrl(summary.id, {}),
          "html",
          false,
        ),
        probe(`${summary.id} bundle from frame`, bundle, "js", false),
      );
    }
  }
  return Promise.all(jobs);
}
