import { describe, expect, it } from "vitest";
import { hostImportNormalizer } from "../../src/backend/host-import.js";

describe("hostImportNormalizer", () => {
  it("returns null when the row carries neither field", () => {
    expect(hostImportNormalizer({})).toBeNull();
  });

  it("normalizes and validates webUiConfig, dropping invalid endpoints", () => {
    const result = hostImportNormalizer({
      enableWebUi: true,
      webUiConfig: {
        endpoints: [
          {
            id: "e1",
            label: "Proxmox",
            scheme: "https",
            port: 8006,
            access: "direct",
            render: "embedded",
          },
          {
            id: "e2",
            label: "",
            scheme: "https",
            port: 1,
            access: "direct",
            render: "embedded",
          },
        ],
      },
    });
    expect(result?.enableWebUi).toBe(true);
    expect(result?.webUiConfig).toEqual({
      endpoints: [
        {
          id: "e1",
          label: "Proxmox",
          scheme: "https",
          port: 8006,
          path: "/",
          access: "direct",
          render: "embedded",
          ignoreCert: false,
        },
      ],
    });
  });

  it("clears webUiConfig to null when enabling with no endpoints", () => {
    const result = hostImportNormalizer({ enableWebUi: true });
    expect(result).toEqual({ enableWebUi: true, webUiConfig: null });
  });

  it("normalizes enableWebUi to a boolean", () => {
    expect(hostImportNormalizer({ enableWebUi: "yes" })).toEqual({
      enableWebUi: true,
      webUiConfig: null,
    });
  });
});
