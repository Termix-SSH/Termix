import React, { useEffect, useState } from "react";
import { HomepageAlertCard } from "./HomepageAlertCard.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getUserAlerts, dismissAlert } from "@/ui/main-axios.ts";
import { useTranslation } from "react-i18next";
import type { TermixAlert } from "../../../types/index.js";

interface AlertManagerProps {
  userId: string | null;
  loggedIn: boolean;
}

export function HomepageAlertManager({
  userId,
  loggedIn,
}: AlertManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<TermixAlert[]>([]);
  const [currentAlertIndex, setCurrentAlertIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loggedIn && userId) {
      fetchUserAlerts();
    }
  }, [loggedIn, userId]);

  const fetchUserAlerts = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getUserAlerts();
      const userAlerts = response.alerts || [];

      const sortedAlerts = userAlerts.sort((a: TermixAlert, b: TermixAlert) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const aPriority =
          priorityOrder[a.priority as keyof typeof priorityOrder] || 0;
        const bPriority =
          priorityOrder[b.priority as keyof typeof priorityOrder] || 0;

        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }

        return (
          new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
        );
      });

      setAlerts(sortedAlerts);
      setCurrentAlertIndex(0);
    } catch (err) {
      const { toast } = await import("sonner");
      toast.error(t("homepage.failedToLoadAlerts"));
      setError(t("homepage.failedToLoadAlerts"));
    } finally {
      setLoading(false);
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      await dismissAlert(alertId);

      setAlerts((prev) => {
        const newAlerts = prev.filter((alert) => alert.id !== alertId);
        return newAlerts;
      });

      setCurrentAlertIndex((prevIndex) => {
        const newAlertsLength = alerts.length - 1;
        if (newAlertsLength === 0) return 0;
        if (prevIndex >= newAlertsLength)
          return Math.max(0, newAlertsLength - 1);
        return prevIndex;
      });
    } catch (err) {
      setError(t("homepage.failedToDismissAlert"));
    }
  };

  const handleCloseCurrentAlert = () => {
    if (alerts.length === 0) return;

    if (currentAlertIndex < alerts.length - 1) {
      setCurrentAlertIndex(currentAlertIndex + 1);
    } else {
      setAlerts([]);
      setCurrentAlertIndex(0);
    }
  };

  const handlePreviousAlert = () => {
    if (currentAlertIndex > 0) {
      setCurrentAlertIndex(currentAlertIndex - 1);
    }
  };

  const handleNextAlert = () => {
    if (currentAlertIndex < alerts.length - 1) {
      setCurrentAlertIndex(currentAlertIndex + 1);
    }
  };

  if (!loggedIn || !userId) {
    return null;
  }

  if (alerts.length === 0) {
    return null;
  }

  const currentAlert = alerts[currentAlertIndex];

  if (!currentAlert) {
    return null;
  }

  const priorityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  alerts.forEach((alert) => {
    const priority = alert.priority || "low";
    priorityCounts[priority as keyof typeof priorityCounts]++;
  });
  const hasMultipleAlerts = alerts.length > 1;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-[99999]">
      <div className="relative w-full max-w-2xl mx-4">
        <HomepageAlertCard
          alert={currentAlert}
          onDismiss={handleDismissAlert}
          onClose={handleCloseCurrentAlert}
        />

        {hasMultipleAlerts && (
          <div className="absolute -bottom-16 left-1/2 transform -translate-x-1/2 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousAlert}
              disabled={currentAlertIndex === 0}
              className="h-8 px-3"
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentAlertIndex + 1} of {alerts.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextAlert}
              disabled={currentAlertIndex === alerts.length - 1}
              className="h-8 px-3"
            >
              Next
            </Button>
          </div>
        )}

        {error && (
          <div className="absolute -bottom-20 left-1/2 transform -translate-x-1/2">
            <div className="bg-destructive text-destructive-foreground px-3 py-1 rounded text-sm">
              {error}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
