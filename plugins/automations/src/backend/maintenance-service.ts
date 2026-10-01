import { randomUUID } from "node:crypto";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { HostMaintenance } from "../maintenance.js";
import type { MaintenanceRepository } from "./maintenance-repository.js";
import {
  MaintenanceInputError,
  advanceMaintenance,
  beginMaintenance,
  parsePlan,
  plansOverlap,
} from "./maintenance-time.js";

export type MaintenanceService = ReturnType<typeof createMaintenanceService>;

export function createMaintenanceService(
  ctx: PluginContext,
  repository: MaintenanceRepository,
  resetBreaches: (
    userId: string,
    hostId: number,
  ) => Promise<void> = async () => {},
) {
  // Serialize reads that advance schedules with edits and the reminder tick.
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
  async function update(
    userId: string,
    hostId: number,
    edit?: (state: HostMaintenance) => void,
  ) {
    const state = await repository.read(userId, hostId);
    const previous = JSON.stringify(state);
    const wasActive = !!state.active;
    advanceMaintenance(state, Date.now());
    const activated = !wasActive && !!state.active;
    edit?.(state);
    if (activated || wasActive !== !!state.active)
      await resetBreaches(userId, hostId);
    if (JSON.stringify(state) !== previous)
      await repository.write(userId, hostId, state);
    return state;
  }
  const service = {
    read: (userId: string, hostId: number) =>
      exclusive(() => update(userId, hostId)),
    async isMaintaining(userId: string, hostId: number): Promise<boolean> {
      return !!(await service.read(userId, hostId)).active;
    },
    edit: (userId: string, hostId: number, action: string, input: unknown) =>
      exclusive(() =>
        update(userId, hostId, (state) => {
          if (action === "end") {
            state.active = null;
            return;
          }
          if (action === "remove") {
            const id = (input as { id?: unknown } | null)?.id;
            if (
              typeof id !== "string" ||
              !state.plans.some((plan) => plan.id === id)
            )
              throw new MaintenanceInputError("Schedule not found");
            state.plans = state.plans.filter((plan) => plan.id !== id);
            return;
          }
          if (action !== "start" && action !== "schedule")
            throw new MaintenanceInputError("Invalid maintenance action");
          if (action === "start" && state.active)
            throw new MaintenanceInputError("Maintenance is already active");
          const plan = parsePlan(input, Date.now(), action === "start");
          plan.id = randomUUID();
          if (action === "start") {
            beginMaintenance(state, plan, Date.now());
            return;
          }
          if (state.plans.length >= 20)
            throw new MaintenanceInputError(
              "At most 20 maintenance schedules are allowed per host",
            );
          if (
            state.plans.some(
              (other) =>
                other.nextStart &&
                plansOverlap(plan, { ...other, start: other.nextStart }),
            )
          ) {
            throw new MaintenanceInputError(
              "Planned maintenance times overlap",
            );
          }
          state.plans.push(plan);
        }),
      ),
    async list(userId: string) {
      const rows = await repository.list(userId);
      return Promise.all(
        rows.map(async (row) => ({
          hostId: row.hostId,
          state: await service.read(userId, row.hostId),
        })),
      );
    },
    wipeUser: (userId: string) => exclusive(() => repository.wipeUser(userId)),
    async tick() {
      for (const row of await repository.list()) {
        try {
          await exclusive(async () => {
            const state = await update(row.userId, row.hostId);
            const active = state.active;
            if (!active?.notifyOverdue || active.notified) return;
            const deadline =
              Date.parse(active.estimatedEnd) + active.graceMinutes * 60_000;
            if (Date.now() < deadline) return;
            await ctx.asUser(row.userId, async () => {
              const host = await ctx.hosts.get(row.hostId);
              if (!host || host.userId !== row.userId) return;
              const status = await ctx.hosts.status.get(row.hostId);
              // Unknown or stale data is not evidence of an overdue outage.
              if (
                status?.status !== "offline" ||
                Date.parse(status.lastChecked) < deadline ||
                !Number.isFinite(Date.parse(status.lastChecked))
              )
                return;
              const result = await ctx.notify.send({
                title: `Maintenance overdue: ${host.name || host.ip}`,
                body: `${active.reasons.join("; ")}. Estimated completion: ${active.estimatedEnd}. The host is still unavailable after the grace period. Maintenance remains active until you end it.`,
                severity: "warning",
                category: "automations.maintenance_overdue",
                dedupeKey: `maintenance:${row.hostId}:${active.startedAt}:${active.estimatedEnd}`,
                context: { hostId: row.hostId },
              });
              if (result.recipients > 0) {
                active.notified = true;
                await repository.write(row.userId, row.hostId, state);
              }
            });
          });
        } catch (error) {
          ctx.log.warn(
            `Maintenance check for host ${row.hostId} failed: ${String(error)}`,
          );
        }
      }
    },
  };
  return service;
}
