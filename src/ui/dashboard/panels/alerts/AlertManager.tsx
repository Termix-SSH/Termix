/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { AlertCard } from "./AlertCard.tsx";
import { Button } from "@/components/button.tsx";
import { getUserAlerts, dismissAlert } from "@/main-axios.ts";
import { useTranslation } from "react-i18next";
import type { TermixAlert } from "@/types";
import { toast } from "sonner";

interface AlertManagerProps {
  userId: string | null;
  loggedIn: boolean;
}

export function AlertManager({
  userId,
  loggedIn,
}: AlertManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<TermixAlert[]>([]);
  const [currentAlertIndex, setCurrentAlertIndex] = useState(0);
  const [, setLoading] = useState(false);
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
    } catch {
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
    } catch {
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

  const hasMultipleAlerts = alerts.length > 1;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 z-[99999]">
      <div className="w-full max-w-2xl mx-4 flex flex-col gap-2">
        {hasMultipleAlerts && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">
              {currentAlertIndex + 1} {t("common.of")} {alerts.length}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousAlert}
                disabled={currentAlertIndex === 0}
              >
                {t("common.previous")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextAlert}
                disabled={currentAlertIndex === alerts.length - 1}
              >
                {t("common.next")}
              </Button>
            </div>
          </div>
        )}

        <AlertCard
          alert={currentAlert}
          onDismiss={handleDismissAlert}
          onClose={handleCloseCurrentAlert}
        />

        {error && (
          <div className="border border-destructive/50 rounded-md px-3 py-2 text-destructive text-xs">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
