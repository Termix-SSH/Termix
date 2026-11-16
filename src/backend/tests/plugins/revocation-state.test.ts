import { afterEach, describe, expect, it } from "vitest";
import {
  REVOKED_PREFIX,
  clearRevocationLists,
  revocationReason,
  revokedKeyIds,
  setRevocationList,
} from "../../plugins/revocation-state.js";
import type { RevocationBody } from "../../plugins/trust-chain.js";

function list(
  tier: "official" | "community",
  overrides: Partial<RevocationBody> = {},
): RevocationBody {
  return {
    type: "termix-revocations",
    tier,
    version: 1,
    issued: "",
    keys: [],
    plugins: [],
    versions: [],
    ...overrides,
  };
}

const plugin = { id: "docker", version: "1.2.0", signedTier: "official" };

afterEach(() => clearRevocationLists());

describe("revocationReason", () => {
  it("is null with no lists", () => {
    expect(revocationReason(plugin)).toBeNull();
  });

  it("names a revoked plugin, version, signing key or root", () => {
    setRevocationList(
      "official",
      list("official", { plugins: [{ id: "docker", reason: "bad build" }] }),
    );
    expect(revocationReason(plugin)).toBe(
      `${REVOKED_PREFIX}: this plugin was revoked: bad build`,
    );

    setRevocationList(
      "official",
      list("official", { versions: [{ id: "docker", version: "1.2.0" }] }),
    );
    expect(revocationReason(plugin)).toBe(
      `${REVOKED_PREFIX}: version 1.2.0 was revoked`,
    );
    expect(revocationReason({ ...plugin, version: "1.2.1" })).toBeNull();

    setRevocationList(
      "official",
      list("official", { keys: [{ keyId: "k1" }] }),
    );
    expect(revocationReason({ ...plugin, signedBy: "k1" })).toMatch(
      /signing key/,
    );
    expect(revocationReason({ ...plugin, signedRoot: "k1" })).toMatch(
      /signing key/,
    );
    expect(revocationReason({ ...plugin, signedBy: "k2" })).toBeNull();
  });

  it("applies the official list to every plugin, signed or not", () => {
    setRevocationList(
      "official",
      list("official", { plugins: [{ id: "docker" }] }),
    );
    expect(revocationReason({ id: "docker", version: "1.0.0" })).not.toBeNull();
    expect(
      revocationReason({ ...plugin, signedTier: "community" }),
    ).not.toBeNull();
  });

  it("keeps the community list off plugins it did not sign", () => {
    setRevocationList(
      "community",
      list("community", { plugins: [{ id: "docker" }] }),
    );
    expect(revocationReason(plugin)).toBeNull();
    expect(revocationReason({ id: "docker", version: "1.0.0" })).toBeNull();
    expect(
      revocationReason({ ...plugin, signedTier: "community" }),
    ).not.toBeNull();
  });

  it("keeps a long or multi line reason short and on one line", () => {
    setRevocationList(
      "official",
      list("official", {
        plugins: [{ id: "docker", reason: `a\n${"b".repeat(500)}` }],
      }),
    );
    const reason = revocationReason(plugin)!;
    expect(reason).not.toContain("\n");
    expect(reason.length).toBeLessThan(260);
  });
});

describe("revokedKeyIds", () => {
  it("never lets the community list reach official keys", () => {
    setRevocationList("official", list("official", { keys: [{ keyId: "o" }] }));
    setRevocationList(
      "community",
      list("community", { keys: [{ keyId: "c" }] }),
    );
    expect([...revokedKeyIds("official")]).toEqual(["o"]);
    expect([...revokedKeyIds("community")].sort()).toEqual(["c", "o"]);
  });
});
