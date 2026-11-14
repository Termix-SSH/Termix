/**
 * The two-admin wait: on a server with two or more admins that turned it on,
 * changes a taken over admin account could use to take the whole server
 * (a new admin, a sign-in method off, a plugin with dangerous access) wait a
 * while before they apply. The other admins get an alert and can cancel.
 *
 * Off by default. Turning it on is instant; turning it off or shortening the
 * wait is itself held. TERMIX_ADMIN_HOLD_MINUTES forces it from the server.
 */

import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import {
  createCurrentAdminHoldRepository,
  createCurrentSettingsRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import type { AdminHoldRecord } from "../database/repositories/admin-hold-repository.js";
import {
  getAuditUsername,
  getRequestMeta,
  logAudit,
} from "../utils/audit-logger.js";
import { isEmbeddedBackend } from "../utils/embedded-host.js";
import { authLogger } from "../utils/logger.js";

export const ADMIN_HOLD_MINUTES_KEY = "admin_hold_minutes";
export const ADMIN_HOLD_ENV = "TERMIX_ADMIN_HOLD_MINUTES";
export const DEFAULT_HOLD_MINUTES = 60;
export const MAX_HOLD_MINUTES = 7 * 24 * 60;
const RUN_EVERY_MS = 30_000;

/**
 * Plugin capabilities that make an install, grant or enable wait. The two
 * critical ones plus those that run programs, act as users, change sign in
 * or read the server's secrets.
 */
export const HELD_CAPABILITIES = [
  "credentials:read",
  "system:tls",
  "process:spawn",
  "users:write",
  "users:impersonate",
  "auth:provide",
  "auth:policy",
  "config:secrets",
];

export type HoldKind =
  | "make_admin"
  | "password_login_off"
  | "plugin_enable"
  | "plugin_disable"
  | "plugin_grant"
  | "hold_minutes";

export interface HoldApplier {
  apply: (
    payload: Record<string, unknown>,
    requesterId: string,
  ) => Promise<void>;
}

const appliers = new Map<HoldKind, HoldApplier>();
let timer: ReturnType<typeof setInterval> | null = null;

/** Route modules register how each kind is applied once its wait is over. */
export function registerHoldKind(kind: HoldKind, applier: HoldApplier): void {
  appliers.set(kind, applier);
}

function envMinutes(): number | null {
  const raw = process.env[ADMIN_HOLD_ENV];
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(MAX_HOLD_MINUTES, Math.floor(value));
}

export interface HoldSettings {
  /** 0 means off. */
  minutes: number;
  forcedByEnv: boolean;
  adminCount: number;
  /** On and with two or more admins, so changes wait right now. */
  active: boolean;
}

async function adminCount(): Promise<number> {
  const users = await createCurrentUserRepository().listAll();
  return users.filter((user) => user.isAdmin).length;
}

export async function getHoldSettings(): Promise<HoldSettings> {
  const forced = envMinutes();
  const stored = Number(
    (await createCurrentSettingsRepository().get(ADMIN_HOLD_MINUTES_KEY)) ?? 0,
  );
  const minutes =
    forced ?? (Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0);
  const count = await adminCount();
  return {
    minutes,
    forcedByEnv: forced !== null,
    adminCount: count,
    active: minutes > 0 && count >= 2 && !isEmbeddedBackend(),
  };
}

export interface HoldTicket {
  held: true;
  holdId: string;
  runsAt: string;
  minutes: number;
}

/** Saves a held change and tells the other admins. */
export async function createHold(input: {
  kind: HoldKind;
  payload: Record<string, unknown>;
  summary: string;
  requesterId: string;
  minutes: number;
  req?: Request;
}): Promise<HoldTicket> {
  const id = nanoid();
  const now = new Date();
  const runsAt = new Date(now.getTime() + input.minutes * 60_000).toISOString();
  const requesterName = await getAuditUsername(input.requesterId);
  await createCurrentAdminHoldRepository().create({
    id,
    kind: input.kind,
    payload: JSON.stringify(input.payload),
    summary: input.summary,
    requestedBy: input.requesterId,
    requestedByName: requesterName,
    requestedAt: now.toISOString(),
    runsAt,
    status: "pending",
  });
  const meta = input.req ? getRequestMeta(input.req) : {};
  await logAudit({
    userId: input.requesterId,
    username: requesterName,
    action: "admin_hold_created",
    resourceType: "admin_hold",
    resourceId: id,
    resourceName: input.kind,
    details: JSON.stringify({ summary: input.summary, runsAt }),
    ...meta,
    success: true,
  });
  await alertOtherAdmins(input.requesterId, {
    title: "An admin change is waiting",
    body: `${requesterName} asked to ${input.summary}. It applies at ${runsAt} unless another admin cancels it.`,
    dedupeKey: `admin-hold:${id}`,
  });
  return { held: true, holdId: id, runsAt, minutes: input.minutes };
}

/**
 * Holds the change when the wait is on, answering 202 with the ticket.
 * Returns true when the caller must stop.
 */
export async function holdIfNeeded(
  req: Request,
  res: Response,
  input: {
    kind: HoldKind;
    payload: Record<string, unknown>;
    summary: string;
    requesterId: string;
  },
): Promise<boolean> {
  const settings = await getHoldSettings();
  if (!settings.active) return false;
  const ticket = await createHold({ ...input, minutes: settings.minutes, req });
  res.status(202).json({
    ...ticket,
    message: `This change waits ${settings.minutes} minutes so the other admins can see it`,
  });
  return true;
}

async function alertOtherAdmins(
  exceptUserId: string | null,
  alert: { title: string; body: string; dedupeKey: string },
): Promise<void> {
  try {
    const { sendCoreAlert } = await import("../notify/core-notify.js");
    const users = await createCurrentUserRepository().listAll();
    for (const user of users) {
      if (!user.isAdmin || user.id === exceptUserId) continue;
      await sendCoreAlert({
        ...alert,
        severity: "critical",
        category: "termix.admin-hold",
        audience: { userId: user.id },
      });
    }
  } catch (error) {
    authLogger.warn("Could not alert admins about a held change", {
      operation: "admin_hold_alert",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface HoldView {
  id: string;
  kind: string;
  summary: string;
  requestedBy: string | null;
  requestedByName: string;
  requestedAt: string;
  runsAt: string;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  error: string | null;
}

function toView(row: AdminHoldRecord): HoldView {
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    requestedBy: row.requestedBy ?? null,
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt,
    runsAt: row.runsAt,
    status: row.status,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ?? null,
    error: row.error ?? null,
  };
}

export async function listHolds(): Promise<HoldView[]> {
  return (await createCurrentAdminHoldRepository().list()).map(toView);
}

export async function cancelHold(
  id: string,
  adminId: string,
  req?: Request,
): Promise<"cancelled" | "not_found" | "not_pending"> {
  const repository = createCurrentAdminHoldRepository();
  const hold = await repository.findById(id);
  if (!hold) return "not_found";
  const decided = await repository.transition(id, "pending", "cancelled", {
    decidedBy: adminId,
    decidedAt: new Date().toISOString(),
  });
  if (!decided) return "not_pending";
  const name = await getAuditUsername(adminId);
  await logAudit({
    userId: adminId,
    username: name,
    action: "admin_hold_cancelled",
    resourceType: "admin_hold",
    resourceId: id,
    resourceName: hold.kind,
    details: JSON.stringify({ summary: hold.summary }),
    ...(req ? getRequestMeta(req) : {}),
    success: true,
  });
  await alertOtherAdmins(adminId, {
    title: "A waiting admin change was cancelled",
    body: `${name} cancelled: ${hold.summary}.`,
    dedupeKey: `admin-hold-cancel:${id}`,
  });
  return "cancelled";
}

/** Applies every hold whose wait is over. */
export async function runDueHolds(now = new Date()): Promise<number> {
  const repository = createCurrentAdminHoldRepository();
  let applied = 0;
  for (const hold of await repository.listDue(now.toISOString())) {
    if (!(await repository.transition(hold.id, "pending", "applying")))
      continue;
    const decidedAt = new Date().toISOString();
    const fail = async (error: string) => {
      await repository.transition(hold.id, "applying", "failed", {
        decidedAt,
        error,
      });
      await logAudit({
        userId: hold.requestedBy ?? null,
        username: hold.requestedByName,
        action: "admin_hold_failed",
        resourceType: "admin_hold",
        resourceId: hold.id,
        resourceName: hold.kind,
        details: JSON.stringify({ summary: hold.summary }),
        success: false,
        errorMessage: error,
      });
    };
    const applier = appliers.get(hold.kind as HoldKind);
    if (!applier) {
      await fail("Unknown change");
      continue;
    }
    const requester = hold.requestedBy
      ? await createCurrentUserRepository().findById(hold.requestedBy)
      : null;
    // The wait is for the other admins: a requester who lost admin since
    // doesn't get the change.
    if (!requester?.isAdmin) {
      await fail("The admin who asked is no longer an admin");
      continue;
    }
    try {
      await applier.apply(JSON.parse(hold.payload), requester.id);
      await repository.transition(hold.id, "applying", "applied", {
        decidedAt,
      });
      applied += 1;
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error));
    }
  }
  return applied;
}

/** Saves the wait setting, holding it when it would weaken the wait. */
export async function updateHoldMinutes(
  minutes: number,
  adminId: string,
  req?: Request,
): Promise<{ held: false; minutes: number } | HoldTicket> {
  const settings = await getHoldSettings();
  if (settings.forcedByEnv) throw new HoldSettingLocked();
  if (settings.active && minutes < settings.minutes) {
    return createHold({
      kind: "hold_minutes",
      payload: { minutes },
      summary:
        minutes === 0
          ? "turn off the admin wait"
          : `shorten the admin wait to ${minutes} minutes`,
      requesterId: adminId,
      minutes: settings.minutes,
      req,
    });
  }
  await saveHoldMinutes(minutes, adminId);
  return { held: false, minutes };
}

export class HoldSettingLocked extends Error {
  constructor() {
    super(`Set by ${ADMIN_HOLD_ENV} on the server`);
  }
}

async function saveHoldMinutes(
  minutes: number,
  adminId: string,
): Promise<void> {
  await createCurrentSettingsRepository().set(
    ADMIN_HOLD_MINUTES_KEY,
    String(minutes),
  );
  await logAudit({
    userId: adminId,
    username: await getAuditUsername(adminId),
    action: "update_auth_setting",
    resourceType: "setting",
    resourceId: ADMIN_HOLD_MINUTES_KEY,
    resourceName: ADMIN_HOLD_MINUTES_KEY,
    details: JSON.stringify({ value: minutes }),
    success: true,
  });
}

registerHoldKind("hold_minutes", {
  apply: async (payload, requesterId) => {
    const minutes = Number(payload.minutes);
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new Error("Bad wait time");
    }
    await saveHoldMinutes(minutes, requesterId);
  },
});

export function startAdminHolds(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runDueHolds().catch((error) => {
      authLogger.warn("Waiting admin changes could not run", {
        operation: "admin_hold_run",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, RUN_EVERY_MS);
  timer.unref?.();
}

/** Test seam. */
export function stopAdminHolds(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Whether a plugin asks for access that makes changes to it wait. */
export function needsHold(capabilities: readonly string[]): string[] {
  return capabilities.filter((capability) =>
    HELD_CAPABILITIES.includes(capability),
  );
}
