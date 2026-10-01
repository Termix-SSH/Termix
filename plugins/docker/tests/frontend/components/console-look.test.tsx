import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  FALLBACK_CONSOLE_LOOK,
  useConsoleLook,
} from "../../../src/frontend/components/console-look";

describe("useConsoleLook", () => {
  it("uses plain colors while the SSH terminal is off", async () => {
    const { result } = renderHook(() =>
      useConsoleLook({ id: "1", name: "h", ip: "10.0.0.1", port: 22 }, "dark"),
    );
    await waitFor(() => expect(result.current).toBe(FALLBACK_CONSOLE_LOOK));
    expect(result.current.colors.background).toBe("#0c0d0b");
  });
});
