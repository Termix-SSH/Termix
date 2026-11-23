import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { forwardToasts, installFrameToasts } from "@/plugin-frame/frame-toasts";
import { toast as pluginToast } from "@/plugin-frame/sonner-toast";
import { startFrameServices } from "@/plugin-frame/frame-boot";
import { FramePort } from "@/plugin-frame/rpc";
import type { FrameMessage } from "@/plugin-frame/protocol";

/** A frame port and a shell port wired together, as the frame boot does. */
function wire(onShellCall: (method: string, args: unknown[]) => unknown) {
  const send = (target: () => FramePort) => (message: FrameMessage) =>
    queueMicrotask(() => target().receive(structuredClone(message)));
  const shell: FramePort = new FramePort({
    post: send(() => frame),
    onCall: onShellCall,
    fnPrefix: "s",
  });
  const frame: FramePort = new FramePort({
    post: send(() => shell),
    onCall: () => undefined,
    fnPrefix: "p",
  });
  return (method: string, ...args: unknown[]) => frame.call(method, args);
}

describe("toasts raised by a plugin's own code", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("reach the shell over the frame's port, whatever the view's fit", async () => {
    const seen = vi.fn();
    restore = installFrameToasts(
      wire((method, args) => {
        seen(method, args);
      }),
    );
    pluginToast.success("saved");
    pluginToast.error("failed");
    pluginToast("plain");
    pluginToast.warning("careful", { description: "disk" });
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(4));
    expect(seen.mock.calls).toEqual([
      ["toast", ["success", "saved"]],
      ["toast", ["error", "failed"]],
      ["toast", ["info", "plain"]],
      ["toast", ["warning", "careful: disk"]],
    ]);
  });

  it("covers every kind and a bare toast()", () => {
    const forward = vi.fn();
    restore = forwardToasts(forward);
    toast.success("saved");
    toast.info("fyi");
    toast.message("m");
    pluginToast("bare");
    expect(forward.mock.calls).toEqual([
      ["success", "saved"],
      ["info", "fyi"],
      ["info", "m"],
      ["info", "bare"],
    ]);
  });

  it("leaves toasts with an action or id to sonner", () => {
    const forward = vi.fn();
    restore = forwardToasts(forward);
    const id = toast.success("undo?", {
      id: "x",
      action: { label: "Undo", onClick() {} },
    });
    expect(forward).not.toHaveBeenCalled();
    expect(id).toBe("x");
    toast.dismiss();
  });

  it("stops forwarding once removed", () => {
    const forward = vi.fn();
    forwardToasts(forward)();
    toast.success("quiet");
    pluginToast("quiet");
    expect(forward).not.toHaveBeenCalled();
    toast.dismiss();
  });

  it("forwards presentational options and keeps the rest with sonner", () => {
    const forward = vi.fn();
    restore = forwardToasts(forward);
    toast.success("x", { duration: 3000 });
    toast.error("y", {
      position: "top-center",
      closeButton: true,
      className: "c",
      style: {},
      richColors: true,
      description: "d",
    });
    expect(forward.mock.calls).toEqual([
      ["success", "x"],
      ["error", "y: d"],
    ]);
    toast.info("z", { duration: 1, onDismiss() {} });
    expect(forward).toHaveBeenCalledTimes(2);
    toast.dismiss();
  });

  it("forwards any option that only changes how a toast looks", () => {
    const forward = vi.fn();
    restore = forwardToasts(forward);
    toast.success("x", { icon: "i", dismissible: false });
    toast.error("y", { description: undefined });
    toast.error("z", { description: new Error("boom") as never });
    expect(forward.mock.calls).toEqual([
      ["success", "x"],
      ["error", "y"],
      ["error", "z"],
    ]);
    toast.info("w", { id: undefined, onDismiss() {} });
    expect(forward).toHaveBeenCalledTimes(3);
    toast.dismiss();
  });

  it("are wired up by the frame's start-up services", async () => {
    const seen = vi.fn();
    const call = wire((method, args) => {
      seen(method, args);
    });
    startFrameServices(call, () => {});
    restore = () => {};
    pluginToast.success("from boot");
    await vi.waitFor(() =>
      expect(seen).toHaveBeenCalledWith("toast", ["success", "from boot"]),
    );
  });
});
