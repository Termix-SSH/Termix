import { describe, expect, it } from "vitest";
import { sanitizeProtocolAuthForRecipient } from "../../../hosts/protocol-auth/summary.js";

const summaries = {
  spice: {
    authType: "credential",
    credentialId: 4,
    username: null,
    fields: { display: "2" },
    hasPassword: true,
    secretFieldKeys: ["ticket"],
  },
};

describe("sanitizeProtocolAuthForRecipient", () => {
  it("keeps only the auth type at connect level", () => {
    expect(sanitizeProtocolAuthForRecipient(summaries, "connect")).toEqual({
      spice: { authType: "credential" },
    });
  });

  it("never says whether secrets are set, at any level", () => {
    for (const level of ["view", "edit", "manage"]) {
      expect(sanitizeProtocolAuthForRecipient(summaries, level)).toEqual({
        spice: {
          authType: "credential",
          credentialId: 4,
          username: null,
          fields: { display: "2" },
        },
      });
    }
  });

  it("answers an empty map for anything else", () => {
    expect(sanitizeProtocolAuthForRecipient(null, "view")).toEqual({});
    expect(sanitizeProtocolAuthForRecipient({ spice: 3 }, "view")).toEqual({});
  });
});
