import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.hoisted(() =>
  vi.fn(async (_url: string, body: { ids: string[] }) => ({
    data: {
      tokens: Object.fromEntries(
        body.ids
          .filter((id) => id !== "gone")
          .map((id) => [id, { token: `t-${id}`, expiresIn: 300 }]),
      ),
    },
  })),
);

vi.mock("@/main-axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main-axios")>()),
  authApi: { post },
}));

import { dropFrameToken, frameToken } from "@/plugin-host/frames/frame-token";

beforeEach(() => {
  post.mockClear();
  dropFrameToken();
});

describe("frameToken", () => {
  it("asks once for every plugin that needs a token at the same moment", async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `plugin-${i}`);
    const got = await Promise.all(ids.map((id) => frameToken(id)));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/plugins/frame-tokens", { ids });
    expect(got[5].value).toBe("t-plugin-5");
  });

  it("keeps a token until it is close to running out", async () => {
    await frameToken("alerts");
    await frameToken("alerts");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("fails only the plugin the server had no token for", async () => {
    const [ok, gone] = await Promise.allSettled([
      frameToken("alerts"),
      frameToken("gone"),
    ]);
    expect(ok.status).toBe("fulfilled");
    expect(gone.status).toBe("rejected");
  });

  it("fails every waiting plugin when the request fails, and asks again later", async () => {
    post.mockRejectedValueOnce(new Error("429"));
    await expect(frameToken("alerts")).rejects.toThrow("429");
    await expect(frameToken("alerts")).resolves.toMatchObject({
      value: "t-alerts",
    });
  });
});
