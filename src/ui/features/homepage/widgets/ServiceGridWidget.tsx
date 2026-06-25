import { useRef, useState, useEffect } from "react";
import { Grid3x3, ExternalLink } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  ServiceGridConfig,
  ServiceGridItem,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(domain)}`;
  } catch {
    return "";
  }
}

const ICON_SIZE_MAP = { sm: 16, md: 24, lg: 32 };

function ServiceTile({
  item,
  iconSize,
  showLabels,
  isReadOnly,
}: {
  item: ServiceGridItem;
  iconSize: number;
  showLabels: boolean;
  isReadOnly?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setImgFailed(false);
  }, [item.imageUrl, item.url]);

  const accent = item.accentColor || getAccentColor();
  const imageUrl = item.imageUrl || (item.url ? getFaviconUrl(item.url) : null);

  const content = (
    <div
      className="group flex flex-col items-center justify-center gap-1 p-1.5 w-full h-full border border-border/40 border-t-2 hover:bg-muted/40 transition-colors overflow-hidden"
      style={{ borderTopColor: `${accent}60`, background: "var(--color-card)" }}
    >
      {imageUrl && !imgFailed ? (
        <img
          src={imageUrl}
          alt=""
          style={{ width: iconSize, height: iconSize }}
          className="object-contain shrink-0"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <ExternalLink
          size={iconSize * 0.6}
          className="text-accent-brand shrink-0"
        />
      )}
      {showLabels && (
        <span className="text-[9px] font-medium text-foreground text-center truncate w-full leading-tight">
          {item.label || item.url}
        </span>
      )}
    </div>
  );

  if (isReadOnly || !item.url) return content;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-full h-full no-underline"
      onMouseDown={(e) => {
        mouseDownRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const s = mouseDownRef.current;
        if (
          s &&
          (Math.abs(e.clientX - s.x) > 4 || Math.abs(e.clientY - s.y) > 4)
        )
          e.preventDefault();
        mouseDownRef.current = null;
      }}
    >
      {content}
    </a>
  );
}

function ServiceGridWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<ServiceGridConfig>) {
  const { services, columns, showLabels, iconSize } = config;

  if (services.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        No services configured
      </div>
    );
  }

  const gridCols =
    columns === 2
      ? "grid-cols-2"
      : columns === 3
        ? "grid-cols-3"
        : "grid-cols-4";
  const size = ICON_SIZE_MAP[iconSize];

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Grid3x3 size={11} />} />
      <div
        className={`grid ${gridCols} gap-1.5 p-1.5 flex-1 overflow-auto content-start`}
      >
        {services.map((s, i) => (
          <ServiceTile
            key={i}
            item={s}
            iconSize={size}
            showLabels={showLabels}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>
    </div>
  );
}

registerWidget<ServiceGridConfig>({
  id: "service_grid",
  name: "Service Grid",
  description: "A grid of service tiles with icons and links",
  category: "links",
  icon: <Grid3x3 size={14} />,
  defaultConfig: { services: [], columns: 3, showLabels: true, iconSize: "md" },
  defaultSize: { w: GRID_SIZE * 14, h: GRID_SIZE * 10 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 4 },
  component: ServiceGridWidget,
});

export { ServiceGridWidget };
