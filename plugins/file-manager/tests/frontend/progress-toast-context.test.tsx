import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@termix/plugin-sdk/frontend", () => ({
  useTranslation: () => {
    throw Error("No plugin scope in the global toaster");
  },
}));
import { DownloadProgressToast } from "../../src/frontend/components/DownloadProgressToast";
import { TransferProgressToast } from "../../src/frontend/components/TransferProgressToast";
import { LocalTransferProgressToast } from "../../src/frontend/components/LocalTransferProgressToast";
afterEach(cleanup);
const t = (key: string) => key;
it("renders download progress outside plugin scope", () => {
  render(
    <DownloadProgressToast t={t} fileName="test.txt" loaded={50} total={100} />,
  );
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "50",
  );
});
it("renders host transfer progress outside plugin scope", () => {
  render(
    <TransferProgressToast
      t={t}
      status={{
        transferId: "test",
        status: "running",
        phase: "transferring",
        bytesTransferred: 50,
        totalBytes: 100,
      }}
      formatSize={String}
    />,
  );
  expect(screen.getByRole("progressbar")).toBeTruthy();
});
it("preserves cancellation on local transfers outside plugin scope", () => {
  const cancel = vi.fn();
  render(
    <LocalTransferProgressToast
      t={t}
      status={{
        direction: "upload",
        totalFiles: 2,
        completedFiles: 1,
        bytesDone: 50,
        totalBytes: 100,
      }}
      onCancel={cancel}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(cancel).toHaveBeenCalledOnce();
});
