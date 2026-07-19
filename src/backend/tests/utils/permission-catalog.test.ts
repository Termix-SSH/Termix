import { describe, expect, it } from "vitest";
import {
  PERMISSION_CATALOG,
  isValidPermission,
} from "../../utils/permission-catalog.js";

describe("permission catalog", () => {
  it("accepts every cataloged permission and group wildcard", () => {
    for (const entry of PERMISSION_CATALOG) {
      expect(isValidPermission(`${entry.group}.*`)).toBe(true);
      for (const permission of entry.permissions) {
        expect(isValidPermission(permission)).toBe(true);
      }
    }
  });

  it("accepts the global wildcard", () => {
    expect(isValidPermission("*")).toBe(true);
  });

  it("rejects unknown permissions and malformed wildcards", () => {
    expect(isValidPermission("hosts.hack")).toBe(false);
    expect(isValidPermission("unknown.*")).toBe(false);
    expect(isValidPermission("")).toBe(false);
    expect(isValidPermission("hosts")).toBe(false);
  });
});
