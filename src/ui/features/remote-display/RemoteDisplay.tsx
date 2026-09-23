import { useMemo } from "react";
import { useActionSlot } from "@/hooks/use-action-slot";
import { invokeAction, isActionRegistered } from "@/shell/action-registry";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";

/**
 * A remote desktop session drawn by whichever plugin provides one.
 *
 * Collab rooms and shared-session links show RDP, VNC and Telnet streams
 * without knowing how they are drawn. The provider contributes a component
 * to this slot and handles the token action below.
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
  const contributions = useActionSlot(REMOTE_DISPLAY_SLOT);
  const provider = useMemo(
    () =>
      contributions.find(
        (contribution) =>
          contribution.kind === "component" && contribution.component,
      ),
    [contributions],
  );
  if (!provider?.component) {
    return <PluginViewPlaceholder kind="tab" viewId={props.protocol} />;
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
  if (!isActionRegistered(REMOTE_SESSION_TOKEN_ACTION)) return null;
  return (await invokeAction(
    REMOTE_SESSION_TOKEN_ACTION,
    hostId,
    origin,
    protocol,
  )) as RemoteSessionToken | null;
}
