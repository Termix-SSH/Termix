/**
 * Lines only between cells, so the actions read as quarters: one column on
 * small screens, two above. An odd last cell spans the full row.
 */
export function quarterBorders(index: number, count: number): string {
  const classes = ["border-border"];
  const last = index === count - 1;
  if (!last) classes.push("border-b");
  if (Math.floor(index / 2) === Math.floor((count - 1) / 2)) {
    classes.push("sm:border-b-0");
  }
  if (index % 2 === 0 && !last) classes.push("sm:border-r");
  if (last && count % 2 === 1) classes.push("sm:col-span-2");
  return classes.join(" ");
}
