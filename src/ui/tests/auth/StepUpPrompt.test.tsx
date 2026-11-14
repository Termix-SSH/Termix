import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecondFactorUIProps } from "@termix-ssh/plugin-sdk/frontend";

const api = vi.hoisted(() => ({
  listStepUpFactors: vi.fn(async () => [{ id: "totp" }]),
  challengeStepUp: vi.fn(async () => null),
  verifyStepUp: vi.fn(async () => {}),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/api/auth-methods-api", () => api);
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { requestStepUp, StepUpPromptHost } = await import("@/auth/StepUpPrompt");
const { registerSecondFactor } = await import("@/plugin-host/auth-registry");

function Totp({ verify, cancel }: SecondFactorUIProps) {
  return (
    <div>
      <button type="button" onClick={() => void verify({ code: "123456" })}>
        send code
      </button>
      <button type="button" onClick={cancel}>
        give up
      </button>
    </div>
  );
}

let dispose: () => void = () => {};

beforeEach(() => {
  api.listStepUpFactors.mockClear();
  api.verifyStepUp.mockReset();
  api.verifyStepUp.mockResolvedValue(undefined);
  toastError.mockClear();
  dispose = registerSecondFactor({
    id: "totp",
    titleKey: "totp.title",
    component: Totp,
  }) as unknown as () => void;
});

afterEach(() => {
  cleanup();
  dispose();
});

describe("requestStepUp", () => {
  it("answers no when the shell has no prompt mounted", async () => {
    await expect(requestStepUp()).resolves.toBe(false);
  });

  it("answers yes once the person proves the factor", async () => {
    render(<StepUpPromptHost />);
    let answer!: Promise<boolean>;
    act(() => {
      answer = requestStepUp();
    });
    (await screen.findByText("send code")).click();
    await expect(answer).resolves.toBe(true);
    expect(api.verifyStepUp).toHaveBeenCalledWith("totp", { code: "123456" });
    await waitFor(() => expect(screen.queryByText("send code")).toBeNull());
  });

  it("keeps the prompt open on a wrong answer", async () => {
    api.verifyStepUp.mockRejectedValueOnce(new Error("Invalid code"));
    render(<StepUpPromptHost />);
    let answer!: Promise<boolean>;
    act(() => {
      answer = requestStepUp();
    });
    (await screen.findByText("send code")).click();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Invalid code"),
    );
    expect(screen.getByText("send code")).toBeTruthy();
    act(() => screen.getByText("common.cancel").click());
    await expect(answer).resolves.toBe(false);
  });

  it("shares one prompt between two asks", async () => {
    render(<StepUpPromptHost />);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = requestStepUp();
      second = requestStepUp();
    });
    expect(second).toBe(first);
    (await screen.findByText("give up")).click();
    await expect(first).resolves.toBe(false);
  });

  it("answers no when the shell goes away", async () => {
    const { unmount } = render(<StepUpPromptHost />);
    let answer!: Promise<boolean>;
    act(() => {
      answer = requestStepUp();
    });
    unmount();
    await expect(answer).resolves.toBe(false);
  });

  it("says so when the person has no factor to prove", async () => {
    api.listStepUpFactors.mockResolvedValueOnce([]);
    render(<StepUpPromptHost />);
    act(() => {
      void requestStepUp();
    });
    expect(await screen.findByText("auth.stepUp.noFactor")).toBeTruthy();
    act(() => screen.getByText("common.cancel").click());
  });
});
