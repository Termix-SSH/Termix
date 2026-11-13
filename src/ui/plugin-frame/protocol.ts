/**
 * Messages between the shell and a sandboxed plugin frame.
 *
 * Every frame has an opaque origin, so the origin of a message says nothing.
 * The shell tells frames apart by the window that sent the message, and the
 * frame only listens to its parent. Both sides check the shape of every
 * message before they act on it.
 */

export const FRAME_CHANNEL = "termix-frame";
export const FRAME_PROTOCOL_VERSION = 1;

export type FrameRole = "background" | "view";

/** A function on the other side, called with a "call" message. */
export interface WireFn {
  $fn: string;
}

/** A Lucide icon, by its component name. */
export interface WireIcon {
  $icon: string;
}

/** A plugin component the shell shows in a frame of its own. */
export interface WireComponent {
  $component: string;
}

export interface FrameHello {
  ch: typeof FRAME_CHANNEL;
  t: "hello";
  role: FrameRole;
  /** The view to render, for a view frame. */
  key?: string;
}

/** Frame asks the shell to do something, or calls a shell function. */
export interface FrameCall {
  ch: typeof FRAME_CHANNEL;
  t: "call";
  id: number;
  method: string;
  args: unknown[];
}

export interface FrameReply {
  ch: typeof FRAME_CHANNEL;
  t: "reply";
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** One-way notice, no reply. */
export interface FrameEvent {
  ch: typeof FRAME_CHANNEL;
  t: "event";
  name: string;
  data?: unknown;
}

export type FrameMessage = FrameHello | FrameCall | FrameReply | FrameEvent;

export function isFrameMessage(value: unknown): value is FrameMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.ch !== FRAME_CHANNEL) return false;
  switch (message.t) {
    case "hello":
      return (
        (message.role === "background" || message.role === "view") &&
        (message.key === undefined ||
          (typeof message.key === "string" && message.key.length < 300))
      );
    case "call":
      return (
        Number.isSafeInteger(message.id) &&
        typeof message.method === "string" &&
        message.method.length < 100 &&
        Array.isArray(message.args)
      );
    case "reply":
      return (
        Number.isSafeInteger(message.id) &&
        typeof message.ok === "boolean" &&
        (message.error === undefined || typeof message.error === "string")
      );
    case "event":
      return typeof message.name === "string" && message.name.length < 100;
    default:
      return false;
  }
}

export function isWireFn(value: unknown): value is WireFn {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as WireFn).$fn === "string" &&
    Object.keys(value).length === 1
  );
}

export function isWireIcon(value: unknown): value is WireIcon {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as WireIcon).$icon === "string" &&
    /^[A-Z][A-Za-z0-9]{0,63}$/.test((value as WireIcon).$icon)
  );
}

export function isWireComponent(value: unknown): value is WireComponent {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as WireComponent).$component === "string" &&
    (value as WireComponent).$component.length < 300
  );
}

/** What the shell sends a frame once it said hello. */
export interface FrameInit {
  pluginId: string;
  role: FrameRole;
  key?: string;
  /** Server root as the frame reaches it, like https://host/base. */
  baseUrl: string;
  /** Asset version, for the bundle URL. */
  assetVersion: string | null;
  css: boolean;
  manifest: Record<string, unknown>;
  token: { value: string; expiresAt: number };
  language: string;
  /** Locale files the plugin ships, "en" plus xx_YY names. */
  locales: string[];
  /** Every installed plugin id, for permission names. */
  pluginIds: string[];
  state: FrameState;
  storage: Record<string, string>;
  guest: boolean;
  /** A view's first props, so it never draws without them. */
  props?: Record<string, unknown>;
}

/** Everything a frame's hooks read synchronously, pushed by the shell. */
export interface FrameState {
  theme: FrameTheme;
  hosts: Record<string, unknown>[];
  hostsLoaded: boolean;
  user: { userId: string; username: string; isAdmin: boolean } | null;
  permissions: string[];
  permissionsLoaded: boolean;
  hostStatus: Record<string, unknown>;
  statusColorScheme: "accent" | "status";
  tabs: Record<string, unknown>[];
  tabsReady: boolean;
  layout: Record<string, unknown> | null;
  uiPreferences: Record<string, unknown>;
  sshAuthTypes: { loaded: boolean; types: Record<string, unknown>[] };
  activityTypes: string[];
  activityTargets: Record<
    string,
    { icon?: WireIcon; tab: string; titleKey?: string }
  >;
  companions: Record<string, unknown>[];
  hostActions: Record<string, unknown>[];
  desktop: { available: boolean; remoteServerUrl: string | null };
  isMobile: boolean;
}

export interface FrameTheme {
  /** documentElement className of the shell. */
  className: string;
  /** documentElement inline style of the shell. */
  style: string;
  mode: "light" | "dark";
  themeId: string;
  /** Theme stylesheets the shell has, as text. */
  css: string[];
}
