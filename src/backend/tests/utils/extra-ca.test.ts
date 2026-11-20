import { describe, expect, it, vi } from "vitest";
import {
  extraCaCertificates,
  trustExtraCertificates,
} from "../../utils/extra-ca.js";

const ROOT = "-----BEGIN CERTIFICATE-----\nMIIBroot\n-----END CERTIFICATE-----";
const INTERMEDIATE =
  "-----BEGIN CERTIFICATE-----\nMIIBinter\n-----END CERTIFICATE-----";

describe("extraCaCertificates", () => {
  it("reads every certificate in the file NODE_EXTRA_CA_CERTS names (#1895)", () => {
    const read = vi.fn(() => `junk\n${ROOT}\n\n${INTERMEDIATE}\n`);

    const certs = extraCaCertificates(
      { NODE_EXTRA_CA_CERTS: "/certs/root.crt" },
      read,
    );

    expect(read).toHaveBeenCalledWith("/certs/root.crt");
    expect(certs).toEqual([ROOT, INTERMEDIATE]);
  });

  it("returns nothing when the variable is unset or the file can't be read", () => {
    expect(extraCaCertificates({}, () => ROOT)).toEqual([]);
    expect(
      extraCaCertificates({ NODE_EXTRA_CA_CERTS: "/missing" }, () => {
        throw new Error("ENOENT");
      }),
    ).toEqual([]);
  });
});

describe("trustExtraCertificates", () => {
  it("adds the certificates to the default ones once", () => {
    const set = vi.fn();
    const api = {
      getCACertificates: () => ["bundled", ROOT],
      setDefaultCACertificates: set,
    } as never;

    expect(trustExtraCertificates([ROOT, INTERMEDIATE], api)).toBe(true);
    expect(set).toHaveBeenCalledWith(["bundled", ROOT, INTERMEDIATE]);
  });

  it("does nothing without certificates or on a Node without the API", () => {
    const set = vi.fn();
    const api = {
      getCACertificates: () => [],
      setDefaultCACertificates: set,
    } as never;

    expect(trustExtraCertificates([], api)).toBe(false);
    expect(trustExtraCertificates([ROOT], {} as never)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
