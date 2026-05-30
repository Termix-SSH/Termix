import type { Client, ConnectConfig } from "ssh2";
import { statsLogger } from "../utils/logger.js";

export interface MetricsSession {
  client: Client;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
  activeOperations: number;
  hostId: number;
  userId: string;
}

export interface PendingTOTPSession {
  client: Client;
  finish: (responses: string[]) => void;
  config: ConnectConfig;
  createdAt: number;
  sessionId: string;
  hostId: number;
  userId: string;
  prompts?: Array<{ prompt: string; echo: boolean }>;
  totpPromptIndex?: number;
  resolvedPassword?: string;
  totpAttempts: number;
}

export interface MetricsViewer {
  sessionId: string;
  userId: string;
  hostId: number;
  lastHeartbeat: number;
}

export const metricsSessions: Record<string, MetricsSession> = {};
export const pendingTOTPSessions: Record<string, PendingTOTPSession> = {};

export function cleanupMetricsSession(sessionId: string): void {
  const session = metricsSessions[sessionId];
  if (session) {
    if (session.activeOperations > 0) {
      statsLogger.warn(
        `Deferring metrics session cleanup - ${session.activeOperations} active operations`,
        {
          operation: "cleanup_deferred",
          sessionId,
          activeOperations: session.activeOperations,
        },
      );
      scheduleMetricsSessionCleanup(sessionId);
      return;
    }

    try {
      session.client.end();
    } catch {
      // expected
    }
    clearTimeout(session.timeout);
    delete metricsSessions[sessionId];
  }
}

export function scheduleMetricsSessionCleanup(sessionId: string): void {
  const session = metricsSessions[sessionId];
  if (session) {
    if (session.timeout) clearTimeout(session.timeout);

    session.timeout = setTimeout(
      () => {
        cleanupMetricsSession(sessionId);
      },
      30 * 60 * 1000,
    );
  }
}

export function getSessionKey(hostId: number, userId: string): string {
  return `${userId}:${hostId}`;
}
