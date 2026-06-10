const MIN_DISPLAY_DIMENSION = 1;

/**
 * Size for Guacamole sendSize — uses the container's own box, capped only when
 * it extends past the visible viewport bottom (no tab-bar double subtraction).
 */
export function getGuacamoleDisplaySize(container: HTMLElement): {
  width: number;
  height: number;
} {
  const width = Math.round(container.clientWidth);
  let height = Math.round(container.clientHeight);

  const rect = container.getBoundingClientRect();
  const vv = window.visualViewport;
  const viewportBottom =
    (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight);
  const maxHeight = Math.round(Math.max(0, viewportBottom - rect.top));
  if (maxHeight > 0 && height > maxHeight) {
    height = maxHeight;
  }

  const mobileBar = document.querySelector<HTMLElement>(
    "[data-termix-mobile-bottom-bar]",
  );
  const mobileBarRect = mobileBar?.getBoundingClientRect();
  if (mobileBarRect && mobileBarRect.height > 0) {
    const mobileMaxHeight = Math.round(
      Math.max(0, mobileBarRect.top - rect.top),
    );
    if (mobileMaxHeight > 0 && height > mobileMaxHeight) {
      height = mobileMaxHeight;
    }
  }

  return {
    width: Math.max(width, MIN_DISPLAY_DIMENSION),
    height: Math.max(height, MIN_DISPLAY_DIMENSION),
  };
}

const MIN_CONTAINER_DIMENSION = 100;
const MAX_MEASURE_FRAMES = 60;

export async function waitForGuacamoleDisplaySize(
  container: HTMLDivElement | null | undefined,
): Promise<{ width: number; height: number }> {
  for (let i = 0; i < MAX_MEASURE_FRAMES; i++) {
    if (container) {
      const size = getGuacamoleDisplaySize(container);
      if (
        size.width >= MIN_CONTAINER_DIMENSION &&
        size.height >= MIN_CONTAINER_DIMENSION
      ) {
        return size;
      }
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }

  if (container) {
    return getGuacamoleDisplaySize(container);
  }

  const tabBar = document.querySelector<HTMLElement>("[data-termix-tab-bar]");
  const tabBarRect = tabBar?.getBoundingClientRect();
  const vv = window.visualViewport;
  const viewportBottom =
    (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight);
  const top =
    tabBarRect && tabBarRect.height > 0 ? tabBarRect.bottom : (vv?.offsetTop ?? 0);

  return {
    width: Math.max(
      MIN_CONTAINER_DIMENSION,
      Math.round(vv?.width ?? window.innerWidth),
    ),
    height: Math.max(
      MIN_CONTAINER_DIMENSION,
      Math.round(Math.max(0, viewportBottom - top)),
    ),
  };
}
