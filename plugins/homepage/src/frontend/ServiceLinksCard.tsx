import { useEffect, useState } from "react";
import { ExternalLink, Link, Trash2 } from "lucide-react";
import {
  usePluginApi,
  useTranslation,
  type DashboardCardProps,
} from "@termix/plugin-sdk/frontend";
import { Button, Card } from "@termix/plugin-sdk/ui";
import type { ServiceLinkRecord } from "./types.js";
import { isValidServiceLinkUrl, normalizeServiceLinkUrl } from "./url.js";

export function ServiceLinksCard({ isVisible }: DashboardCardProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const [links, setLinks] = useState<ServiceLinkRecord[]>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState(false);
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    api
      .get<ServiceLinkRecord[]>("/service-links")
      .then((res) => setLinks(res.data))
      .catch(() => {});
  }, [isVisible]);

  const handleAdd = async () => {
    const normalizedUrl = normalizeServiceLinkUrl(url);
    if (!isValidServiceLinkUrl(normalizedUrl)) {
      setUrlError(true);
      setAddError("");
      return;
    }
    setUrlError(false);
    setAddError("");
    setAdding(true);
    try {
      const res = await api.post<ServiceLinkRecord>("/service-links", {
        label: label.trim(),
        url: normalizedUrl,
      });
      setLinks((prev) => [...prev, res.data]);
      setLabel("");
      setUrl("");
    } catch (error) {
      setAddError(
        error instanceof Error
          ? error.message
          : t("dashboardTab.serviceLinksAddFailed"),
      );
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: number) => {
    await api.delete(`/service-links/${id}`);
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };

  return (
    <Card className="flex flex-col overflow-hidden w-full h-full py-0 gap-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Link className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboardTab.serviceLinksTitle")}
        </span>
      </div>
      <div className="flex flex-col overflow-auto flex-1">
        {links.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/40 py-4">
            {t("dashboardTab.serviceLinksEmpty")}
          </div>
        )}
        {links.map((link) => (
          <div
            key={link.id}
            className="flex items-center justify-between px-4 py-2 border-b border-border last:border-0 group/link"
          >
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-2 min-w-0 flex-1 hover:text-accent-brand transition-colors"
            >
              <ExternalLink className="size-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold truncate">
                {link.label}
              </span>
              <span className="text-[10px] text-muted-foreground truncate">
                {link.url}
              </span>
            </a>
            <button
              onClick={() => handleDelete(link.id)}
              className="ml-2 opacity-0 group-hover/link:opacity-100 transition-opacity size-5 flex items-center justify-center hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-4 py-2 border-t border-border shrink-0">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("dashboardTab.serviceLinksLabelPlaceholder")}
          className="flex-1 min-w-0 text-xs bg-transparent border border-border px-2 py-1 focus:outline-none focus:border-accent-brand/60"
        />
        <input
          type="text"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlError(false);
            setAddError("");
          }}
          placeholder={t("dashboardTab.serviceLinksUrlPlaceholder")}
          className={`flex-[2] min-w-0 text-xs bg-transparent border px-2 py-1 focus:outline-none ${urlError ? "border-destructive" : "border-border focus:border-accent-brand/60"}`}
        />
        <Button
          size="sm"
          className="text-xs bg-accent-brand hover:bg-accent-brand/90 text-white h-6 px-2 shrink-0"
          onClick={handleAdd}
          disabled={!label.trim() || !url.trim() || adding}
        >
          {t("dashboardTab.serviceLinksAdd")}
        </Button>
      </div>
      {urlError && (
        <div className="px-4 pb-2 text-[10px] text-destructive shrink-0">
          {t("dashboardTab.serviceLinksInvalidUrl")}
        </div>
      )}
      {addError && (
        <div className="px-4 pb-2 text-[10px] text-destructive shrink-0">
          {addError}
        </div>
      )}
    </Card>
  );
}
