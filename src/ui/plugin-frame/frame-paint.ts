// Before its view first renders, a frame stays see-through so the shell shows
// behind it instead of a white page. A full view also gets a spinner.
// frame.html holds the matching styles and spinner.

/** Marks a full view as loading, from the frame URL's hash. */
export function markFrameLoading(
  hash: string,
  root: HTMLElement = document.documentElement,
): void {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const full =
    // The shell draws the spinner over this frame itself.
    params.get("spin") !== "host" &&
    params.get("role") !== "background" &&
    params.get("fit") !== "content" &&
    params.get("inline") !== "1" &&
    params.get("bar") !== "1" &&
    params.get("bg") !== "none";
  if (full) root.dataset.frameLoading = "1";
}

let shownResolve: () => void = () => {};
const shown = new Promise<void>((resolve) => {
  shownResolve = resolve;
});

/** Resolves once the view first rendered. */
export function whenFrameShown(): Promise<void> {
  return shown;
}

/** The view has rendered: the page takes its own background. */
export function markFrameShown(
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.frameShown = "1";
  delete root.dataset.frameLoading;
  shownResolve();
}
