import { useEffect, useState, useRef } from "react";
import { Link, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  DashboardLinksConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getServiceLinks } from "@/api/dashboard-api";
import type { ServiceLink } from "@/api/dashboard-api";
import { WidgetTitle } from "./WidgetTitle";

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=32&domain_url=${encodeURIComponent(domain)}`;
  } catch {
    return "";
  }
}

function LinkTile({
  link,
  showIcons,
  isReadOnly,
}: {
  link: ServiceLink;
  showIcons: boolean;
  isReadOnly?: boolean;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);
  const faviconUrl = showIcons ? getFaviconUrl(link.url) : null;

  const content = (
    <div className="group flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 transition-colors overflow-hidden border-b border-border/30">
      {showIcons &&
        (faviconUrl && !imgFailed ? (
          <img
            src={faviconUrl}
            alt=""
            className="w-4 h-4 shrink-0 object-contain"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <ExternalLink size={12} className="shrink-0 text-muted-foreground" />
        ))}
      <span className="text-[10px] font-medium text-foreground truncate flex-1">
        {link.label}
      </span>
    </div>
  );

  if (isReadOnly || !link.url) return content;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block no-underline"
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

function DashboardLinksWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<DashboardLinksConfig>) {
  const { t } = useTranslation();
  const { showIcons, columns, maxItems } = config;
  const [links, setLinks] = useState<ServiceLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getServiceLinks()
      .then((data) => setLinks(maxItems ? data.slice(0, maxItems) : data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [maxItems]);

  if (loading)
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.loading")}
      </div>
    );
  if (links.length === 0)
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noDashboardLinks")}
      </div>
    );

  const colClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-2"
        : "grid-cols-3";

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Link size={11} />} />
      <div className={`grid ${colClass} flex-1 overflow-auto content-start`}>
        {links.map((link) => (
          <LinkTile
            key={link.id}
            link={link}
            showIcons={showIcons}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>
    </div>
  );
}

registerWidget<DashboardLinksConfig>({
  id: "dashboard_links",
  name: "Dashboard Links",
  description: "Shows your saved dashboard service links",
  category: "links",
  icon: <Link size={14} />,
  defaultConfig: { showIcons: true, columns: 1 },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: DashboardLinksWidget,
});

export { DashboardLinksWidget };
