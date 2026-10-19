import os from "os";

export function defaultDeviceName(): string {
  return os.hostname() || "Termix Desktop";
}
