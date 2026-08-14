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

const MB = 1024 * 1024;
const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const profiles = new Map<string, TransferPerformanceProfile>();

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
  const profile = profiles.get(key);
  if (!profile) return undefined;
  if (now - profile.updatedAt <= PROFILE_TTL_MS) return profile;
  profiles.delete(key);
  return undefined;
}

export function recordTransferProfile(
  key: string,
  observation: Parameters<typeof updateTransferProfile>[1],
): TransferPerformanceProfile {
  const profile = updateTransferProfile(getTransferProfile(key), observation);
  profiles.set(key, profile);
  return profile;
}

export function clearTransferProfiles(): void {
  profiles.clear();
}
