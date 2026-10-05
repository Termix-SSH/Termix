import { describe, expect, it } from "vitest";
import {
  legacySudoMoves,
  legacySudoPassword,
} from "../../../database/db/retired-columns.js";

describe("legacySudoPassword", () => {
  it("reads the sudo password out of a terminal_config value", () => {
    expect(legacySudoPassword('{"sudoPassword":"s3cret"}')).toBe("s3cret");
    expect(legacySudoPassword({ sudoPassword: "s3cret" })).toBe("s3cret");
    expect(legacySudoPassword(JSON.stringify('{"sudoPassword":"x"}'))).toBe(
      "x",
    );
  });

  it("finds nothing in anything else", () => {
    expect(legacySudoPassword(null)).toBeNull();
    expect(legacySudoPassword("{")).toBeNull();
    expect(legacySudoPassword('{"sudoPassword":""}')).toBeNull();
    expect(legacySudoPassword("[1]")).toBeNull();
  });
});

describe("legacySudoMoves", () => {
  it("moves only hosts with no sudo password of their own", () => {
    expect(
      legacySudoMoves([
        { id: 1, terminal_config: '{"sudoPassword":"a"}', sudo_password: null },
        { id: 2, terminal_config: '{"sudoPassword":"b"}', sudo_password: "own" },
        { id: 3, terminal_config: '{"theme":"nord"}', sudo_password: null },
      ]),
    ).toEqual([{ id: 1, sudoPassword: "a" }]);
  });
});
