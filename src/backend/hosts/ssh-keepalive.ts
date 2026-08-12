const MIN_KEEPALIVE_INTERVAL_MS = 5000;

export function resolveSshKeepalive(
  intervalSeconds: number | undefined,
  countMax: number | undefined,
  defaultIntervalMs: number,
  defaultCountMax: number,
) {
  return {
    keepaliveInterval:
      typeof intervalSeconds !== "number"
        ? defaultIntervalMs
        : intervalSeconds === 0
          ? 0
          : Math.max(MIN_KEEPALIVE_INTERVAL_MS, intervalSeconds * 1000),
    keepaliveCountMax:
      typeof countMax !== "number"
        ? defaultCountMax
        : countMax === 0
          ? 0
          : Math.max(1, countMax),
  };
}
