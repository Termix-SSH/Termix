import { useRef, useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  ServiceLinkConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";

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

function ServiceLinkWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<ServiceLinkConfig>) {
  const { url, description, accentColor, imageUrl, showImage = true } = config;
  const resolvedImageUrl = showImage
    ? imageUrl || (url ? getFaviconUrl(url) : null)
    : null;
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [resolvedImageUrl]);

  let displayLabel = widget.title;
  if (!displayLabel && url) {
    try {
      displayLabel = new URL(url).hostname;
    } catch {
      displayLabel = url;
    }
  }

  const accentBorder = accentColor || getAccentColor();
  const imgSize = Math.min(48, widget.h * 0.3);

  const content = (
    <div
      className="group flex flex-col items-center justify-center gap-1.5 w-full h-full p-2 select-none border-t-2 relative overflow-hidden"
      style={{ borderTopColor: `${accentBorder}80` }}
    >
      {resolvedImageUrl && !imgFailed ? (
        <img
          src={resolvedImageUrl}
          alt=""
          className="shrink-0 transition-transform duration-150 group-hover:scale-110 object-contain"
          style={{ width: imgSize, height: imgSize }}
          onError={() => setImgFailed(true)}
        />
      ) : showImage ? (
        <ExternalLink
          className="shrink-0 text-accent-brand transition-transform duration-150 group-hover:scale-110"
          style={{ width: imgSize * 0.75, height: imgSize * 0.75 }}
        />
      ) : null}
      <span className="text-xs font-semibold text-foreground text-center leading-tight w-full truncate px-1">
        {displayLabel}
      </span>
      {description && (
        <span className="text-[10px] text-muted-foreground text-center w-full truncate px-1">
          {description}
        </span>
      )}
      {!isReadOnly && url && (
        <ExternalLink
          size={10}
          className="absolute top-1.5 right-1.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors duration-150"
        />
      )}
    </div>
  );

  if (isReadOnly || !url) return content;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-full h-full no-underline"
      onMouseDown={(e) => {
        mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const start = mouseDownPosRef.current;
        if (
          start &&
          (Math.abs(e.clientX - start.x) > 4 ||
            Math.abs(e.clientY - start.y) > 4)
        ) {
          e.preventDefault();
        }
        mouseDownPosRef.current = null;
      }}
    >
      {content}
    </a>
  );
}

registerWidget<ServiceLinkConfig>({
  id: "service_link",
  name: "Service Link",
  description: "A clickable tile linking to a service URL",
  category: "links",
  icon: <ExternalLink size={14} />,
  defaultConfig: { url: "", description: "", showImage: true },
  defaultSize: { w: GRID_SIZE * 8, h: GRID_SIZE * 6 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: ServiceLinkWidget,
});

export { ServiceLinkWidget };
