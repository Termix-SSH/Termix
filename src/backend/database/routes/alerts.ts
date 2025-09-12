import express from "express";
import { db } from "../db/index.js";
import { dismissedAlerts } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import fetch from "node-fetch";
import { authLogger } from "../../utils/logger.js";

interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

class AlertCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_DURATION = 5 * 60 * 1000;

  set(key: string, data: any): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + this.CACHE_DURATION,
    });
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }
}

const alertCache = new AlertCache();

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";
const REPO_OWNER = "LukeGus";
const REPO_NAME = "Termix-Docs";
const ALERTS_FILE = "main/termix-alerts.json";

interface TermixAlert {
  id: string;
  title: string;
  message: string;
  expiresAt: string;
  priority?: "low" | "medium" | "high" | "critical";
  type?: "info" | "warning" | "error" | "success";
  actionUrl?: string;
  actionText?: string;
}

async function fetchAlertsFromGitHub(): Promise<TermixAlert[]> {
  const cacheKey = "termix_alerts";
  const cachedData = alertCache.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }
  try {
    const url = `${GITHUB_RAW_BASE}/${REPO_OWNER}/${REPO_NAME}/${ALERTS_FILE}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TermixAlertChecker/1.0",
      },
    });

    if (!response.ok) {
      authLogger.warn("GitHub API returned error status", {
        operation: "alerts_fetch",
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(
        `GitHub raw content error: ${response.status} ${response.statusText}`,
      );
    }

    const alerts: TermixAlert[] = (await response.json()) as TermixAlert[];

    const now = new Date();

    const validAlerts = alerts.filter((alert) => {
      const expiryDate = new Date(alert.expiresAt);
      const isValid = expiryDate > now;
      return isValid;
    });

    alertCache.set(cacheKey, validAlerts);
    return validAlerts;
  } catch (error) {
    authLogger.error("Failed to fetch alerts from GitHub", {
      operation: "alerts_fetch",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
}

const router = express.Router();

// Route: Get all active alerts
// GET /alerts
router.get("/", async (req, res) => {
  try {
    const alerts = await fetchAlertsFromGitHub();
    res.json({
      alerts,
      cached: alertCache.get("termix_alerts") !== null,
      total_count: alerts.length,
    });
  } catch (error) {
    authLogger.error("Failed to get alerts", error);
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// Route: Get alerts for a specific user (excluding dismissed ones)
// GET /alerts/user/:userId
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const allAlerts = await fetchAlertsFromGitHub();

    const dismissedAlertRecords = await db
      .select({ alertId: dismissedAlerts.alertId })
      .from(dismissedAlerts)
      .where(eq(dismissedAlerts.userId, userId));

    const dismissedAlertIds = new Set(
      dismissedAlertRecords.map((record) => record.alertId),
    );

    const userAlerts = allAlerts.filter(
      (alert) => !dismissedAlertIds.has(alert.id),
    );

    res.json({
      alerts: userAlerts,
      total_count: userAlerts.length,
      dismissed_count: dismissedAlertIds.size,
    });
  } catch (error) {
    authLogger.error("Failed to get user alerts", error);
    res.status(500).json({ error: "Failed to fetch user alerts" });
  }
});

// Route: Dismiss an alert for a user
// POST /alerts/dismiss
router.post("/dismiss", async (req, res) => {
  try {
    const { userId, alertId } = req.body;

    if (!userId || !alertId) {
      authLogger.warn("Missing userId or alertId in dismiss request");
      return res
        .status(400)
        .json({ error: "User ID and Alert ID are required" });
    }

    const existingDismissal = await db
      .select()
      .from(dismissedAlerts)
      .where(
        and(
          eq(dismissedAlerts.userId, userId),
          eq(dismissedAlerts.alertId, alertId),
        ),
      );

    if (existingDismissal.length > 0) {
      authLogger.warn(`Alert ${alertId} already dismissed by user ${userId}`);
      return res.status(409).json({ error: "Alert already dismissed" });
    }

    const result = await db.insert(dismissedAlerts).values({
      userId,
      alertId,
    });

    res.json({ message: "Alert dismissed successfully" });
  } catch (error) {
    authLogger.error("Failed to dismiss alert", error);
    res.status(500).json({ error: "Failed to dismiss alert" });
  }
});

// Route: Get dismissed alerts for a user
// GET /alerts/dismissed/:userId
router.get("/dismissed/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const dismissedAlertRecords = await db
      .select({
        alertId: dismissedAlerts.alertId,
        dismissedAt: dismissedAlerts.dismissedAt,
      })
      .from(dismissedAlerts)
      .where(eq(dismissedAlerts.userId, userId));

    res.json({
      dismissed_alerts: dismissedAlertRecords,
      total_count: dismissedAlertRecords.length,
    });
  } catch (error) {
    authLogger.error("Failed to get dismissed alerts", error);
    res.status(500).json({ error: "Failed to fetch dismissed alerts" });
  }
});

// Route: Undismiss an alert for a user (remove from dismissed list)
// DELETE /alerts/dismiss
router.delete("/dismiss", async (req, res) => {
  try {
    const { userId, alertId } = req.body;

    if (!userId || !alertId) {
      return res
        .status(400)
        .json({ error: "User ID and Alert ID are required" });
    }

    const result = await db
      .delete(dismissedAlerts)
      .where(
        and(
          eq(dismissedAlerts.userId, userId),
          eq(dismissedAlerts.alertId, alertId),
        ),
      );

    if (result.changes === 0) {
      return res.status(404).json({ error: "Dismissed alert not found" });
    }
    res.json({ message: "Alert undismissed successfully" });
  } catch (error) {
    authLogger.error("Failed to undismiss alert", error);
    res.status(500).json({ error: "Failed to undismiss alert" });
  }
});

export default router;
