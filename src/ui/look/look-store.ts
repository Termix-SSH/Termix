import { useSyncExternalStore } from "react";
import {
  getLook,
  saveDefaultLook,
  saveUserLook,
  type LookResponse,
} from "@/api/look-api";
import { resolveLayoutId, safeLayoutInUrl } from "./resolve-look";

const LAST_LAYOUT_KEY = "termix-layout";

interface LookState {
  /** The server answered, or failed to; the look is decided either way. */
  loaded: boolean;
  response: LookResponse | null;
}

let state: LookState = { loaded: false, response: null };
let request: Promise<LookResponse | null> | null = null;
const listeners = new Set<() => void>();

function setState(next: LookState) {
  state = next;
  for (const listener of listeners) listener();
}

function readLastLayout(): string | null {
  try {
    return localStorage.getItem(LAST_LAYOUT_KEY);
  } catch {
    return null;
  }
}

/** Fetches the look once per session. Never rejects: no answer means defaults. */
export function loadLook(): Promise<LookResponse | null> {
  request ??= getLook()
    .then((response) => {
      setState({ loaded: true, response });
      return response;
    })
    .catch(() => {
      setState({ loaded: true, response: null });
      return null;
    });
  return request;
}

/** Fetches again, e.g. after an admin changed the defaults. */
export function reloadLook(): Promise<LookResponse | null> {
  request = null;
  return loadLook();
}

/** On logout: the next user has their own look. */
export function resetLook(): void {
  request = null;
  setState({ loaded: false, response: null });
}

export function getLookState(): LookState {
  return state;
}

export function subscribeLook(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLookState(): LookState {
  return useSyncExternalStore(subscribeLook, getLookState, getLookState);
}

/** The layout to show now. Remembered so a failed fetch next time still knows. */
export function chosenLayoutId(): string {
  const id = resolveLayoutId(state.response, readLastLayout());
  if (state.response) {
    try {
      localStorage.setItem(LAST_LAYOUT_KEY, id);
    } catch {
      // Private mode; the server is asked every time anyway.
    }
  }
  return id;
}

/** The URL or the server asks for the repair view. */
export function safeLayoutRequested(): boolean {
  return (
    (typeof window !== "undefined" &&
      safeLayoutInUrl(window.location.search)) ||
    state.response?.safeLayout === true
  );
}

function patchResponse(patch: Partial<LookResponse>) {
  if (!state.response) return;
  setState({ ...state, response: { ...state.response, ...patch } });
}

/** Tells the plugin runtime to load the chosen layout's code. */
function announceLayoutChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("termix:plugins-changed"));
  }
}

/** The user's own layout; null goes back to the default. */
export async function chooseLayout(layoutId: string | null): Promise<void> {
  await saveUserLook({ layoutId });
  patchResponse({ layoutId });
  announceLayoutChange();
}

/** The user's own theme; null goes back to the default. */
export async function chooseThemeForAccount(
  themeId: string | null,
): Promise<void> {
  await saveUserLook({ themeId });
  patchResponse({ themeId });
}

/** Admin only: what everyone sees until they choose their own. */
export async function chooseDefaultLook(defaults: {
  layout?: string | null;
  theme?: string | null;
}): Promise<void> {
  const saved = await saveDefaultLook(defaults);
  patchResponse({ defaults: saved });
  announceLayoutChange();
}
