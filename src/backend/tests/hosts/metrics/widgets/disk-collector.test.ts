import { describe, it, expect } from "vitest";
import {
  parseDfLines,
  findWorstMountIndex,
  buildFilesystemList,
  selectPrimaryFilesystem,
} from "../../../../hosts/metrics/widgets/disk-collector.js";

describe("parseDfLines", () => {
  it("parses df -P output into rows", () => {
    const output =
      "/dev/nvme0n1p2 3848290697216 1046898851840 2606516101120  29% /\n" +
      "/dev/nvme1n1p1 15393162788864 15239230844928 153931922841  99% /data\n";
    const rows = parseDfLines(output);
    expect(rows).toHaveLength(2);
    expect(rows[0].mount).toBe("/");
    expect(rows[1].mount).toBe("/data");
  });

  it("filters out pseudo filesystems", () => {
    const output =
      "tmpfs 8000 0 8000 0% /dev/shm\n" +
      "overlay 100 50 50 50% /\n" +
      "/dev/sda1 100 50 50 50% /mnt/data\n";
    const rows = parseDfLines(output);
    expect(rows).toHaveLength(1);
    expect(rows[0].mount).toBe("/mnt/data");
  });
});

describe("findWorstMountIndex", () => {
  it("picks the most-utilized mount, not just the first row", () => {
    const rows = parseDfLines(
      "/dev/nvme0n1p2 3848290697216 1046898851840 2606516101120  29% /\n" +
        "/dev/nvme1n1p1 15393162788864 15239230844928 153931922841  99% /data\n",
    );
    const worst = findWorstMountIndex(rows);
    expect(worst.index).toBe(1);
    expect(worst.totalBytes).toBe(15393162788864);
    expect(worst.usedBytes).toBe(15239230844928);
  });

  it("falls back to the only mount available", () => {
    const rows = parseDfLines("/dev/sda1 100 30 70 30% /\n");
    const worst = findWorstMountIndex(rows);
    expect(worst.index).toBe(0);
  });

  it("skips rows with invalid or zero totals", () => {
    const rows = parseDfLines(
      "/dev/sda1 0 0 0 0% /broken\n" + "/dev/sda2 100 40 60 40% /ok\n",
    );
    const worst = findWorstMountIndex(rows);
    expect(worst.index).toBe(1);
  });

  it("returns index -1 when there are no usable rows", () => {
    const worst = findWorstMountIndex([]);
    expect(worst.index).toBe(-1);
    expect(worst.totalBytes).toBe(0);
  });
});

const BYTES_OUTPUT =
  "/dev/nvme0n1p2 1000 400 600 40% /\n" +
  "/dev/nvme1n1p1 2000 1900 100 95% /data\n";
const HUMAN_OUTPUT =
  "/dev/nvme0n1p2 1.0K 400 600 40% /\n" +
  "/dev/nvme1n1p1 2.0K 1.9K 100 95% /data\n";

describe("buildFilesystemList", () => {
  it("returns every real filesystem with byte maths and human strings", () => {
    const list = buildFilesystemList(
      parseDfLines(BYTES_OUTPUT),
      parseDfLines(HUMAN_OUTPUT),
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      mount: "/",
      percent: 40,
      usedHuman: "400",
      totalHuman: "1.0K",
      availableHuman: "600",
      usedBytes: 400,
      totalBytes: 1000,
    });
    expect(list[1]).toMatchObject({ mount: "/data", percent: 95 });
  });

  it("matches human rows by mount when the row counts differ", () => {
    const list = buildFilesystemList(
      parseDfLines(BYTES_OUTPUT),
      parseDfLines("/dev/nvme1n1p1 2.0K 1.9K 100 95% /data\n"),
    );
    expect(list[0].totalHuman).toBeNull();
    expect(list[1].totalHuman).toBe("2.0K");
  });

  it("drops filesystems with a zero or invalid total", () => {
    const list = buildFilesystemList(
      parseDfLines("/dev/sda1 0 0 0 0% /broken\n/dev/sda2 100 40 60 40% /ok\n"),
      [],
    );
    expect(list).toHaveLength(1);
    expect(list[0].mount).toBe("/ok");
  });
});

describe("selectPrimaryFilesystem", () => {
  it("prefers root over a fuller secondary mount", () => {
    const list = buildFilesystemList(
      parseDfLines(BYTES_OUTPUT),
      parseDfLines(HUMAN_OUTPUT),
    );
    expect(selectPrimaryFilesystem(list)?.mount).toBe("/");
  });

  it("falls back to the most-utilized mount when there is no root", () => {
    const list = buildFilesystemList(
      parseDfLines(
        "/dev/sda1 1000 100 900 10% /mnt/a\n" +
          "/dev/sda2 1000 800 200 80% /mnt/b\n",
      ),
      [],
    );
    expect(selectPrimaryFilesystem(list)?.mount).toBe("/mnt/b");
  });

  it("returns null for an empty list", () => {
    expect(selectPrimaryFilesystem([])).toBeNull();
  });
});
