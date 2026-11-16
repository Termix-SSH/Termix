/**
 * A page a plugin's backend granted with ctx.desktop.grantView. The plugin
 * (or its frame) only holds the grant. On the desktop the main process opens
 * the native view from the grant alone, address and certificate rule
 * included. In a browser, or when main does not know the grant (a remote
 * server), the shell reads the address from core and draws a credentialless
 * sandboxed iframe, the same isolation plugins used before.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authApi } from "@/main-axios";
import { embeddedViewApi, overlayOpen } from "../NativeView";

export interface WebPlace {
  rect: { x: number; y: number; width: number; height: number };
  hidden: boolean;
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function measure(element: HTMLElement | null): WebPlace {
  if (!element) {
    return { rect: { x: 0, y: 0, width: 0, height: 0 }, hidden: true };
  }
  const rect = element.getBoundingClientRect();
  return {
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    hidden: element.offsetParent === null,
  };
}

export function GrantedWebView({
  pluginId,
  grant,
  hidden,
  placement,
}: {
  pluginId: string;
  grant: string;
  hidden?: boolean;
  /** Where the view may show, when the caller clips it (a frame's layer). */
  placement?: () => WebPlace | null;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<
    "native" | "iframe" | "failed" | "unisolated"
  >(() => (embeddedViewApi() ? "native" : "iframe"));
  const [url, setUrl] = useState<string | null>(null);
  const hiddenRef = useRef(!!hidden);
  hiddenRef.current = !!hidden;
  const placementRef = useRef(placement);
  placementRef.current = placement;

  useEffect(() => {
    if (mode !== "native") return;
    const api = embeddedViewApi();
    const element = host.current;
    if (!api || !element) return;
    const id = crypto.randomUUID();
    let alive = true;
    let opened = false;
    let lastBounds = "";
    let lastVisible: boolean | null = null;
    let frame = 0;

    const update = () => {
      frame = 0;
      const place = placementRef.current?.() ?? measure(element);
      const bounds = {
        x: Math.round(place.rect.x),
        y: Math.round(place.rect.y),
        width: Math.round(place.rect.width),
        height: Math.round(place.rect.height),
      };
      const visible =
        !hiddenRef.current &&
        !place.hidden &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        !overlayOpen(element);
      if (!opened) {
        opened = true;
        lastBounds = JSON.stringify(bounds);
        lastVisible = visible;
        void Promise.resolve(
          api.open({ id, grant, pluginId, bounds, visible }),
        ).then((result) => {
          // Main does not know this grant: the page came from another server.
          const ok = (result as { success?: unknown } | null)?.success === true;
          if (alive && !ok) setMode("iframe");
        });
        return;
      }
      const key = JSON.stringify(bounds);
      if (key !== lastBounds) {
        lastBounds = key;
        void api.setBounds(id, bounds);
      }
      if (visible !== lastVisible) {
        lastVisible = visible;
        void api.setVisible(id, visible);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-state"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const timer = window.setInterval(schedule, 250);
    schedule();

    return () => {
      alive = false;
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(timer);
      if (frame) cancelAnimationFrame(frame);
      void api.close(id);
    };
  }, [mode, grant, pluginId]);

  useEffect(() => {
    if (mode !== "iframe") return;
    // Without credentialless the page would get Termix's cookies.
    if (
      typeof HTMLIFrameElement === "undefined" ||
      !("credentialless" in HTMLIFrameElement.prototype)
    ) {
      setMode("unisolated");
      return;
    }
    let alive = true;
    setUrl(null);
    authApi
      .get(
        `/plugins/${encodeURIComponent(pluginId)}/web-views/${encodeURIComponent(grant)}`,
      )
      .then(({ data }) => {
        if (!alive) return;
        const next = (data as { url?: unknown } | null)?.url;
        if (isWebUrl(next)) setUrl(next);
        else setMode("failed");
      })
      .catch(() => {
        if (alive) setMode("failed");
      });
    return () => {
      alive = false;
    };
  }, [mode, grant, pluginId]);

  return (
    <div
      ref={host}
      data-granted-web-view={pluginId}
      className="flex h-full min-h-0 w-full flex-1"
    >
      {mode === "iframe" && url && (
        <iframe
          key={url}
          title={url}
          ref={(frame) => {
            if (!frame || frame.src) return;
            // Isolation is set before the first navigation, redirects included.
            (
              frame as HTMLIFrameElement & { credentialless: boolean }
            ).credentialless = true;
            frame.src = url;
          }}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          className="h-full w-full flex-1 border-0"
        />
      )}
      {(mode === "failed" || mode === "unisolated") && (
        <p className="m-auto p-4 text-sm text-muted-foreground">
          {mode === "failed"
            ? t("plugins.webView.unavailable")
            : t("plugins.webView.isolationUnavailable")}
        </p>
      )}
    </div>
  );
}
