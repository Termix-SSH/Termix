/**
 * setInterval that pauses while the document is hidden and fires once on resume.
 * Returns a cleanup function for useEffect.
 */
export function runVisibleInterval(
  tick: () => void,
  intervalMs: number,
): () => void {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (intervalId !== null || intervalMs <= 0) return;
    intervalId = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      tick();
    }, intervalMs);
  };

  const stop = () => {
    if (intervalId === null) return;
    clearInterval(intervalId);
    intervalId = null;
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      stop();
      return;
    }
    tick();
    start();
  };

  if (
    typeof document === "undefined" ||
    document.visibilityState !== "hidden"
  ) {
    start();
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return () => {
    stop();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
