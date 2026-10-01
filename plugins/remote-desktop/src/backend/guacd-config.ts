export type GuacdOptions = {
  host: string;
  port: number;
};

const DEFAULT_GUACD_OPTIONS: GuacdOptions = {
  host: "localhost",
  port: 4822,
};

function parsePort(value: string | undefined, fallback: number) {
  const port = parseInt(value || "", 10);
  return Number.isFinite(port) ? port : fallback;
}

export function parseGuacdUrl(
  value: string,
  fallback: GuacdOptions = DEFAULT_GUACD_OPTIONS,
): GuacdOptions {
  const raw = value.trim();
  if (!raw) {
    return fallback;
  }

  if (raw.includes("://")) {
    try {
      const url = new URL(raw);
      return {
        host: url.hostname || fallback.host,
        port: parsePort(url.port, fallback.port),
      };
    } catch {
      return fallback;
    }
  }

  const bracketedIpv6 = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketedIpv6) {
    return {
      host: bracketedIpv6[1],
      port: parsePort(bracketedIpv6[2], fallback.port),
    };
  }

  const [host, port] = raw.split(":");
  return {
    host: host || fallback.host,
    port: parsePort(port, fallback.port),
  };
}

export function getGuacdEnvOptions(): GuacdOptions | null {
  if (process.env.GUACD_URL) {
    return parseGuacdUrl(process.env.GUACD_URL);
  }

  if (!process.env.GUACD_HOST && !process.env.GUACD_PORT) {
    return null;
  }

  return {
    host: process.env.GUACD_HOST || DEFAULT_GUACD_OPTIONS.host,
    port: parsePort(process.env.GUACD_PORT, DEFAULT_GUACD_OPTIONS.port),
  };
}

export function resolveGuacdOptions(dbUrl?: string | null): GuacdOptions {
  const envOptions = getGuacdEnvOptions();
  if (envOptions) {
    return envOptions;
  }

  if (dbUrl) {
    return parseGuacdUrl(dbUrl);
  }

  return DEFAULT_GUACD_OPTIONS;
}

export function formatGuacdOptions(options: GuacdOptions): string {
  return `${options.host}:${options.port}`;
}

export function getDefaultGuacdUrl(): string {
  return formatGuacdOptions(resolveGuacdOptions());
}
