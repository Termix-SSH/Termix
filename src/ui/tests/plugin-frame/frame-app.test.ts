import { describe, expect, it, vi } from "vitest";
import { createFrameApp } from "@/plugin-frame/frame-app";

function Screen() {
  return null;
}

function frameApp(call = vi.fn(async () => null)) {
  const register = vi.fn();
  const { app, dispose } = createFrameApp({
    pluginId: "webauthn",
    role: "background",
    manifest: {
      id: "webauthn",
      name: "WebAuthn",
      capabilities: ["auth:provide"],
      contributes: {},
    } as never,
    register,
    unregister: vi.fn(),
    call,
    api: {} as never,
    fetch: vi.fn() as never,
    wsUrl: vi.fn() as never,
  });
  return { app, dispose, register, call };
}

describe("auth parts in a frame", () => {
  it("refuses login and second factor screens, which the shell draws", () => {
    const { app, dispose } = frameApp();
    expect(() =>
      app.registerLoginMethod({
        id: "passkey",
        titleKey: "signIn",
        component: Screen,
      }),
    ).toThrow(/shell draws/);
    expect(() =>
      app.registerSecondFactorUI({
        id: "key",
        titleKey: "key",
        component: Screen,
      }),
    ).toThrow(/shell draws/);
    dispose();
  });

  it("reports only the enrolment screen", () => {
    const { app, register, dispose } = frameApp();
    app.registerLoginMethod({
      id: "passkey",
      titleKey: "signIn",
      enrollment: Screen,
    });
    app.registerSecondFactorUI({
      id: "key",
      titleKey: "key",
      enrollment: Screen,
    });
    const kinds = register.mock.calls.map((call) => call[1]);
    expect(kinds).toEqual(["loginEnrollment", "factorEnrollment"]);
    expect(register.mock.calls[0][2]).toMatchObject({
      id: "passkey",
      titleKey: "signIn",
      enrollment: expect.objectContaining({ $component: expect.any(String) }),
    });
    dispose();
  });

  it("registers nothing for a method with no enrolment", () => {
    const { app, register, dispose } = frameApp();
    app.registerLoginMethod({ id: "sso", titleKey: "signIn" });
    expect(register).not.toHaveBeenCalled();
    dispose();
  });

  it("asks the shell for security key steps by id only", async () => {
    const call = vi.fn(async () => ({ added: true }));
    const { app, dispose } = frameApp(call);
    await expect(app.auth!.webauthn("add-key", { name: "x" })).resolves.toEqual(
      { added: true },
    );
    expect(call).toHaveBeenCalledWith("passkey.run", "add-key", { name: "x" });
    dispose();
  });
});
