import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Folder,
  FolderGit2,
  FolderOpen,
  Server,
  ServerCog,
  Cloud,
  CloudCog,
  Database,
  HardDrive,
  Box,
  Boxes,
  Container,
  Network,
  Router,
  Wifi,
  Globe,
  Globe2,
  Terminal,
  Cpu,
  MemoryStick,
  Shield,
  ShieldCheck,
  Lock,
  Key,
  Rocket,
  FlaskConical,
  Wrench,
  Hammer,
  Gauge,
  Activity,
  Layers,
  Building,
  Building2,
  Home,
  Briefcase,
  Code,
  GitBranch,
  Bug,
  Settings,
  Cog,
  Star,
  Flag,
  Bookmark,
  Tag,
  Users,
  User,
  Zap,
  Flame,
  Leaf,
  Mail,
  Monitor,
  Smartphone,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/input";

export const FOLDER_ICON_MAP: Record<string, LucideIcon> = {
  folder: Folder,
  "folder-open": FolderOpen,
  "folder-git": FolderGit2,
  server: Server,
  "server-cog": ServerCog,
  cloud: Cloud,
  "cloud-cog": CloudCog,
  database: Database,
  "hard-drive": HardDrive,
  box: Box,
  boxes: Boxes,
  container: Container,
  network: Network,
  router: Router,
  wifi: Wifi,
  globe: Globe,
  "globe-2": Globe2,
  terminal: Terminal,
  cpu: Cpu,
  memory: MemoryStick,
  shield: Shield,
  "shield-check": ShieldCheck,
  lock: Lock,
  key: Key,
  rocket: Rocket,
  flask: FlaskConical,
  wrench: Wrench,
  hammer: Hammer,
  gauge: Gauge,
  activity: Activity,
  layers: Layers,
  building: Building,
  "building-2": Building2,
  home: Home,
  briefcase: Briefcase,
  code: Code,
  "git-branch": GitBranch,
  bug: Bug,
  settings: Settings,
  cog: Cog,
  star: Star,
  flag: Flag,
  bookmark: Bookmark,
  tag: Tag,
  users: Users,
  user: User,
  zap: Zap,
  flame: Flame,
  leaf: Leaf,
  mail: Mail,
  monitor: Monitor,
  smartphone: Smartphone,
};

export const FOLDER_ICON_IDS = Object.keys(FOLDER_ICON_MAP);

export const DEFAULT_FOLDER_ICON = "folder";
export const DEFAULT_FOLDER_COLOR = "#f59145";

export const SUGGESTED_FOLDER_COLORS = [
  "#f59145",
  "#ef4444",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#6b7280",
];

export function FolderIconEl({
  icon,
  className,
  style,
}: {
  icon?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = FOLDER_ICON_MAP[icon ?? ""] ?? Folder;
  return <Icon className={className} style={style} />;
}

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

export function HexColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const safe = isValidHex(value) ? value : DEFAULT_FOLDER_COLOR;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-none border border-input bg-transparent p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#6b7280"
          className="font-mono uppercase"
          maxLength={7}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_FOLDER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`size-6 rounded-none border transition-all ${
              value.toLowerCase() === c.toLowerCase()
                ? "ring-2 ring-offset-1 ring-offset-background ring-white/60"
                : "opacity-80 hover:opacity-100"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

export function IconPicker({
  value,
  color,
  onChange,
}: {
  value: string;
  color?: string;
  onChange: (icon: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const filtered = query.trim()
    ? FOLDER_ICON_IDS.filter((id) =>
        id.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : FOLDER_ICON_IDS;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-2.5 h-8 bg-muted/60 border border-border/60 rounded-none">
        <Search className="size-3 text-muted-foreground/60 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("hosts.iconSearchPlaceholder")}
          className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
        />
      </div>
      <div className="grid grid-cols-8 gap-1.5 max-h-40 overflow-y-auto pr-1">
        {filtered.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={id}
            className={`flex items-center justify-center h-9 border transition-colors ${
              value === id
                ? "border-accent-brand/50 bg-accent-brand/10"
                : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            <FolderIconEl
              icon={id}
              className="size-4"
              style={value === id ? { color } : undefined}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
