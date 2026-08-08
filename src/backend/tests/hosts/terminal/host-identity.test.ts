import { describe, expect, it } from "vitest";
import {
  hostAddressMismatch,
  HOST_ADDRESS_MISMATCH_MESSAGE,
  HostAddressMismatchError,
  normalizeHostAddress,
} from "../../../hosts/terminal/host-identity.js";

/**
 * The desktop app lists hosts out of its own embedded database and identifies
 * them to the backend by numeric row id. With the connection origin set to
 * "Remote server" that id is resolved against the sync server's `ssh_data`
 * instead, whose autoincrement ids drift apart from the client's as soon as
 * the two sides accumulate inserts and deletes in a different order.
 *
 * The resolved row supplies the address, the credentials, the jump hosts and
 * the stored host key, so the session opened on whichever machine owned that
 * id on the server — the host list stayed correct the whole time, and nothing
 * announced the substitution.
 */
describe("hostAddressMismatch", () => {
  it("refuses an id that resolves to a different machine", () => {
    expect(hostAddressMismatch("10.0.0.7", "10.0.0.9")).toBe(true);
    expect(hostAddressMismatch("aeza.example.com", "rpi.example.com")).toBe(
      true,
    );
  });

  it("allows the ordinary case where both sides agree", () => {
    expect(hostAddressMismatch("10.0.0.7", "10.0.0.7")).toBe(false);
  });

  it("does not trip over how an address is written", () => {
    // The client strips brackets off IPv6 literals before connecting; the
    // stored row keeps them. Same machine either way.
    expect(hostAddressMismatch("2001:db8::1", "[2001:db8::1]")).toBe(false);
    expect(hostAddressMismatch("Host.Example.COM", "host.example.com")).toBe(
      false,
    );
    expect(hostAddressMismatch("10.0.0.7", " 10.0.0.7 ")).toBe(false);
  });

  it("stays out of the way when the server has no address to compare", () => {
    // Nothing stored server-side: the caller falls back to what the client
    // supplied, as it always has. Refusing here would break every setup that
    // passes host details inline.
    expect(hostAddressMismatch("10.0.0.7", undefined)).toBe(false);
    expect(hostAddressMismatch("10.0.0.7", null)).toBe(false);
    expect(hostAddressMismatch("10.0.0.7", "")).toBe(false);
    expect(hostAddressMismatch("10.0.0.7", "   ")).toBe(false);
  });

  it("refuses when the client sent nothing but the server resolved a host", () => {
    // An id alone must not be enough to pick a machine.
    expect(hostAddressMismatch(undefined, "10.0.0.9")).toBe(true);
    expect(hostAddressMismatch("", "10.0.0.9")).toBe(true);
  });
});

describe("HostAddressMismatchError", () => {
  it("survives the catch blocks that swallow resolution failures", () => {
    // SFTP host resolution sits inside "failed to resolve credentials, carry
    // on" handlers. Continuing is precisely what must not happen here, so
    // those catches rethrow this type -- which only works if it is
    // recognisable with instanceof after being thrown.
    const rethrow = () => {
      try {
        throw new HostAddressMismatchError();
      } catch (error) {
        if (error instanceof HostAddressMismatchError) throw error;
        return "swallowed";
      }
    };

    expect(rethrow).toThrow(HostAddressMismatchError);
    expect(rethrow).toThrow(HOST_ADDRESS_MISMATCH_MESSAGE);
  });

  it("tells the user which of their settings to change", () => {
    // The message is the only actionable thing they get; the workaround has
    // to be in it.
    expect(HOST_ADDRESS_MISMATCH_MESSAGE).toContain("This device");
    expect(HOST_ADDRESS_MISMATCH_MESSAGE).toContain("full sync");
  });
});

describe("normalizeHostAddress", () => {
  it("keeps only what identifies the host", () => {
    expect(normalizeHostAddress("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeHostAddress("  Example.COM ")).toBe("example.com");
  });

  it("treats anything that is not a string as no address", () => {
    expect(normalizeHostAddress(undefined)).toBe("");
    expect(normalizeHostAddress(null)).toBe("");
    expect(normalizeHostAddress(42)).toBe("");
  });
});
