import { useMemo } from "react";
import {
  invokeAction,
  useSlotContributions,
  useTranslation,
} from "@termix/plugin-sdk/frontend";
import { pluginWsUrl } from "@termix/plugin-sdk/ui";

/**
 * A remote desktop stream drawn by whichever plugin provides one. Rooms and
 * share links show RDP, VNC and Telnet without knowing how they are drawn:
 * the provider contributes a component to this slot and answers the token
 * action below.
 */
export const REMOTE_DISPLAY_SLOT = "session.remoteDisplay";
export const REMOTE_SESSION_TOKEN_ACTION = "session.remoteDisplay.token";

export interface RemoteDisplayProps {
  token: string;
  protocol: string;
  isVisible: boolean;
  onConnect?: () => void;
  onError?: (error: string) => void;
}

export function RemoteDisplay(props: RemoteDisplayProps) {
  const { t } = useTranslation();
  const contributions = useSlotContributions(REMOTE_DISPLAY_SLOT);
  const provider = useMemo(
    () =>
      contributions.find(
        (contribution) =>
          contribution.kind === "component" && contribution.component,
      ),
    [contributions],
  );
  if (!provider?.component) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        {t("sessionSharing.remoteDisplayUnavailable")}
      </div>
    );
  }
  const Display = provider.component;
  return <Display {...(props as unknown as Record<string, unknown>)} />;
}

export interface RemoteSessionToken {
  token: string;
  connectionId: string;
}

/** Mints a session token for presenting a host, through the provider. */
export async function createRemoteSessionToken(
  hostId: number,
  origin: unknown,
  protocol: string,
): Promise<RemoteSessionToken | null> {
  return ((await invokeAction(
    REMOTE_SESSION_TOKEN_ACTION,
    hostId,
    origin,
    protocol,
  )) ?? null) as RemoteSessionToken | null;
}

/** A socket URL for a /plugin-ws/<id>/<path>?query path the server handed out. */
export async function wsUrlForPath(wsPath: string): Promise<string | null> {
  const [pathname, query] = wsPath.split("?", 2);
  const match = /^\/plugin-ws\/([^/]+)(\/.*)$/.exec(pathname);
  if (!match) return null;
  const target = await pluginWsUrl(match[1], match[2]);
  if (!target) return null;
  if (!query) return target.url;
  return `${target.url}${target.url.includes("?") ? "&" : "?"}${query}`;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

export function Loader({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background">
      <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
