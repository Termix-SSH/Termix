import { beforeEach, describe, expect, it, vi } from "vitest";

const success = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
  },
}));

vi.mock("@/main-axios.ts", () => ({}));
vi.mock("../../../features/file-manager/transferNotificationStore.ts", () => ({
  markTransferNotified: vi.fn(),
}));

import { showTransferCompletionToast } from "../../../features/file-manager/transferProgressMonitor.tsx";

describe("transfer completion toast", () => {
  beforeEach(() => {
    success.mockReset();
  });

  it("clears the infinite duration inherited from the progress toast", () => {
    showTransferCompletionToast(
      { transferId: "transfer-1", status: "completed" },
      ((key: string) => key) as never,
      "progress-toast",
    );

    expect(success).toHaveBeenCalledWith("transfer.transferSuccess", {
      id: "progress-toast",
      description: undefined,
      className: "!pr-10 !pl-4 transfer-progress-toast",
      duration: undefined,
    });
  });
});
