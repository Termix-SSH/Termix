import { beforeEach, describe, expect, it, vi } from "vitest";

const fileManagerApiMock = vi.hoisted(() => ({
  post: vi.fn(async () => ({ data: { complete: false } })),
}));

vi.mock("@/main-axios", () => ({
  authApi: { defaults: {} },
  fileManagerApi: { defaults: {} },
  getFileManagerApiForSession: () => fileManagerApiMock,
  handleApiError: (error: unknown) => {
    throw error;
  },
  setSessionOrigin: vi.fn(),
  clearSessionOrigin: vi.fn(),
}));
vi.mock("@/lib/connection-origin", () => ({
  resolveConnectionOrigin: vi.fn(),
}));
vi.mock("@/lib/frontend-logger", () => ({
  fileLogger: {
    info: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock("@/lib/file-list-request-cache", () => ({
  getCachedFileList: vi.fn(),
}));
vi.mock("@/lib/file-content-request-cache", () => ({
  getCachedFileContent: vi.fn(),
  invalidateCachedFileContent: vi.fn(),
}));

import { uploadSSHFile } from "../../api/ssh-file-operations-api";

describe("chunked SSH file uploads", () => {
  beforeEach(() => {
    fileManagerApiMock.post.mockClear();
  });

  it("sends raw chunks with the byte offset expected by the server", async () => {
    const fileSize = 1.5 * 1024 * 1024 * 1024 + 1;
    const file = {
      size: fileSize,
      slice: vi.fn(() => new Blob(["chunk"])),
    } as unknown as File;

    await uploadSSHFile("session-1", "/uploads", "archive.img", file);

    expect(fileManagerApiMock.post).toHaveBeenCalledTimes(193);
    expect(fileManagerApiMock.post).toHaveBeenNthCalledWith(
      1,
      "/ssh/uploadFileChunk",
      expect.any(Blob),
      {
        params: {
          sessionId: "session-1",
          path: "/uploads",
          fileName: "archive.img",
          offset: 0,
          totalSize: fileSize,
        },
        headers: { "Content-Type": "application/octet-stream" },
        timeout: 0,
      },
    );
    expect(fileManagerApiMock.post).toHaveBeenLastCalledWith(
      "/ssh/uploadFileChunk",
      expect.any(Blob),
      expect.objectContaining({
        params: expect.objectContaining({ offset: 1.5 * 1024 * 1024 * 1024 }),
      }),
    );
  });
});
