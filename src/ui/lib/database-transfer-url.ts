import { getBasePath } from "./base-path";

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
    const serverUrl = configuredServerUrl || "http://localhost:30001";
    return `${serverUrl.replace(/\/$/, "")}/database/${operation}`;
  }

  const development =
    location.port === "5173" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  if (development) {
    return `http://localhost:30001/database/${operation}`;
  }

  return `${location.protocol}//${location.host}${getBasePath()}/database/${operation}`;
}
