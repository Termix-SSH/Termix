import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  Mail,
  MailOpen,
  OctagonAlert,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, cn } from "@termix/plugin-sdk/ui";
import type { AlertItem, Severity } from "../types";
import { sourceLabel, timeAgo } from "./format";

const SEVERITY_ICON: Record<Severity, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: OctagonAlert,
};

const SEVERITY_CLASS: Record<Severity, string> = {
  info: "text-muted-foreground",
  success: "text-green-500",
  warning: "text-amber-500",
  critical: "text-destructive",
};

export function SeverityIcon({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const Icon = SEVERITY_ICON[severity];
  return <Icon className={cn(SEVERITY_CLASS[severity], className)} />;
}

export function AlertList({
  items,
  compact = false,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  items: AlertItem[];
  compact?: boolean;
  onOpen: (item: AlertItem) => void;
  onToggleRead: (item: AlertItem) => void;
  onDelete: (item: AlertItem) => void;
}) {
  const { t, language } = useTranslation();

  return (
    <div className="flex flex-col">
      {items.map((item) => {
        const unread = !item.readAt;
        const failed = (item.deliveries ?? []).filter((entry) => !entry.ok);
        const actionText =
          typeof item.context?.actionText === "string"
            ? item.context.actionText
            : t("inbox.openLink");
        return (
          <div
            key={item.id}
            className={cn(
              "group relative flex gap-2.5 border-b border-border px-3 py-2.5 hover:bg-muted/40",
              unread && "bg-accent-brand/5",
            )}
          >
            {unread && (
              <span
                className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent-brand"
                aria-label={t("inbox.unread")}
              />
            )}
            <SeverityIcon
              severity={item.severity}
              className="size-4 shrink-0 mt-0.5"
            />
            <button
              type="button"
              className="flex-1 min-w-0 text-left"
              onClick={() => onOpen(item)}
            >
              <div
                className={cn(
                  "text-sm leading-snug break-words",
                  unread ? "font-semibold" : "font-medium",
                )}
              >
                {item.title}
              </div>
              {item.body && (
                <div
                  className={cn(
                    "text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words",
                    compact && "line-clamp-2",
                  )}
                >
                  {item.body}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                <span title={item.category}>{sourceLabel(item.source, t)}</span>
                <span>{timeAgo(item.createdAt, language)}</span>
                {failed.length > 0 && (
                  <span
                    className="text-destructive"
                    title={failed
                      .map((entry) => `${entry.name}: ${entry.error ?? ""}`)
                      .join("\n")}
                  >
                    {t("inbox.deliveryFailed", { count: failed.length })}
                  </span>
                )}
                {item.link?.url && (
                  <a
                    href={item.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent-brand hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {actionText}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            </button>
            <div className="flex items-start gap-0.5 shrink-0 opacity-60 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-none"
                title={unread ? t("inbox.markRead") : t("inbox.markUnread")}
                aria-label={
                  unread ? t("inbox.markRead") : t("inbox.markUnread")
                }
                onClick={() => onToggleRead(item)}
              >
                {unread ? (
                  <MailOpen className="size-3.5" />
                ) : (
                  <Mail className="size-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-none"
                title={t("inbox.delete")}
                aria-label={t("inbox.delete")}
                onClick={() => onDelete(item)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
