/** Canvas positions refer to local widget ids; only sync ids can cross devices. */
export async function mapLayoutItemIds(
  layoutJson: string,
  mapId: (id: string | number) => Promise<string | number | null>,
): Promise<string> {
  const layout = JSON.parse(layoutJson);
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    throw new Error("Invalid homepage layout");
  }
  if (layout.entries === undefined) return layoutJson;
  if (!Array.isArray(layout.entries))
    throw new Error("Invalid homepage layout entries");
  const entries = [];
  for (const entry of layout.entries) {
    if (!entry || typeof entry !== "object") continue;
    const id = entry.itemId;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const itemId = await mapId(id);
    if (itemId !== null) entries.push({ ...entry, itemId });
  }
  return JSON.stringify({ ...layout, entries });
}
