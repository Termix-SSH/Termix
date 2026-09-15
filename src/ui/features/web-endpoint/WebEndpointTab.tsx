import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe, RotateCw } from "lucide-react";
import { toast } from "sonner";
import {
  currentTunnelHost,
  resolveWebEndpointUrl,
  unreachableTunnelReason,
  type TunnelRefusalReason,
} from "@/lib/web-endpoint-url";
import {
  allowInvalidCertificateForOrigin,
  openWebEndpointTunnel,
  requireNumericHostId,
} from "@/api/web-endpoint-api";
import { copyToClipboard } from "@/lib/clipboard";
import { isElectron } from "@/lib/electron";
import { Button } from "@/components/button";
import type { Host } from "@/types/ui-types";

const TUNNEL_REFUSAL_MESSAGES: Record<TunnelRefusalReason, string> = {
  "loopback-bind-on-remote-backend": "webEndpoint.tunnelUnreachableFromBrowser",
  "shares-session-cookie-with-termix": "webEndpoint.tunnelSharesSessionCookie",
};

/**
 * Renders one web endpoint in an iframe.
 *
 * Takes the whole host plus the endpoint's ID -- not the endpoint object --
 * so a tab whose endpoint was deleted while it was open (or that never matched
 * one, if the host's webUiConfig raced the tab's mount) can be detected here
 * and shown a plain "no longer exists" message instead of throwing on
 * endpoint.scheme.
 */
export function WebEndpointTab({
  host,
  endpointId,
}: {
  host: Host;
  endpointId?: string;
}) {
  const { t } = useTranslation();
  const endpoint = (host.webUiConfig?.endpoints ?? []).find(
    (candidate) => candidate.id === endpointId,
  );

  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Bumped on every resolution that lands, and folded into the iframe's key
   * alongside the URL. A direct endpoint's URL never changes, and a live
   * tunnel returns the SAME port on every open -- so the URL alone is not
   * enough to key on: React bails out of a same-value setState, the key would
   * not change, and Reload would silently do nothing in the two most common
   * cases.
   */
  const [generation, setGeneration] = useState(0);
  /**
   * Guards two in-flight resolutions completing out of order -- a
   * double-clicked Reload, or a manual reload racing the mount effect. Only
   * the most recently started resolution may apply its result.
   */
  const resolveGenerationRef = useRef(0);

  const resolve = useCallback(async () => {
    if (!endpoint) return;
    const mine = ++resolveGenerationRef.current;
    setError(null);
    try {
      // Checked BEFORE the open call, not after. Two reasons a tunnel must not
      // be opened from a browser: a loopback bind on a remote backend succeeds
      // server-side and leaves the browser nothing to connect to, and a tunnel
      // URL on the page's own host string would hand the tunnelled service
      // Termix's session cookie. The second is a security refusal, so binding
      // the port and then declining to navigate would be no protection.
      const refusal = unreachableTunnelReason(endpoint, isElectron());
      if (refusal) {
        throw new Error(t(TUNNEL_REFUSAL_MESSAGES[refusal]));
      }

      // Always re-resolved rather than reloading the frame: the backend closes
      // an idle tunnel after ten minutes and re-binds a fresh kernel-assigned
      // port, so a cached port may be gone.
      const localPort =
        endpoint.access === "tunnel"
          ? await openWebEndpointTunnel(
              requireNumericHostId(host.id),
              endpoint.id,
            )
          : undefined;

      const resolved = resolveWebEndpointUrl({
        hostAddress: host.ip,
        endpoint,
        localPort,
        // Non-null for a tunnel by the time we get here: a null separated host
        // is exactly what the refusal above catches.
        tunnelHost: currentTunnelHost(isElectron()) ?? undefined,
      });

      if (endpoint.access === "direct" && endpoint.ignoreCert) {
        await allowInvalidCertificateForOrigin(new URL(resolved).origin);
      }

      if (mine !== resolveGenerationRef.current) return;
      setUrl(resolved);
      setGeneration((g) => g + 1);
    } catch (caught) {
      if (mine !== resolveGenerationRef.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    // Depends on the endpoint's FIELDS, not the object: host.webUiConfig is
    // re-derived on every render of the host list, so a dependency on
    // `endpoint` itself would reopen the tunnel on every parent render.
    // bindHost and localPort are included because the refusal guard reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    host.id,
    host.ip,
    endpoint?.id,
    endpoint?.access,
    endpoint?.scheme,
    endpoint?.port,
    endpoint?.path,
    endpoint?.ignoreCert,
    endpoint?.bindHost,
    endpoint?.localPort,
  ]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  if (!endpoint) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
        <Globe className="size-5 opacity-60" />
        <p>{t("webEndpoint.notFound")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-xs">
        <Globe className="size-5 opacity-60" />
        <p className="text-center">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void resolve()}>
          {t("webEndpoint.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void resolve()}
          title={t("webEndpoint.reload")}
        >
          <RotateCw />
        </Button>
        <span className="truncate text-muted-foreground">{url ?? ""}</span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() => {
            if (!url) return;
            void copyToClipboard(url).then((ok) => {
              if (ok) toast.success(t("webEndpoint.urlCopied"));
              else toast.error(t("webEndpoint.copyFailed"));
            });
          }}
        >
          {t("webEndpoint.copyUrl")}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() =>
            url && window.open(url, "_blank", "noopener,noreferrer")
          }
        >
          <ExternalLink data-icon="inline-start" />
          {t("webEndpoint.openExternally")}
        </Button>
      </div>
      {url && (
        // Keyed on generation as well as url: a re-resolved tunnel usually
        // returns the SAME port, so url alone would not change and React would
        // never remount the frame.
        <iframe
          key={`${generation}:${url}`}
          title={endpoint.label}
          src={url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="h-full w-full flex-1 border-0"
        />
      )}
    </div>
  );
}
