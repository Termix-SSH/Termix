import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { roleLabel } from "@/lib/role-label";

const t = ((key: string) => `T(${key})`) as unknown as TFunction;

describe("roleLabel", () => {
  it("translates system role keys", () => {
    expect(roleLabel(t, "rbac.roles.admin")).toBe("T(rbac.roles.admin)");
  });

  it("keeps custom names and empty values", () => {
    expect(roleLabel(t, "Ops team")).toBe("Ops team");
    expect(roleLabel(t, null)).toBeNull();
    expect(roleLabel(t, undefined)).toBeUndefined();
  });
});
