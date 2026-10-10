/**
 * Onboarding step bookkeeping, shared by the frontend and the ui-preferences
 * route. Dependency-free for the backend's NodeNext build.
 *
 * Each step has a key and a version. A user's `seen` map records the highest
 * version of each step they have been shown, so bumping one step's version
 * shows that step again (and only that step) to everyone who saw it before.
 * Plugin steps are keyed `<pluginId>:<id>`.
 */

export const CORE_ONBOARDING_STEPS = {
  plugins: 1,
  "desktop-sync": 1,
  preset: 1,
  appearance: 1,
  security: 1,
} as const;

export type CoreOnboardingStepKey = keyof typeof CORE_ONBOARDING_STEPS;

/**
 * What a user who finished the old single-version onboarding counts as
 * having seen. Frozen on purpose: a later bump in CORE_ONBOARDING_STEPS must
 * still show the bumped step to these users.
 */
export const LEGACY_SEEN: Readonly<Record<string, number>> = Object.freeze({
  plugins: 1,
  "desktop-sync": 1,
  preset: 1,
  appearance: 1,
  security: 1,
});

export const MAX_SEEN_ENTRIES = 500;
const MAX_KEY_LENGTH = 128;

export function pluginStepKey(pluginId: string, id: string): string {
  return `${pluginId}:${id}`;
}

export function isValidSeenEntry(key: string, version: unknown): boolean {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    key.length <= MAX_KEY_LENGTH &&
    typeof version === "number" &&
    Number.isInteger(version) &&
    version >= 1 &&
    version <= 1_000_000
  );
}

export function sanitizeSeen(input: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let count = 0;
  for (const [key, version] of Object.entries(input)) {
    if (count >= MAX_SEEN_ENTRIES) break;
    if (!isValidSeenEntry(key, version)) continue;
    out[key] = version as number;
    count++;
  }
  return out;
}

/** Per-key max, so a stale tab never lowers what another tab recorded. */
export function mergeSeen(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...(a ?? {}) };
  for (const [key, version] of Object.entries(b ?? {})) {
    if ((out[key] ?? 0) < version) out[key] = version;
  }
  return sanitizeSeen(out);
}
