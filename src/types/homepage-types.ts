export const GRID_SIZE = 30;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.0;
export const ZOOM_STEP = 0.1;

export type WidgetTypeId =
  | "service_link"
  | "folder"
  | "clock"
  | "notes"
  | "host_status"
  | "bookmark_list"
  | "weather"
  | "iframe_embed"
  | "rss_feed"
  | "metrics_chart"
  | "host_grid"
  | "alert_feed"
  | "ping_status"
  | "recent_activity"
  | "termix_uptime"
  | "system_overview"
  | "ssh_terminal"
  | "quick_connect"
  | "file_manager_widget"
  | "docker_widget"
  | "tunnel_widget"
  | "calendar"
  | "countdown"
  | "search_bar"
  | "text_banner"
  | "image_widget"
  | "markdown_notes"
  | "custom_api"
  | "service_grid"
  | "dashboard_links"
  | "search_links"
  | "link_tree";

export interface HomepageItemRow {
  id: number;
  userId: string;
  typeId: WidgetTypeId;
  title: string | null;
  config: string;
  createdAt: string;
  updatedAt: string;
}

export interface HomepageLayoutEntry {
  itemId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  zOrder?: number;
}

export interface HomepageLayoutData {
  entries: HomepageLayoutEntry[];
  pan: { x: number; y: number };
  zoom: number;
}

export interface HomepageLayoutRow {
  id: number;
  userId: string;
  layout: HomepageLayoutData;
  updatedAt: string;
}

export interface CanvasWidget {
  id: number;
  typeId: WidgetTypeId;
  title: string | null;
  config: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
  zOrder: number;
}

// ---- Per-widget config shapes ----

export interface ServiceLinkConfig {
  url: string;
  description?: string;
  accentColor?: string;
  imageUrl?: string;
  showImage?: boolean;
}

export interface FolderConfig {
  color?: string;
  isExpanded: boolean;
}

export interface ClockConfig {
  timezone?: string;
  showSeconds: boolean;
  format: "12h" | "24h";
}

export interface NotesConfig {
  content: string;
  backgroundColor?: string;
}

export type HostMetricKey =
  | "cpu"
  | "memory"
  | "disk"
  | "uptime"
  | "network"
  | "system"
  | "processes";

export interface HostStatusConfig {
  hostId: number;
  /** @deprecated use shownMetrics instead */
  showMetrics?: boolean;
  /** @deprecated use shownMetrics instead */
  showDisk?: boolean;
  shownMetrics: HostMetricKey[];
  showSparkline?: boolean;
}

export interface BookmarkLink {
  label: string;
  url: string;
}

export interface BookmarkListConfig {
  links: BookmarkLink[];
}

export interface WeatherConfig {
  location: string;
  unit: "C" | "F";
  showForecast: boolean;
}

export interface IframeConfig {
  url: string;
  scrolling: boolean;
}

export interface RssFeedConfig {
  feedUrl: string;
  maxItems: number;
  showDescription: boolean;
}

// ---- New widget configs ----

export type MetricsChartMetric =
  | "cpu"
  | "memory"
  | "disk"
  | "net_rx"
  | "net_tx";
export type MetricsChartRange = "15m" | "1h" | "6h" | "24h";

export interface MetricsChartConfig {
  hostId: number;
  metric: MetricsChartMetric;
  range: MetricsChartRange;
  showCurrentValue: boolean;
}

export interface HostGridConfig {
  hostIds: number[];
  showIp: boolean;
  columns: 2 | 3 | 4;
}

export interface AlertFeedConfig {
  maxItems: number;
  showAcknowledged: boolean;
}

export interface PingUrl {
  label: string;
  url: string;
}

export interface PingStatusConfig {
  urls: PingUrl[];
  refreshInterval: number;
  showLatency: boolean;
}

export type ActivityType =
  | "terminal"
  | "file_manager"
  | "docker"
  | "tunnel"
  | "rdp"
  | "vnc"
  | "telnet";

export interface RecentActivityConfig {
  maxItems: number;
  filterTypes: ActivityType[];
  showTimestamp: boolean;
}

export interface TermixUptimeConfig {
  showDetailed: boolean;
}

export interface SystemOverviewConfig {
  showVersion: boolean;
  showDbHealth: boolean;
  showUptime: boolean;
}

export interface FileManagerWidgetConfig {
  hostId: number;
}

export interface DockerWidgetConfig {
  hostId: number;
}

export interface TunnelWidgetConfig {
  hostId: number;
}

export interface SshTerminalConfig {
  hostId: number;
  autoConnect: boolean;
}

export type QuickConnectType =
  | "terminal"
  | "files"
  | "docker"
  | "tunnel"
  | "host-metrics"
  | "rdp"
  | "vnc"
  | "telnet";

export interface QuickConnectConfig {
  hostIds: number[];
  connectionTypes: QuickConnectType[];
  showStatus: boolean;
  layout: "grid" | "list";
}

export interface CalendarConfig {
  timezone?: string;
  startOnMonday: boolean;
}

export interface CountdownConfig {
  targetDate: string;
  label: string;
  showDays: boolean;
  showHours: boolean;
}

export type SearchEngine = "google" | "duckduckgo" | "bing" | "custom";

export interface SearchBarConfig {
  engine: SearchEngine;
  customUrl?: string;
  placeholder?: string;
  openInNewTab: boolean;
}

export type TextBannerFontSize = "sm" | "md" | "lg" | "xl";
export type TextBannerAlign = "left" | "center" | "right";
export type TextBannerWeight = "normal" | "semibold" | "bold";

export interface TextBannerConfig {
  text: string;
  fontSize: TextBannerFontSize;
  textAlign: TextBannerAlign;
  fontWeight: TextBannerWeight;
  backgroundColor?: string;
}

export interface ImageWidgetConfig {
  imageUrl: string;
  fit: "contain" | "cover" | "fill";
  alt?: string;
  linkUrl?: string;
}

export interface MarkdownNotesConfig {
  content: string;
  backgroundColor?: string;
  renderMarkdown: boolean;
}

export type CustomApiDisplayMode = "value" | "json" | "table";

export interface CustomApiConfig {
  url: string;
  displayField?: string;
  label?: string;
  unit?: string;
  refreshInterval: number;
  displayMode: CustomApiDisplayMode;
  jsonPath?: string;
}

export interface ServiceGridItem {
  label: string;
  url: string;
  imageUrl?: string;
  accentColor?: string;
}

export interface ServiceGridConfig {
  services: ServiceGridItem[];
  columns: 2 | 3 | 4;
  showLabels: boolean;
  iconSize: "sm" | "md" | "lg";
}

export interface DashboardLinksConfig {
  showIcons: boolean;
  columns: 1 | 2 | 3;
  maxItems?: number;
}

export interface SearchLinkShortcut {
  label: string;
  queryTemplate: string;
  icon?: string;
  accentColor?: string;
}

export interface SearchLinksConfig {
  shortcuts: SearchLinkShortcut[];
}

export interface LinkTreeLink {
  label: string;
  url: string;
  description?: string;
}

export interface LinkTreeSection {
  heading: string;
  links: LinkTreeLink[];
}

export interface LinkTreeConfig {
  sections: LinkTreeSection[];
  compact: boolean;
}

// ---- Widget registry types ----

export interface WidgetComponentProps<C = Record<string, unknown>> {
  widget: CanvasWidget;
  config: C;
  isReadOnly?: boolean;
  onConfigUpdate?: (config: Record<string, unknown>) => void;
}

export interface WidgetEditFormProps<C = Record<string, unknown>> {
  config: C;
  onChange: (config: C) => void;
}

export interface WidgetTypeDefinition<C = Record<string, unknown>> {
  id: WidgetTypeId;
  name: string;
  description: string;
  category: "links" | "info" | "system" | "monitoring";
  icon: React.ReactNode;
  defaultConfig: C;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  component: React.ComponentType<WidgetComponentProps<C>>;
  editFormComponent?: React.ComponentType<WidgetEditFormProps<C>>;
}

export interface DragState {
  widgetId: number;
  startMouseX: number;
  startMouseY: number;
  startWidgetX: number;
  startWidgetY: number;
}

export interface ResizeState {
  widgetId: number;
  startMouseX: number;
  startMouseY: number;
  startW: number;
  startH: number;
}

export interface ContextMenuAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export interface ContextMenuState {
  visible: boolean;
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
  anchorRect?: ContextMenuAnchor;
}
