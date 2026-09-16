import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fetchId = vi.hoisted(() => vi.fn());
vi.mock("@/api/guacamole-api", () => ({ getGuacamoleConnectionId: fetchId }));
import { watchGuacamoleConnectionId } from "../../../features/guacamole/guacamole-session-id";
beforeEach(() => {
  vi.useFakeTimers();
  fetchId.mockReset();
});
afterEach(() => vi.useRealTimers());
it("discovers the sharing ID after handshake without changing the connection origin", async () => {
  fetchId.mockResolvedValueOnce(null).mockResolvedValueOnce("guacd-id");
  const ready = vi.fn();
  const stop = watchGuacamoleConnectionId("connect-id", "remote", ready);
  await vi.advanceTimersByTimeAsync(500);
  expect(fetchId).toHaveBeenLastCalledWith(
    "connect-id",
    "remote",
    expect.any(AbortSignal),
  );
  expect(ready).toHaveBeenCalledExactlyOnceWith("guacd-id");
  stop();
});
it("ignores a late response after disconnect or replacement", async () => {
  let resolve!: (id: string) => void;
  fetchId.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  const ready = vi.fn();
  const stop = watchGuacamoleConnectionId("old", "local", ready);
  stop();
  resolve("old-guacd-id");
  await vi.advanceTimersByTimeAsync(1000);
  expect(ready).not.toHaveBeenCalled();
  expect(fetchId.mock.calls[0][2].aborted).toBe(true);
});
it("bounds discovery when the session never opens", async () => {
  fetchId.mockResolvedValue(null);
  const stop = watchGuacamoleConnectionId("missing", "local", vi.fn());
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetchId).toHaveBeenCalledTimes(20);
  stop();
});
