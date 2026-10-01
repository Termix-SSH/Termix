import { describe, expect, it } from "vitest";
import { decodeWriteContent } from "../../src/backend/content-routes.js";

describe("decodeWriteContent", () => {
  it("keeps text that happens to be valid base64", () => {
    expect(decodeWriteContent("test").toString("utf8")).toBe("test");
    expect(decodeWriteContent("abcd1234").toString("utf8")).toBe("abcd1234");
  });

  it("decodes base64 only when asked", () => {
    const encoded = Buffer.from("local x = 1\n").toString("base64");
    expect(decodeWriteContent(encoded, "base64").toString("utf8")).toBe(
      "local x = 1\n",
    );
  });

  it("passes buffers through", () => {
    const buffer = Buffer.from([0, 1, 2]);
    expect(decodeWriteContent(buffer)).toBe(buffer);
  });
});
