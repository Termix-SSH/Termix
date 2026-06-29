import { useState, useRef } from "react";
import { ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  ImageWidgetConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

const FIT_MAP = {
  contain: "object-contain",
  cover: "object-cover",
  fill: "object-fill",
};

function ImageWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<ImageWidgetConfig>) {
  const { t } = useTranslation();
  const { imageUrl, fit, alt, linkUrl } = config;
  const [failed, setFailed] = useState(false);
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);

  const titleBar = widget.title ? (
    <WidgetTitle title={widget.title} icon={<ImageIcon size={11} />} />
  ) : null;

  const content = (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {titleBar}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {imageUrl && !failed ? (
          <img
            src={imageUrl}
            alt={alt ?? ""}
            className={`w-full h-full ${FIT_MAP[fit]}`}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/40">
            <ImageIcon size={24} />
            <span className="text-[10px]">{t("homepage.noImage")}</span>
          </div>
        )}
      </div>
    </div>
  );

  if (isReadOnly || !linkUrl) return content;

  return (
    <a
      href={linkUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-full h-full"
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

registerWidget<ImageWidgetConfig>({
  id: "image_widget",
  name: "Image",
  description: "Display any image from a URL",
  category: "info",
  icon: <ImageIcon size={14} />,
  defaultConfig: { imageUrl: "", fit: "contain" },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: ImageWidget,
});

export { ImageWidget };
