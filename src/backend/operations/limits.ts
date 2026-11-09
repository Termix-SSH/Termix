/**
 * Caps on how much runs at once. The SSH pool caps per key, not per host, so a
 * large rollout or an all hosts table needs its own limit here.
 */

export const MAX_RUNNING = 32;
export const MAX_PER_HOST = 3;

class Slots {
  private used = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async take(): Promise<void> {
    if (this.used < this.size) {
      this.used++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  give(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.used--;
  }

  get idle(): boolean {
    return this.used === 0 && this.waiting.length === 0;
  }
}

const everything = new Slots(MAX_RUNNING);
const perHost = new Map<number, Slots>();
const exclusive = new Map<number, Slots>();

function slotsFor(
  map: Map<number, Slots>,
  hostId: number,
  size: number,
): Slots {
  let slots = map.get(hostId);
  if (!slots) {
    slots = new Slots(size);
    map.set(hostId, slots);
  }
  return slots;
}

/** Runs `work` once there is room. Exclusive work on a host goes one at a time. */
export async function withLimits<T>(
  options: { hostId?: number; exclusive?: boolean },
  work: () => Promise<T>,
): Promise<T> {
  const { hostId } = options;
  const held: { map?: Map<number, Slots>; slots: Slots }[] = [];
  const hold = async (slots: Slots, map?: Map<number, Slots>) => {
    await slots.take();
    held.push({ slots, map });
  };

  try {
    // Same order everywhere, so two runs cannot wait on each other.
    if (hostId !== undefined && options.exclusive) {
      await hold(slotsFor(exclusive, hostId, 1), exclusive);
    }
    if (hostId !== undefined) {
      await hold(slotsFor(perHost, hostId, MAX_PER_HOST), perHost);
    }
    await hold(everything);
    return await work();
  } finally {
    for (const { slots, map } of held.reverse()) {
      slots.give();
      if (map && hostId !== undefined && slots.idle) map.delete(hostId);
    }
  }
}

/** Shares one in-flight promise per key, so one read serves every waiter. */
const inflight = new Map<string, Promise<unknown>>();

export function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const started = work().finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}
