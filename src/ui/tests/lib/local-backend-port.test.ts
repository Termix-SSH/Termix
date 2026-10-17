import { afterEach, describe, expect, it } from "vitest";
import { localBackendPort } from "@/lib/electron";

function setElectronAPI(api: unknown) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("localBackendPort", () => {
  it("uses the port the desktop app picked", () => {
    setElectronAPI({ backendPort: 41234 });
    expect(localBackendPort()).toBe(41234);
  });

  it("falls back to 30001", () => {
    expect(localBackendPort()).toBe(30001);
    setElectronAPI({ backendPort: Number.NaN });
    expect(localBackendPort()).toBe(30001);
    setElectronAPI({ backendPort: 70000 });
    expect(localBackendPort()).toBe(30001);
  });
});
