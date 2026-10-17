import { getBasePath } from "./base-path";
import { localBackendPort } from "./electron";

type BrowserLocation = Pick<
  Location,
  "protocol" | "host" | "hostname" | "port"
>;

interface DatabaseTransferUrlOptions {
  electron: boolean;
  configuredServerUrl?: string | null;
  location: BrowserLocation;
}

export function getDatabaseTransferUrl(
  operation: "export" | "import",
  { electron, configuredServerUrl, location }: DatabaseTransferUrlOptions,
): string {
  if (electron) {
    const serverUrl =
      configuredServerUrl || `http://localhost:${localBackendPort()}`;
    return `${serverUrl.replace(/\/$/, "")}/database/${operation}`;
  }

  // Vite moves off 5173 when another dev server holds it.
  const development =
    process.env.NODE_ENV === "development" || location.port === "5173";

  if (development) {
    return `http://localhost:30001/database/${operation}`;
  }

  return `${location.protocol}//${location.host}${getBasePath()}/database/${operation}`;
}
