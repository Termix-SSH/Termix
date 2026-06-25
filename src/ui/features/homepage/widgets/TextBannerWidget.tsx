import { Type } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import type {
  TextBannerConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";

const FONT_SIZE_MAP = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-xl",
};

const FONT_WEIGHT_MAP = {
  normal: "font-normal",
  semibold: "font-semibold",
  bold: "font-bold",
};

const TEXT_ALIGN_MAP = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function TextBannerWidget({ config }: WidgetComponentProps<TextBannerConfig>) {
  const { text, fontSize, textAlign, fontWeight, backgroundColor } = config;

  return (
    <div
      className={`flex items-center w-full h-full px-3 py-2 overflow-hidden ${FONT_SIZE_MAP[fontSize]} ${FONT_WEIGHT_MAP[fontWeight]} ${TEXT_ALIGN_MAP[textAlign]}`}
      style={backgroundColor ? { background: backgroundColor } : undefined}
    >
      <span className="whitespace-pre-wrap break-words w-full text-foreground leading-tight">
        {text || "Banner text"}
      </span>
    </div>
  );
}

registerWidget<TextBannerConfig>({
  id: "text_banner",
  name: "Text Banner",
  description: "A styled text label for sections and headings",
  category: "info",
  icon: <Type size={14} />,
  defaultConfig: {
    text: "",
    fontSize: "lg",
    textAlign: "center",
    fontWeight: "semibold",
  },
  defaultSize: { w: GRID_SIZE * 14, h: GRID_SIZE * 3 },
  minSize: { w: GRID_SIZE * 3, h: GRID_SIZE * 2 },
  component: TextBannerWidget,
});

export { TextBannerWidget };
