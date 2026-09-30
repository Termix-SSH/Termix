import { describe, expect, it } from "vitest";
import {
  mountForPath,
  type DiskFilesystem,
} from "../../src/frontend/disk-info";

function fs(mount: string): DiskFilesystem {
  return {
    filesystem: mount,
    type: "ext4",
    mount,
    percent: 10,
    usedHuman: "1G",
    totalHuman: "10G",
    availableHuman: "9G",
    usedBytes: 1,
    totalBytes: 10,
    availableBytes: 9,
  };
}

describe("mountForPath", () => {
  const list = [fs("/"), fs("/volume1"), fs("/volume10")];

  it("picks the deepest mount that holds the path", () => {
    expect(mountForPath(list, "/volume1/share")?.mount).toBe("/volume1");
    expect(mountForPath(list, "/volume10")?.mount).toBe("/volume10");
    expect(mountForPath(list, "/etc")?.mount).toBe("/");
  });

  it("returns null without a path or mounts", () => {
    expect(mountForPath(list, null)).toBeNull();
    expect(mountForPath([], "/etc")).toBeNull();
  });
});
