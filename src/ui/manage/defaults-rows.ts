import type { Host } from "@/types/ui-types";
import type { HostDefaultsLevel } from "@/types/host-defaults";

export interface DefaultsRow {
  key: string;
  level: HostDefaultsLevel;
  folderName?: string;
  label: string;
}

/** The levels of host defaults a user can open: instance, their own, folders. */
export function defaultsRows(
  hosts: Host[],
  canEditInstance: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): DefaultsRow[] {
  const rows: DefaultsRow[] = [];
  if (canEditInstance)
    rows.push({
      key: "admin",
      level: "admin",
      label: t("hostDefaults.titleAdmin"),
    });
  rows.push({ key: "user", level: "user", label: t("hostDefaults.titleUser") });
  const folders = new Set<string>();
  for (const host of hosts) {
    if (!host.folder) continue;
    let path = "";
    for (const part of host.folder.split(" / ")) {
      path = path ? `${path} / ${part}` : part;
      folders.add(path);
    }
  }
  for (const folder of [...folders].sort((a, b) => a.localeCompare(b))) {
    rows.push({
      key: `folder:${folder}`,
      level: "folder",
      folderName: folder,
      label: folder,
    });
  }
  return rows;
}
