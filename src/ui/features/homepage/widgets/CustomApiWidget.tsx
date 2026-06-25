import { useEffect, useState } from "react";
import { Braces } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  CustomApiConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { homepageApi } from "@/main-axios";
import { WidgetTitle } from "./WidgetTitle";

function resolvePath(obj: unknown, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object")
      return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function resolveArray(
  obj: unknown,
  path: string | undefined,
): unknown[] | null {
  if (!path) {
    if (Array.isArray(obj)) return obj as unknown[];
    return null;
  }
  const val = resolvePath(obj, path);
  return Array.isArray(val) ? (val as unknown[]) : null;
}

async function fetchProxy(url: string, ttl: number): Promise<unknown> {
  const res = await homepageApi.get("/proxy", { params: { url, ttl } });
  return res.data;
}

function CustomApiWidget({
  widget,
  config,
}: WidgetComponentProps<CustomApiConfig>) {
  const { t } = useTranslation();
  const {
    url,
    displayField,
    label,
    unit,
    refreshInterval,
    displayMode,
    jsonPath,
  } = config;
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const interval = Math.max(10, refreshInterval || 60);

  const fetchData = async () => {
    if (!url) return;
    try {
      const result = await fetchProxy(url, interval);
      setData(result);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, interval * 1000);
    return () => clearInterval(iv);
  }, [url, interval]);

  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145";

  if (!url) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.customApiNoUrl")}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.loading")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-red-400">
        {t("homepage.customApiError")}
      </div>
    );
  }

  const titleBar = (
    <WidgetTitle title={widget.title} icon={<Braces size={11} />} />
  );

  if (displayMode === "value") {
    const val = displayField ? resolvePath(data, displayField) : data;
    const display =
      typeof val === "object" ? JSON.stringify(val) : String(val ?? "—");
    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        {titleBar}
        <div className="flex flex-col items-center justify-center flex-1 gap-1 p-2">
          {label && (
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {label}
            </span>
          )}
          <span
            className="text-2xl font-bold tabular-nums"
            style={{ color: accent }}
          >
            {display}
          </span>
          {unit && (
            <span className="text-[10px] text-muted-foreground">{unit}</span>
          )}
        </div>
      </div>
    );
  }

  if (displayMode === "table") {
    const arr = resolveArray(data, jsonPath);
    if (!arr) {
      return (
        <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
          {t("homepage.customApiNotArray")}
        </div>
      );
    }
    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        {titleBar}
        <div className="flex-1 overflow-auto p-2">
          <table className="w-full text-[9px]">
            <tbody>
              {arr.slice(0, 50).map((row, i) => {
                if (typeof row !== "object" || row === null) {
                  return (
                    <tr key={i}>
                      <td className="py-0.5 pr-2 text-foreground">
                        {String(row)}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={i} className="border-b border-border/30">
                    {Object.entries(row as Record<string, unknown>)
                      .slice(0, 4)
                      .map(([k, v]) => (
                        <td key={k} className="py-0.5 pr-2">
                          <span className="text-muted-foreground">{k}: </span>
                          <span className="text-foreground">
                            {String(v ?? "")}
                          </span>
                        </td>
                      ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // json mode
  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      {titleBar}
      <div className="flex-1 overflow-auto p-2">
        <pre className="text-[9px] text-foreground whitespace-pre-wrap break-all leading-relaxed font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}

registerWidget<CustomApiConfig>({
  id: "custom_api",
  name: "Custom API",
  description: "Fetch and display data from any JSON API",
  category: "info",
  icon: <Braces size={14} />,
  defaultConfig: { url: "", refreshInterval: 60, displayMode: "value" },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 7 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: CustomApiWidget,
});

export { CustomApiWidget };
