import { describe, expect, it } from "vitest";
import {
  isSecretReference,
  parseSecretReference,
} from "../../utils/onepassword-connect.js";

describe("1Password secret references", () => {
  it("parses op://vault/item/field, ignoring a query suffix", () => {
    expect(parseSecretReference("op://Infra/prod-db/password")).toEqual({
      vault: "Infra",
      item: "prod-db",
      field: "password",
    });
    expect(
      parseSecretReference("op://Infra/deploy key/private key?ssh-format=openssh"),
    ).toEqual({ vault: "Infra", item: "deploy key", field: "private key" });
    expect(parseSecretReference("op://Infra/only-two")).toBeNull();
    expect(parseSecretReference("https://x")).toBeNull();
  });

  it("recognises references without confusing them with secrets", () => {
    expect(isSecretReference("op://v/i/f")).toBe(true);
    expect(isSecretReference("  op://v/i/f")).toBe(true);
    expect(isSecretReference("hunter2")).toBe(false);
    expect(isSecretReference(undefined)).toBe(false);
  });
});
