import { describe, expect, it } from "vitest";
import type { Credential } from "@/types/ui-types";
import { credentialPassesFilters, sortCredentials } from "../../sidebar/credential-sort";

function cred(
  name: string,
  opts: Partial<Credential> = {},
): Credential {
  return {
    id: name,
    name,
    username: `user-${name}`,
    type: "password",
    ...opts,
  };
}

describe("sortCredentials", () => {
  it("returns the input order unchanged for the default key", () => {
    const creds = [cred("gamma"), cred("alpha"), cred("beta")];
    expect(sortCredentials(creds, "default").map((c) => c.name)).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("sorts by name ascending and descending", () => {
    const creds = [cred("gamma"), cred("alpha"), cred("beta")];
    expect(sortCredentials(creds, "name-asc").map((c) => c.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(sortCredentials(creds, "name-desc").map((c) => c.name)).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
  });

  it("sorts by username ascending and descending", () => {
    const creds = [
      cred("a", { username: "zeta" }),
      cred("b", { username: "alpha" }),
    ];
    expect(sortCredentials(creds, "username-asc").map((c) => c.username)).toEqual(
      ["alpha", "zeta"],
    );
    expect(sortCredentials(creds, "username-desc").map((c) => c.username)).toEqual(
      ["zeta", "alpha"],
    );
  });

  it("sorts manually by sortOrder, nulls last, name tie-break", () => {
    const creds = [
      cred("gamma", { sortOrder: null }),
      cred("alpha", { sortOrder: 2000 }),
      cred("beta", { sortOrder: 1000 }),
      cred("delta", { sortOrder: null }),
    ];
    expect(sortCredentials(creds, "manual").map((c) => c.name)).toEqual([
      "beta",
      "alpha",
      "delta",
      "gamma",
    ]);
  });

  it("does not mutate the input array", () => {
    const creds = [cred("gamma"), cred("alpha")];
    sortCredentials(creds, "name-asc");
    expect(creds.map((c) => c.name)).toEqual(["gamma", "alpha"]);
  });

  it("keeps pinned-first independent from the selected base sort", () => {
    const creds = [
      cred("alpha"),
      cred("zeta", { pin: true }),
      cred("beta"),
    ];
    expect(
      sortCredentials(creds, "name-asc", true).map((c) => c.name),
    ).toEqual(["zeta", "alpha", "beta"]);
  });
});

describe("credentialPassesFilters", () => {
  it("passes everything when no filters are active", () => {
    expect(credentialPassesFilters(cred("a"), { type: [], tags: [] })).toBe(
      true,
    );
  });

  it("filters by type", () => {
    expect(
      credentialPassesFilters(cred("a", { type: "key" }), {
        type: ["password"],
        tags: [],
      }),
    ).toBe(false);
    expect(
      credentialPassesFilters(cred("a", { type: "key" }), {
        type: ["key"],
        tags: [],
      }),
    ).toBe(true);
  });

  it("filters by tags (any match)", () => {
    expect(
      credentialPassesFilters(cred("a", { tags: ["prod"] }), {
        type: [],
        tags: ["staging"],
      }),
    ).toBe(false);
    expect(
      credentialPassesFilters(cred("a", { tags: ["prod", "linux"] }), {
        type: [],
        tags: ["staging", "linux"],
      }),
    ).toBe(true);
  });
});
