import { isElectron } from "@/lib/electron";

export const CORE_REPO_URL = "https://github.com/Termix-SSH/Termix";

const MAX_URL_LENGTH = 7500;

/** A GitHub repo URL without .git or a trailing slash, or null if it is not one. */
export function normalizeGitHubRepo(repository?: string | null): string | null {
  const repo = repository
    ?.trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (!repo || !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo)) {
    return null;
  }
  return repo;
}

/**
 * A new issue from one of the repo's issue forms, with fields prefilled by
 * their form ids. Logs get cut first when the URL would be too long.
 */
export function buildIssueUrl(
  repo: string,
  options: {
    template: string;
    title?: string;
    fields?: Record<string, string | null | undefined>;
  },
): string {
  const fields = Object.fromEntries(
    Object.entries(options.fields ?? {}).filter(
      (entry): entry is [string, string] => !!entry[1]?.trim(),
    ),
  );
  const build = () => {
    const params = new URLSearchParams({ template: options.template });
    if (options.title) params.set("title", options.title);
    for (const [key, value] of Object.entries(fields)) params.set(key, value);
    return `${repo}/issues/new?${params.toString()}`;
  };
  let url = build();
  while (url.length > MAX_URL_LENGTH && fields.logs) {
    const cut = Math.max(0, fields.logs.length - (url.length - MAX_URL_LENGTH));
    fields.logs =
      cut > 200 ? `${fields.logs.slice(0, cut - 20)}\n...(cut)` : undefined;
    if (!fields.logs) delete fields.logs;
    url = build();
  }
  return url;
}

function osName(ua: string): string {
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

function browserName(ua: string): string {
  const match =
    ua.match(/(Edg)\/(\d+)/) ??
    ua.match(/(OPR)\/(\d+)/) ??
    ua.match(/(Firefox)\/(\d+)/) ??
    ua.match(/(Chrome)\/(\d+)/) ??
    ua.match(/Version\/(\d+).*(Safari)/);
  if (!match) return "Unknown browser";
  if (match[2] === "Safari") return `Safari ${match[1]}`;
  const names: Record<string, string> = { Edg: "Edge", OPR: "Opera" };
  return `${names[match[1]] ?? match[1]} ${match[2]}`;
}

/** One line on where Termix is running, for the environment field. */
export function describeEnvironment(
  userAgent: string = typeof navigator === "undefined"
    ? ""
    : navigator.userAgent,
  desktop: boolean = isElectron(),
): string {
  const os = osName(userAgent);
  return desktop
    ? `Desktop app on ${os}`
    : `Web, ${browserName(userAgent)} on ${os}`;
}

/** A bug report on the Termix core repo. */
export function reportCoreIssueUrl(termixVersion?: string): string {
  return buildIssueUrl(CORE_REPO_URL, {
    template: "bug_report.yml",
    fields: {
      "termix-version": termixVersion,
      environment: describeEnvironment(),
    },
  });
}

/** Beta feedback on the core repo, listing every plugin running a beta. */
export function reportBetaFeedbackUrl(
  termixVersion?: string,
  betaPlugins: Array<{ id: string; version: string }> = [],
): string {
  return buildIssueUrl(CORE_REPO_URL, {
    template: "beta_feedback.yml",
    fields: {
      "termix-version": termixVersion,
      environment: describeEnvironment(),
      "beta-plugins": betaPlugins
        .map((plugin) => `${plugin.id} ${plugin.version}`)
        .join("\n"),
    },
  });
}
