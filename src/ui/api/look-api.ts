import { authApi } from "@/main-axios";

/** A layout or theme plugin the server found but could not load. */
export interface UnavailableLook {
  id: string;
  version: string | null;
  layouts: string[];
  themes: string[];
  error: string;
}

/** Everything the browser picks the layout and theme from. */
export interface LookResponse {
  layoutId: string | null;
  themeId: string | null;
  /** Admin defaults. */
  defaults: { layout: string | null; theme: string | null };
  /** The default-look plugin's layout and theme. */
  defaultLook: { layout: string | null; theme: string | null };
  /** TERMIX_SAFE_LAYOUT is set on the server. */
  safeLayout: boolean;
  unavailable: UnavailableLook[];
}

export async function getLook(): Promise<LookResponse> {
  const response = await authApi.get("/user-preferences/look");
  return response.data;
}

/** The user's own layout and theme; null follows the default. */
export async function saveUserLook(look: {
  layoutId?: string | null;
  themeId?: string | null;
}): Promise<void> {
  await authApi.put("/user-preferences", look);
}

/** Admin only. Null clears a default. */
export async function saveDefaultLook(defaults: {
  layout?: string | null;
  theme?: string | null;
}): Promise<{ layout: string | null; theme: string | null }> {
  const response = await authApi.put(
    "/user-preferences/look/defaults",
    defaults,
  );
  return response.data;
}
