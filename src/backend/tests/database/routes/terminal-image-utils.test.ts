import { describe, expect, it } from "vitest";
import {
  exceedsImageStorageLimit,
  exceedsNormalizedImageSize,
  imageExtensionForFormat,
  createConcurrencyLimiter,
  isExpiredImage,
  isImageFilename,
} from "../../../database/routes/terminal-image-utils.js";

describe("terminal image utilities", () => {
  it("accepts UUID-based image filenames", () => {
    expect(isImageFilename("b797234d-eb5d-4b1b-b7f3-17c26f257506.jpeg")).toBe(
      true,
    );
  });

  it("rejects unsafe or unrelated filenames", () => {
    expect(isImageFilename("../secrets.txt")).toBe(false);
    expect(isImageFilename("not-an-image.jpeg")).toBe(false);
    expect(isImageFilename("b797234d-eb5d-4b1b-b7f3-17c26f257506")).toBe(false);
  });

  it("maps decoded raster formats while excluding SVG", () => {
    expect(imageExtensionForFormat("jpeg")).toBe("jpg");
    expect(imageExtensionForFormat("heif")).toBe("heif");
    expect(imageExtensionForFormat("tiff")).toBe("tiff");
    expect(imageExtensionForFormat("svg")).toBeUndefined();
    expect(imageExtensionForFormat(undefined)).toBeUndefined();
  });

  it("rejects normalized output beyond the byte ceiling", () => {
    expect(exceedsNormalizedImageSize(10_000_001, 10_000_000)).toBe(true);
    expect(exceedsNormalizedImageSize(10_000_000, 10_000_000)).toBe(false);
  });
  it("expires files older than the configured TTL", () => {
    expect(isExpiredImage(1_000, 3_000, 1_000)).toBe(true);
    expect(isExpiredImage(2_500, 3_000, 1_000)).toBe(false);
  });

  it("rejects uploads that exceed the count or byte limit", () => {
    expect(exceedsImageStorageLimit(100, 10, 1, 100, 1000)).toBe(true);
    expect(exceedsImageStorageLimit(1, 900, 101, 100, 1000)).toBe(true);
    expect(exceedsImageStorageLimit(1, 900, 100, 100, 1000)).toBe(false);
  });

  it("bounds concurrent work", async () => {
    const limiter = createConcurrencyLimiter(1);
    let active = 0;
    let peak = 0;
    const task = async () => {
      const release = await limiter.acquire();
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      release();
    };

    await Promise.all([task(), task(), task()]);

    expect(peak).toBe(1);
    expect(limiter.active).toBe(0);
  });
});
