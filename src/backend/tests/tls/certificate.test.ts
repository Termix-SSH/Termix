import { describe, expect, it } from "vitest";
import {
  TlsValidationError,
  readCertificateInfo,
  validateCertificatePair,
} from "../../tls/certificate.js";
import { caIssuedPair, selfSignedPair } from "./test-certs.js";

describe("validateCertificatePair", () => {
  it("accepts a matching pair and describes the leaf", async () => {
    const pair = await caIssuedPair("termix.example.com");
    const info = validateCertificatePair(pair.certificate, pair.privateKey);
    expect(info.names).toEqual(["termix.example.com"]);
    expect(info.selfSigned).toBe(false);
    expect(info.issuer).toContain("Test CA");
    expect(new Date(info.notAfter).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a key that belongs to another certificate", async () => {
    const one = await caIssuedPair();
    const other = await caIssuedPair();
    expect(() =>
      validateCertificatePair(one.certificate, other.privateKey),
    ).toThrow(/do not match/);
  });

  it("rejects garbage and an expired certificate", async () => {
    const pair = await caIssuedPair();
    expect(() => validateCertificatePair("nope", pair.privateKey)).toThrow(
      TlsValidationError,
    );
    expect(() =>
      validateCertificatePair(pair.certificate, "not a key"),
    ).toThrow(/private key/);

    const expired = await caIssuedPair("old.example", { daysLeft: -1 });
    expect(() =>
      validateCertificatePair(expired.certificate, expired.privateKey),
    ).toThrow(/expired/);
  });

  it("reads the leaf of a full chain", async () => {
    const leaf = await caIssuedPair("chain.example");
    const ca = await selfSignedPair("ca.example");
    const info = validateCertificatePair(
      leaf.certificate + ca.certificate,
      leaf.privateKey,
    );
    expect(info.names).toEqual(["chain.example"]);
  });
});

describe("readCertificateInfo", () => {
  it("marks core's own certificate as self-signed", async () => {
    const pair = await selfSignedPair("localhost");
    expect(readCertificateInfo(pair.certificate)?.selfSigned).toBe(true);
    expect(readCertificateInfo("")).toBeNull();
  });
});
