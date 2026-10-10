import { describe, expect, it } from "vitest";
import { defaultsRows } from "@/manage/defaults-rows";
import type { Host } from "@/types/ui-types";

const t = (key: string) => key;

describe("defaultsRows", () => {
  it("lists instance defaults only for those who can edit them", () => {
    const hosts = [{ folder: "A / B" }, { folder: "" }] as Host[];
    expect(defaultsRows(hosts, false, t).map((r) => r.key)).toEqual([
      "user",
      "folder:A",
      "folder:A / B",
    ]);
    expect(defaultsRows(hosts, true, t)[0]).toMatchObject({
      key: "admin",
      level: "admin",
    });
  });
});
