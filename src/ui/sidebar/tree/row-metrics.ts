import type { Host } from "@/types/ui-types";

/** The CPU/RAM bar row, including its pt-[5.25px]. */
export const RESOURCE_ROW_EXTRA = 17.25;

/**
 * Whether a host row will actually render the resource bars.
 *
 * Mirrors HostItem's own condition. The virtualizer used to reserve their
 * height for every row in "always" mode, which left a gap under each offline
 * host -- most obvious down a long list where nothing breaks up the rows.
 */
export function rendersResourceRow(
  host: Pick<Host, "online" | "cpu" | "ram">,
  showResourceBars: boolean,
  isCompactDensity: boolean,
): boolean {
  if (!showResourceBars || isCompactDensity) return false;
  if (!host.online) return false;
  return (host.cpu ?? 0) > 0 || (host.ram ?? 0) > 0;
}
