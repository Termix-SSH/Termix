import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface TransferPerformanceProfile {
  throughputBps: number;
  failureRate: number;
  samples: number;
  preferredLanes: number;
  pipelineConcurrency: number;
  updatedAt: number;
}

export interface TransferTuning {
  parallelSegmentCount: number;
  pipelineConcurrency: number;
}

export interface DirectRouteProfile {
  directMs: number;
  relayMs: number;
  failureRate: number;
  benchmarkSamples: number;
  outcomeSamples: number;
  benchmarkedAt: number;
  cooldownUntil?: number;
  updatedAt: number;
}

const MB = 1024 * 1024;
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PROFILES = 128;
const STORE_VERSION = 1;
const STORE_FILENAME = "adaptive-transfer-profiles.json";
const profiles = new Map<string, TransferPerformanceProfile>();
const directRoutes = new Map<string, DirectRouteProfile>();
let loadedPath: string | undefined;
let loadPromise: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistPromise = Promise.resolve();

interface PersistedProfiles {
  version: typeof STORE_VERSION;
  profiles: Record<string, TransferPerformanceProfile>;
  directRoutes: Record<string, DirectRouteProfile>;
}

function validDirectRoute(value: unknown): value is DirectRouteProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<DirectRouteProfile>;
  return (
    Number.isFinite(profile.directMs) &&
    Number(profile.directMs) > 0 &&
    Number.isFinite(profile.relayMs) &&
    Number(profile.relayMs) > 0 &&
    Number.isFinite(profile.failureRate) &&
    Number(profile.failureRate) >= 0 &&
    Number(profile.failureRate) <= 1 &&
    Number.isFinite(profile.benchmarkSamples) &&
    Number(profile.benchmarkSamples) > 0 &&
    Number.isFinite(profile.outcomeSamples) &&
    Number(profile.outcomeSamples) >= 0 &&
    Number.isFinite(profile.benchmarkedAt) &&
    (profile.cooldownUntil === undefined ||
      Number.isFinite(profile.cooldownUntil)) &&
    Number.isFinite(profile.updatedAt)
  );
}

function storePath(): string {
  const dataDir =
    process.env.DATA_DIR || path.join(process.cwd(), "db", "data");
  return path.join(dataDir, STORE_FILENAME);
}

function profileId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function validProfile(value: unknown): value is TransferPerformanceProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<TransferPerformanceProfile>;
  return (
    Number.isFinite(profile.throughputBps) &&
    Number(profile.throughputBps) >= 0 &&
    Number.isFinite(profile.failureRate) &&
    Number(profile.failureRate) >= 0 &&
    Number(profile.failureRate) <= 1 &&
    Number.isFinite(profile.samples) &&
    Number(profile.samples) > 0 &&
    Number.isFinite(profile.preferredLanes) &&
    Number.isFinite(profile.pipelineConcurrency) &&
    Number.isFinite(profile.updatedAt)
  );
}

function trimProfiles(now = Date.now()): void {
  for (const [key, profile] of profiles) {
    if (now - profile.updatedAt > PROFILE_TTL_MS) profiles.delete(key);
  }
  const recent = [...profiles.entries()]
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PROFILES);
  profiles.clear();
  for (const [key, profile] of recent) profiles.set(key, profile);

  for (const [key, profile] of directRoutes) {
    if (now - profile.updatedAt > PROFILE_TTL_MS) directRoutes.delete(key);
  }
  const recentRoutes = [...directRoutes.entries()]
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PROFILES);
  directRoutes.clear();
  for (const [key, profile] of recentRoutes) directRoutes.set(key, profile);
}

async function persistProfiles(): Promise<void> {
  trimProfiles();
  const target = storePath();
  const temporary = `${target}.${process.pid}.tmp`;
  const payload: PersistedProfiles = {
    version: STORE_VERSION,
    profiles: Object.fromEntries(profiles),
    directRoutes: Object.fromEntries(directRoutes),
  };
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(payload), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporary, target);
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function queuePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistPromise = persistPromise.then(persistProfiles);
  }, 250);
  persistTimer.unref?.();
}

export async function initializeTransferProfiles(): Promise<void> {
  const target = storePath();
  if (loadedPath === target) return loadPromise;
  loadedPath = target;
  loadPromise = (async () => {
    profiles.clear();
    directRoutes.clear();
    try {
      const parsed = JSON.parse(
        await fs.readFile(target, "utf8"),
      ) as Partial<PersistedProfiles>;
      if (parsed.version !== STORE_VERSION || !parsed.profiles) return;
      for (const [key, profile] of Object.entries(parsed.profiles)) {
        if (/^[a-f0-9]{64}$/.test(key) && validProfile(profile)) {
          profiles.set(key, profile);
        }
      }
      for (const [key, profile] of Object.entries(parsed.directRoutes ?? {})) {
        if (/^[a-f0-9]{64}$/.test(key) && validDirectRoute(profile)) {
          directRoutes.set(key, profile);
        }
      }
      trimProfiles();
    } catch {
      // Missing or malformed local learning data must not affect transfers.
    }
  })();
  return loadPromise;
}

export async function flushTransferProfiles(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  persistPromise = persistPromise.then(persistProfiles);
  await persistPromise;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function selectTransferTuning(
  fileSize: number,
  profile?: TransferPerformanceProfile,
  requestedLanes?: number,
): TransferTuning {
  if (fileSize < 32 * MB) {
    return { parallelSegmentCount: 1, pipelineConcurrency: 8 };
  }

  let lanes = fileSize >= 1024 * MB ? 4 : 2;
  let pipelineConcurrency = fileSize >= 256 * MB ? 32 : 16;

  if (profile) {
    lanes = profile.preferredLanes;
    pipelineConcurrency = profile.pipelineConcurrency;
    if (profile.failureRate >= 0.2) {
      lanes = Math.min(lanes, 2);
      pipelineConcurrency = Math.min(pipelineConcurrency, 16);
    }
  }

  if (requestedLanes !== undefined) lanes = requestedLanes;

  const segmentCapacity = Math.max(1, Math.ceil(fileSize / (256 * MB)));
  return {
    parallelSegmentCount: clamp(lanes, 1, Math.min(8, segmentCapacity)),
    pipelineConcurrency: clamp(pipelineConcurrency, 8, 64),
  };
}

export function updateTransferProfile(
  previous: TransferPerformanceProfile | undefined,
  observation: {
    bytes: number;
    durationMs: number;
    lanes: number;
    pipelineConcurrency: number;
    failed: boolean;
    now?: number;
  },
): TransferPerformanceProfile {
  const now = observation.now ?? Date.now();
  const throughputBps =
    observation.durationMs > 0
      ? (observation.bytes * 1000) / observation.durationMs
      : 0;
  const weight = previous ? 0.25 : 1;
  const smoothedThroughput = previous
    ? previous.throughputBps * (1 - weight) + throughputBps * weight
    : throughputBps;
  const failure = observation.failed ? 1 : 0;
  const failureRate = previous
    ? previous.failureRate * (1 - weight) + failure * weight
    : failure;

  let preferredLanes = observation.lanes;
  let pipelineConcurrency = observation.pipelineConcurrency;
  if (failureRate >= 0.2) {
    preferredLanes = Math.max(1, Math.floor(preferredLanes / 2));
    pipelineConcurrency = Math.max(8, Math.floor(pipelineConcurrency / 2));
  } else if (
    !observation.failed &&
    previous &&
    previous.samples >= 2 &&
    throughputBps > previous.throughputBps * 1.25
  ) {
    preferredLanes = Math.min(8, preferredLanes + 1);
    pipelineConcurrency = Math.min(64, pipelineConcurrency + 8);
  }

  return {
    throughputBps: smoothedThroughput,
    failureRate,
    samples: (previous?.samples ?? 0) + 1,
    preferredLanes,
    pipelineConcurrency,
    updatedAt: now,
  };
}

export function getTransferProfile(
  key: string,
  now = Date.now(),
): TransferPerformanceProfile | undefined {
  const id = profileId(key);
  const profile = profiles.get(id);
  if (!profile) return undefined;
  if (now - profile.updatedAt <= PROFILE_TTL_MS) return profile;
  profiles.delete(id);
  queuePersist();
  return undefined;
}

export function recordTransferProfile(
  key: string,
  observation: Parameters<typeof updateTransferProfile>[1],
): TransferPerformanceProfile {
  const profile = updateTransferProfile(getTransferProfile(key), observation);
  profiles.set(profileId(key), profile);
  trimProfiles(observation.now);
  queuePersist();
  return profile;
}

export function getDirectRouteProfile(
  key: string,
  now = Date.now(),
): DirectRouteProfile | undefined {
  const id = profileId(key);
  const profile = directRoutes.get(id);
  if (!profile) return undefined;
  if (now - profile.updatedAt <= PROFILE_TTL_MS) return profile;
  directRoutes.delete(id);
  queuePersist();
  return undefined;
}

export function recordDirectRouteBenchmark(
  key: string,
  directMs: number,
  relayMs: number,
  now = Date.now(),
): DirectRouteProfile {
  const previous = getDirectRouteProfile(key, now);
  const weight = previous ? 0.25 : 1;
  const profile: DirectRouteProfile = {
    directMs: previous
      ? previous.directMs * (1 - weight) + directMs * weight
      : directMs,
    relayMs: previous
      ? previous.relayMs * (1 - weight) + relayMs * weight
      : relayMs,
    failureRate: previous?.failureRate ?? 0,
    benchmarkSamples: (previous?.benchmarkSamples ?? 0) + 1,
    outcomeSamples: previous?.outcomeSamples ?? 0,
    benchmarkedAt: now,
    cooldownUntil: previous?.cooldownUntil,
    updatedAt: now,
  };
  directRoutes.set(profileId(key), profile);
  trimProfiles(now);
  queuePersist();
  return profile;
}

export function recordDirectRouteOutcome(
  key: string,
  failed: boolean,
  now = Date.now(),
  cooldownMs = 10 * 60 * 1000,
): DirectRouteProfile | undefined {
  const previous = getDirectRouteProfile(key, now);
  if (!previous) return undefined;
  const failure = failed ? 1 : 0;
  const weight = previous.outcomeSamples > 0 ? 0.25 : 1;
  const profile = {
    ...previous,
    failureRate: previous.failureRate * (1 - weight) + failure * weight,
    outcomeSamples: previous.outcomeSamples + 1,
    cooldownUntil: failed ? now + cooldownMs : undefined,
    updatedAt: now,
  };
  directRoutes.set(profileId(key), profile);
  queuePersist();
  return profile;
}

export function getRecentDirectRouteDecision(
  key: string,
  maxAgeMs: number,
  now = Date.now(),
): { useDirect: boolean; directMs: number; relayMs: number } | undefined {
  const profile = getDirectRouteProfile(key, now);
  if (!profile) return undefined;
  if ((profile.cooldownUntil ?? 0) > now) {
    return {
      useDirect: false,
      directMs: profile.directMs,
      relayMs: profile.relayMs,
    };
  }
  if (now - profile.benchmarkedAt > maxAgeMs) return undefined;
  return {
    useDirect:
      profile.failureRate < 0.2 && profile.directMs <= profile.relayMs * 0.8,
    directMs: profile.directMs,
    relayMs: profile.relayMs,
  };
}

export function clearTransferProfiles(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = undefined;
  loadedPath = undefined;
  loadPromise = undefined;
  profiles.clear();
  directRoutes.clear();
}
