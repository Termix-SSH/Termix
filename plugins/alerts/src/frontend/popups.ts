import { severityRank, type AlertItem } from "../types";

export type PopupLevel = "all" | "warning" | "critical" | "off";

export function shouldPopUp(item: AlertItem, level: PopupLevel): boolean {
  if (level === "off") return false;
  if (level === "all") return true;
  return severityRank(item.severity) >= severityRank(level);
}
