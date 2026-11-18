import { afterEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { HostTabEmbed } from "@/shell/HostTabEmbed";
import { setForeignRuntime } from "@/components/foreign/foreign-runtime";
import { useHostActions } from "@/sidebar/host-contributions";

afterEach(() => setForeignRuntime(null));

describe("embedded tabs in a plugin frame", () => {
  it("asks the shell to draw another plugin's tab over the spot", () => {
    const Part = (props: Record<string, unknown>) => (
      <div data-testid="part">{String(props.isVisible)}</div>
    );
    const useTab = vi.fn(() => Part);
    setForeignRuntime({ useTab } as never);
    const { getByTestId } = render(
      <HostTabEmbed
        host={{ id: 4 } as never}
        type="terminal"
        isVisible={false}
        shell={{} as never}
      />,
    );
    expect(useTab).toHaveBeenCalledWith("terminal", 4);
    expect(getByTestId("part").textContent).toBe("false");
  });

  it("reads host actions from the shell", () => {
    const action = { id: "files", kind: "open" };
    setForeignRuntime({ useHostActions: () => [action] } as never);
    const { result } = renderHook(() => useHostActions());
    expect(result.current).toEqual([action]);
  });
});
