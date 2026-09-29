// Booleans have three states in the defaults UI: unset means the host decides.
export type TriState = "inherit" | "on" | "off";

export function toTriState(value?: boolean): TriState {
  if (value === undefined) return "inherit";
  return value ? "on" : "off";
}

export function fromTriState(value: TriState): boolean | undefined {
  if (value === "inherit") return undefined;
  return value === "on";
}
