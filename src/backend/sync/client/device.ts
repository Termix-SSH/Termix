import fs from "fs";
import os from "os";
import path from "path";

export function defaultDeviceName(): string {
  return os.hostname() || "Termix Desktop";
}

/** The desktop wide default for where connections start, from the app's settings file. */
export async function desktopConnectionOrigin(
  userData: string | undefined = process.env.ELECTRON_USER_DATA,
): Promise<"local" | "remote"> {
  if (!userData) return "local";
  try {
    const parsed = JSON.parse(
      await fs.promises.readFile(
        path.join(userData, "desktop-settings.json"),
        "utf8",
      ),
    ) as { defaultConnectionOrigin?: unknown };
    return parsed.defaultConnectionOrigin === "remote" ? "remote" : "local";
  } catch {
    return "local";
  }
}
