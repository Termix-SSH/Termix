/**
 * Swaps names and addresses in a report for placeholders like host-1, so a
 * user can post it publicly. The same value always gets the same placeholder,
 * which keeps the report readable.
 */

export interface MaskNames {
  /** Saved host addresses and names. */
  hosts?: string[];
  /** Usernames: the signed in user, host logins. */
  users?: string[];
  /** The server's own host name, from the address bar. */
  serverHost?: string | null;
}

const IPV4 =
  /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const IPV6 =
  /(?<![\w:])(?:[0-9a-f]{1,4}:){2,7}(?::|[0-9a-f]{1,4})(?![\w:])|(?<![\w:])(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?(?![\w:])/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** The account name in a home folder path, like C:\Users\name or /home/name. */
const HOME_PATH =
  /((?:[A-Za-z]:)?(?:\\\\|\\|\/)(?:Users|home)(?:\\\\|\\|\/))([^\\/\s"'`]+)/g;

/** Addresses that say nothing about the user. */
const KEEP_IPS = new Set(["127.0.0.1", "0.0.0.0", "255.255.255.255"]);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Masker {
  private readonly seen = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  private readonly named: { pattern: RegExp; kind: string }[] = [];

  constructor(names: MaskNames = {}) {
    const add = (value: string | null | undefined, kind: string) => {
      const text = value?.trim();
      // Very short names would match inside ordinary words.
      if (!text || text.length < 3 || /^(localhost|root|admin)$/i.test(text)) {
        return;
      }
      this.named.push({
        pattern: new RegExp(`(?<![\\w.-])${escape(text)}(?![\\w-])`, "gi"),
        kind,
      });
    };
    if (
      names.serverHost &&
      !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(names.serverHost)
    ) {
      this.seen.set(names.serverHost.toLowerCase(), "server-host");
      add(names.serverHost, "server-host");
    }
    // Longest first, so "web.example.com" wins over "web".
    for (const host of [...new Set(names.hosts ?? [])].sort(
      (a, b) => b.length - a.length,
    )) {
      add(host, "host");
    }
    for (const user of [...new Set(names.users ?? [])].sort(
      (a, b) => b.length - a.length,
    )) {
      add(user, "user");
    }
  }

  private placeholder(kind: string, value: string): string {
    const key = value.toLowerCase();
    const known = this.seen.get(key);
    if (known) return known;
    if (kind === "server-host") {
      this.seen.set(key, "server-host");
      return "server-host";
    }
    const next = (this.counts.get(kind) ?? 0) + 1;
    this.counts.set(kind, next);
    const label = `${kind}-${next}`;
    this.seen.set(key, label);
    return label;
  }

  text(input: string): string {
    let out = input;
    for (const { pattern, kind } of this.named) {
      out = out.replace(pattern, (match) => this.placeholder(kind, match));
    }
    out = out.replace(HOME_PATH, (_match, head: string, name: string) =>
      /^(public|default|shared)$/i.test(name)
        ? `${head}${name}`
        : `${head}${this.placeholder("user", name)}`,
    );
    out = out.replace(EMAIL, (match) => this.placeholder("email", match));
    out = out.replace(IPV4, (match) =>
      KEEP_IPS.has(match) ? match : this.placeholder("ip", match),
    );
    out = out.replace(IPV6, (match) =>
      // Clock times look like short IPv6 addresses.
      match === "::1" || /^\d{1,2}(:\d{1,2}){1,3}$/.test(match)
        ? match
        : this.placeholder("ip", match),
    );
    return out;
  }

  /** Masks every string in a JSON-like value, keys included. */
  value<T>(input: T): T {
    const walk = (item: unknown): unknown => {
      if (typeof item === "string") return this.text(item);
      if (Array.isArray(item)) return item.map(walk);
      if (item && typeof item === "object") {
        return Object.fromEntries(
          Object.entries(item).map(([key, inner]) => [
            this.text(key),
            walk(inner),
          ]),
        );
      }
      return item;
    };
    return walk(input) as T;
  }
}

/** Leaves everything as it is, for "show real names". */
export const noMask = {
  text: (input: string) => input,
  value: <T>(input: T) => input,
};

export type ReportMasker = Pick<Masker, "text" | "value">;
