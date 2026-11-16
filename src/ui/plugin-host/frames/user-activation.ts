/**
 * True while the shell window has transient user activation. A click or key
 * in a plugin frame also activates the shell (activation reaches every
 * ancestor window), and a frame cannot fake it, unlike the pointer and key
 * events it reports itself. Browsers without the API count as active, so
 * the browser's own checks still decide there.
 */
export function hasUserActivation(): boolean {
  if (typeof navigator === "undefined") return false;
  const activation = (
    navigator as Navigator & { userActivation?: { isActive: boolean } }
  ).userActivation;
  return activation ? activation.isActive : true;
}
