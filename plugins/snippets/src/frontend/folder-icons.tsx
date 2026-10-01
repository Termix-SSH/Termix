import type { CSSProperties } from "react";
import {
  Box,
  Cloud,
  Copy,
  Cpu,
  Database,
  Folder,
  Globe,
  Network,
  Server,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { FolderIconId } from "./types";

const ICONS: Record<FolderIconId, LucideIcon> = {
  folder: Folder,
  server: Server,
  cloud: Cloud,
  database: Database,
  box: Box,
  network: Network,
  copy: Copy,
  settings: Settings,
  cpu: Cpu,
  globe: Globe,
};

export function FolderIcon({
  icon,
  className,
  style,
}: {
  icon: string | null | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = ICONS[(icon ?? "folder") as FolderIconId] ?? Folder;
  return <Icon className={className} style={style} />;
}
