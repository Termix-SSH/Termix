/**
 * The class names a stylesheet has rules for, unescaped, so `.md\:w-44`
 * reads as the candidate `md:w-44` a plugin writes.
 */
export function classNamesInCss(css) {
  const names = new Set();
  // Declarations hold numbers like 0.25rem, so only selectors are read.
  const selectors = css.replace(/\{[^{}]*\}/g, "{}");
  for (const match of selectors.matchAll(
    /\.((?:\\[0-9a-fA-F]{1,6} ?|\\.|[\w-])+)/g,
  )) {
    names.add(
      match[1].replace(/\\([0-9a-fA-F]{1,6}) ?|\\(.)/g, (_all, hex, char) =>
        hex ? String.fromCodePoint(parseInt(hex, 16)) : char,
      ),
    );
  }
  return names;
}

/**
 * Splits a plugin's candidates by whether core's own CSS already has them.
 * A class core ships keeps the plugin's copy below core's utilities, so it can
 * never reorder core's rules. Any other class has no rule in core to fight,
 * so it goes in core's utilities layer and overrides the way it would in one
 * Tailwind build.
 */
export function splitByCoreClasses(candidates, coreClasses) {
  const shared = [];
  const own = [];
  for (const candidate of candidates) {
    (coreClasses.has(candidate) ? shared : own).push(candidate);
  }
  return { shared, own };
}
