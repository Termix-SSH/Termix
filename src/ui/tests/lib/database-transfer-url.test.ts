import { describe, expect, it } from "vitest";
import { getDatabaseTransferUrl } from "../../lib/database-transfer-url";

const productionLocation = {
  protocol: "https:",
  host: "termix.example.com",
  hostname: "termix.example.com",
  port: "",
};

describe("getDatabaseTransferUrl", () => {
  it("uses the embedded backend for Electron without a remote server", () => {
    expect(
      getDatabaseTransferUrl("import", {
        electron: true,
        configuredServerUrl: null,
        location: productionLocation,
      }),
    ).toBe("http://localhost:30001/database/import");
  });

  it("uses the configured Electron server without duplicate slashes", () => {
    expect(
      getDatabaseTransferUrl("export", {
        electron: true,
        configuredServerUrl: "https://termix.example.com/",
        location: productionLocation,
      }),
    ).toBe("https://termix.example.com/database/export");
  });

  it("uses the browser base path in production", () => {
    expect(
      getDatabaseTransferUrl("import", {
        electron: false,
        location: productionLocation,
      }),
    ).toBe("https://termix.example.com/database/import");
  });

  it("uses the backend development port for the Vite frontend", () => {
    expect(
      getDatabaseTransferUrl("export", {
        electron: false,
        location: {
          protocol: "http:",
          host: "localhost:5173",
          hostname: "localhost",
          port: "5173",
        },
      }),
    ).toBe("http://localhost:30001/database/export");
  });
});
