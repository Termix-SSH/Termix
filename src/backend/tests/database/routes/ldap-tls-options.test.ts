import { describe, expect, it } from "vitest";
import { buildLdapTlsOptions } from "../../../database/routes/ldap-auth-routes.js";

/**
 * The LDAPS link carries the bind DN and its password. Accepting any
 * certificate meant anyone able to intercept it could present their own and
 * read those credentials, which is the whole threat LDAPS exists to stop.
 */
describe("buildLdapTlsOptions", () => {
  const readCa = () => Buffer.from("---CA---");

  it("verifies certificates when nothing is configured", () => {
    expect(buildLdapTlsOptions({}, readCa)).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("only turns verification off for the explicit opt-out", () => {
    expect(
      buildLdapTlsOptions({ LDAP_TLS_REJECT_UNAUTHORIZED: "false" }, readCa)
        .rejectUnauthorized,
    ).toBe(false);
    expect(
      buildLdapTlsOptions({ LDAP_TLS_REJECT_UNAUTHORIZED: "FALSE" }, readCa)
        .rejectUnauthorized,
    ).toBe(false);

    // Anything else keeps verification on rather than guessing.
    for (const value of ["true", "0", "no", "", "yes", "off"]) {
      expect(
        buildLdapTlsOptions({ LDAP_TLS_REJECT_UNAUTHORIZED: value }, readCa)
          .rejectUnauthorized,
        value,
      ).toBe(true);
    }
  });

  it("loads a custom CA when one is named", () => {
    const options = buildLdapTlsOptions(
      { LDAP_TLS_CA_FILE: "/etc/ssl/ldap-ca.pem" },
      readCa,
    );
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.ca?.toString()).toBe("---CA---");
  });

  it("keeps verifying when the CA file cannot be read", () => {
    const options = buildLdapTlsOptions(
      { LDAP_TLS_CA_FILE: "/missing.pem" },
      () => {
        throw new Error("ENOENT");
      },
    );
    expect(options).toEqual({ rejectUnauthorized: true });
  });
});
