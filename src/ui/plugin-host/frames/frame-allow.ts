/**
 * Lets a frame copy to the clipboard. Firefox has no such policy (it allows
 * a copy after a click anyway) and warns once per frame when it sees it.
 */
export const FRAME_ALLOW =
  typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)
    ? undefined
    : "clipboard-write";
