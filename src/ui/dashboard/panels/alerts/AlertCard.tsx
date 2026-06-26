import React from "react";
import { Button } from "@/components/button.tsx";
import { Badge } from "@/components/badge.tsx";
import {
  X,
  ExternalLink,
  AlertTriangle,
  Info,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TermixAlert } from "@/types";

interface AlertCardProps {
  alert: TermixAlert;
  onDismiss: (alertId: string) => void;
  onClose: () => void;
}

const getAlertIcon = (type?: string) => {
  switch (type) {
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-accent-brand" />;
    case "error":
      return <AlertCircle className="h-5 w-5 text-destructive" />;
    case "success":
      return <CheckCircle className="h-5 w-5 text-green-400" />;
    case "info":
    default:
      return <Info className="h-5 w-5 text-muted-foreground" />;
  }
};

const getAccentBorderClass = (priority?: string, type?: string): string => {
  if (priority === "critical" || type === "error")
    return "border-t-2 border-t-destructive";
  if (priority === "high" || type === "warning")
    return "border-t-2 border-t-accent-brand";
  if (priority === "medium" || type === "success")
    return "border-t-2 border-t-green-400";
  return "";
};

const getPriorityBadgeVariant = (
  priority?: string,
): "destructive" | "secondary" | "default" => {
  switch (priority) {
    case "critical":
    case "high":
      return "destructive";
    case "medium":
      return "secondary";
    case "low":
    default:
      return "default";
  }
};

const getTypeBadgeVariant = (
  type?: string,
): "destructive" | "secondary" | "default" => {
  switch (type) {
    case "error":
      return "destructive";
    case "warning":
      return "secondary";
    case "success":
    case "info":
    default:
      return "default";
  }
};

export function AlertCard({
  alert,
  onDismiss,
  onClose,
}: AlertCardProps): React.ReactElement | null {
  const { t } = useTranslation();

  if (!alert) {
    return null;
  }

  const handleDismiss = () => {
    onDismiss(alert.id);
    onClose();
  };

  return (
    <div
      className={`w-full border border-foreground/10 rounded-none bg-card overflow-hidden ${getAccentBorderClass(alert.priority, alert.type)}`}
    >
      <div className="flex items-start justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          {getAlertIcon(alert.type)}
          <span className="text-sm font-semibold">{alert.title}</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X />
        </Button>
      </div>

      {(alert.priority || alert.type) && (
        <div className="flex items-center gap-2 px-4 pb-3">
          {alert.priority && (
            <Badge variant={getPriorityBadgeVariant(alert.priority)}>
              {alert.priority.toUpperCase()}
            </Badge>
          )}
          {alert.type && (
            <Badge
              variant={getTypeBadgeVariant(alert.type)}
              className={
                alert.type === "success" ? "text-green-400" : undefined
              }
            >
              {alert.type}
            </Badge>
          )}
        </div>
      )}

      <div className="mx-3 mb-3 border border-foreground/10 px-3 py-3 bg-background">
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {alert.message}
        </p>
      </div>

      <div className="flex items-center gap-2 px-4 pb-4">
        <Button variant="outline" size="sm" onClick={handleDismiss}>
          {t("common.dismiss")}
        </Button>
        {alert.actionUrl && alert.actionText && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(alert.actionUrl, "_blank", "noopener,noreferrer")
            }
            className="gap-1.5 text-accent-brand border-accent-brand/30 hover:border-accent-brand/60"
          >
            {alert.actionText}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
