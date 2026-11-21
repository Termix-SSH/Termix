import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectShims,
  installShims,
  type ShimTarget,
} from "@/plugin-frame/shims";

const png = new Blob(["png"], { type: "image/png" });
const readClipboardItems = vi.fn<ShimTarget["readClipboardItems"]>();

beforeAll(() => {
  installShims();
  connectShims({
    saveStorage: () => {},
    openUrl: () => {},
    download: () => {},
    writeClipboard: async () => {},
    readClipboard: async () => "",
    readClipboardItems,
  });
});

afterEach(() => {
  readClipboardItems.mockReset();
  vi.unstubAllGlobals();
});

describe("clipboard in a frame", () => {
  it("reads a picture through the shell", async () => {
    readClipboardItems.mockResolvedValue([
      { "image/png": png, "text/html": "<b>not a blob</b>" },
      "junk",
      {},
    ]);
    const items = await navigator.clipboard.read();
    expect(items).toHaveLength(1);
    expect(items[0].types).toEqual(["image/png"]);
    await expect(items[0].getType("image/png")).resolves.toBe(png);
    await expect(items[0].getType("text/html")).rejects.toThrow();
  });

  it("uses the browser's ClipboardItem when the frame has one", async () => {
    class FakeClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    readClipboardItems.mockResolvedValue([{ "image/png": png }]);
    const [item] = await navigator.clipboard.read();
    expect(item).toBeInstanceOf(FakeClipboardItem);
    expect((item as unknown as FakeClipboardItem).data).toEqual({
      "image/png": png,
    });
  });

  it("passes on the shell's refusal", async () => {
    readClipboardItems.mockRejectedValue(new Error("Not allowed now"));
    await expect(navigator.clipboard.read()).rejects.toThrow("Not allowed now");
  });
});
