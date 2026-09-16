import {
  currentTunnelHost,
  resolveWebEndpointUrl,
} from "@/lib/web-endpoint-url";
import axios from "axios";
import { handleApiError, tunnelApi } from "@/main-axios";
import { isElectron } from "@/lib/electron";
import type { WebEndpoint } from "@/types/index";

/**
 * Thrown when the backend rejects a web endpoint tunnel open with a specific,
 * actionable reason -- most commonly a 502 carrying the real cause: SSH auth
 * rejected, host unreachable, or nothing listening on the target port.
 * Preserves that reason instead of letting handleApiError collapse three
 * actionable errors into "Server error occurred. Please try again later."
 */
export class WebEndpointTunnelError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "WebEndpointTunnelError";
  }
}

/**
 * Opens (or reuses) the SSH forward for a tunnel-access web endpoint and
 * returns the port it is listening on. The port is NOT stable across opens:
 * the backend closes an idle tunnel and re-binds a fresh kernel-assigned port,
 * so callers must re-resolve rather than cache it.
 */
export async function openWebEndpointTunnel(
  hostId: number,
  endpointId: string,
): Promise<number> {
  try {
    // Relative to the tunnel API base, which already includes /ssh
    // (getApiUrl("/ssh", 30003)). A path beginning "/ssh" here would resolve
    // to /ssh/ssh/... and 404 on every call.
    const response = await tunnelApi.post("/tunnel/web-endpoint/open", {
      hostId,
      endpointId,
    });
    const port = (response?.data as { port?: number } | undefined)?.port;
    if (!port) {
      throw new Error("The endpoint tunnel returned no port");
    }
    return port;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Typed unknown, not string: the guard below is only meaningful if the
      // type does not already promise what it checks.
      const data = error.response?.data as
        { error?: unknown; message?: unknown } | undefined;
      const backendMessage = data?.error ?? data?.message;
      // A body shaped { error: <object> } would otherwise render as
      // "[object Object]". Every response on this route sends a string today,
      // but a proxy or a future handler need not.
      if (typeof backendMessage === "string" && backendMessage) {
        throw new WebEndpointTunnelError(
          backendMessage,
          error.response?.status,
        );
      }
    }
    return handleApiError(error, "open web endpoint tunnel");
  }
}

/**
 * Registers one exact origin as allowed to present an invalid TLS certificate.
 * Only meaningful on the desktop, and only for direct endpoints -- a tunnel
 * endpoint's host component is loopback, which the main process already
 * exempts.
 */
export async function allowInvalidCertificateForOrigin(
  origin: string,
): Promise<void> {
  if (!isElectron()) return;
  try {
    await window.electronAPI?.invoke?.(
      "allow-invalid-certificate-for-origin",
      origin,
    );
  } catch {
    // The user's build may predate the handler; the load then simply fails the
    // certificate check as it would have before.
  }
}

/**
 * A web endpoint tunnel opens through the backend's numeric host id.
 * Quick-connect hosts (ids like "quick-connect-<n>") have no row on the
 * server, so there is nothing to open a tunnel through -- unlike a direct
 * endpoint, which never touches the backend and works regardless.
 */
export function requireNumericHostId(id: string): number {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error(
      "This endpoint needs an SSH tunnel, which requires a saved host",
    );
  }
  return numericId;
}

/** Desktop windows use a dedicated ephemeral session, including login popups. */
export async function openWebEndpointExternally(
  host: { id: string; ip: string },
  endpoint: WebEndpoint,
): Promise<void> {
  if (!isElectron() || !window.electronAPI?.invoke) {
    throw new Error(
      "Isolated windows require the desktop app. Choose Embedded in the endpoint settings.",
    );
  }
  const localPort =
    endpoint.access === "tunnel"
      ? await openWebEndpointTunnel(requireNumericHostId(host.id), endpoint.id)
      : undefined;
  const url = resolveWebEndpointUrl({
    hostAddress: host.ip,
    endpoint,
    localPort,
    tunnelHost: currentTunnelHost(true) ?? undefined,
  });
  const result = await window.electronAPI.invoke("open-isolated-web-endpoint", {
    url,
    ignoreCert: endpoint.ignoreCert === true,
  });
  if (
    !result ||
    typeof result !== "object" ||
    !("success" in result) ||
    result.success !== true
  )
    throw new Error("Failed to open isolated web endpoint");
}
