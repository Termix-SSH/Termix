import { useEffect, useState } from "react";

export interface AiAvailability {
  /** Admin kill switch. When false the feature does not exist for anyone. */
  globallyEnabled: boolean;
  /** Global switch and the user's own opt-in, which is what the rail needs. */
  userEnabled: boolean;
  /** False until the status call answers, so nothing flashes in or out. */
  loaded: boolean;
}

/** Fired when the AI status may have changed, so every surface re-reads it. */
export const AI_STATUS_CHANGED_EVENT = "aiStatusChanged";

export function notifyAiStatusChanged(): void {
  window.dispatchEvent(new Event(AI_STATUS_CHANGED_EVENT));
}

/**
 * One source of truth for whether any AI surface should render.
 *
 * The admin global is a hard kill switch: when it is off the assistant is
 * hidden everywhere for everyone, including the tab bar, command palette,
 * mobile bar, and the navigation visibility toggles, so nobody can reach or
 * even see an entry the server would refuse anyway.
 */
export function useAiAvailability(): AiAvailability {
  const [state, setState] = useState<AiAvailability>({
    globallyEnabled: false,
    userEnabled: false,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      import("@/api/ai-api")
        .then(({ getAiStatus }) => getAiStatus())
        .then((status) => {
          if (cancelled) return;
          setState({
            globallyEnabled: status.globallyEnabled,
            userEnabled: status.globallyEnabled && status.enabled,
            loaded: true,
          });
        })
        .catch(() => {
          if (!cancelled)
            setState({
              globallyEnabled: false,
              userEnabled: false,
              loaded: true,
            });
        });
    };
    refresh();
    window.addEventListener(AI_STATUS_CHANGED_EVENT, refresh);
    // The profile toggle and onboarding still fire this older event.
    window.addEventListener("hiddenRailTabsChanged", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(AI_STATUS_CHANGED_EVENT, refresh);
      window.removeEventListener("hiddenRailTabsChanged", refresh);
    };
  }, []);

  return state;
}
