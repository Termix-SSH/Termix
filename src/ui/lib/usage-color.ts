/** Usage ramp for resource readouts: warning from 75, destructive from 90. */

/** Text color class for a percentage. */
export function usageColor(percent: number | null): string {
  if (percent === null) return "text-muted-foreground";
  if (percent >= 90) return "text-destructive";
  if (percent >= 75) return "text-warning";
  return "text-accent-brand";
}

/** Background class for the same ramp. */
export function usageBarColor(percent: number | null): string {
  if (percent === null) return "bg-muted-foreground/30";
  if (percent >= 90) return "bg-destructive";
  if (percent >= 75) return "bg-warning";
  return "bg-accent-brand";
}
