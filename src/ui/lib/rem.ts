const ROOT_PX = 14;

/**
 * A length in px at the Normal interface size, as rem, so it follows the
 * interface size setting like Tailwind classes do.
 */
export function rem(px: number): string {
  return `${px / ROOT_PX}rem`;
}

/** How many real pixels one Normal-size pixel takes right now. */
export function remScale(): number {
  const size = parseFloat(
    getComputedStyle(document.documentElement).fontSize || `${ROOT_PX}`,
  );
  return Number.isFinite(size) && size > 0 ? size / ROOT_PX : 1;
}
