import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";

const getPlugins = vi.fn<() => Promise<PluginSummary[]>>();

vi.mock("@/api/plugins-api", () => ({
  getPlugins: () => getPlugins(),
  PLUGINS_CHANGED_EVENT: "termix:plugins-changed",
}));

const { useInstalledPlugins, resetInstalledPluginsCache } =
  await import("@/hooks/use-installed-plugins");

function plugin(id: string): PluginSummary {
  return { id, name: id, enabled: true } as PluginSummary;
}

function Names({ label }: { label: string }) {
  const plugins = useInstalledPlugins();
  return <p data-testid={label}>{plugins.map((p) => p.id).join(",")}</p>;
}

beforeEach(() => {
  resetInstalledPluginsCache();
  getPlugins.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useInstalledPlugins", () => {
  it("sends one request for every caller on screen", async () => {
    getPlugins.mockResolvedValue([plugin("a")]);
    const view = render(
      <>
        <Names label="one" />
        <Names label="two" />
        <Names label="three" />
      </>,
    );
    await waitFor(() =>
      expect(view.getByTestId("three").textContent).toBe("a"),
    );
    expect(view.getByTestId("one").textContent).toBe("a");
    expect(getPlugins).toHaveBeenCalledTimes(1);
  });

  it("starts a later screen from the last list without asking again", async () => {
    getPlugins.mockResolvedValue([plugin("a")]);
    const first = render(<Names label="first" />);
    await waitFor(() =>
      expect(first.getByTestId("first").textContent).toBe("a"),
    );
    first.unmount();

    const second = render(<Names label="second" />);
    expect(second.getByTestId("second").textContent).toBe("a");
    expect(getPlugins).toHaveBeenCalledTimes(1);
  });

  it("asks again when a list is old", async () => {
    getPlugins.mockResolvedValue([plugin("a")]);
    const first = render(<Names label="first" />);
    await waitFor(() =>
      expect(first.getByTestId("first").textContent).toBe("a"),
    );
    first.unmount();

    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    getPlugins.mockResolvedValue([plugin("b")]);
    const second = render(<Names label="second" />);
    expect(second.getByTestId("second").textContent).toBe("a");
    await waitFor(() =>
      expect(second.getByTestId("second").textContent).toBe("b"),
    );
    vi.mocked(Date.now).mockRestore();
  });

  it("reloads on a plugin change, even one made while nothing was open", async () => {
    getPlugins.mockResolvedValue([plugin("a")]);
    const first = render(<Names label="first" />);
    await waitFor(() =>
      expect(first.getByTestId("first").textContent).toBe("a"),
    );

    getPlugins.mockResolvedValue([plugin("a"), plugin("b")]);
    act(() => {
      window.dispatchEvent(new CustomEvent("termix:plugins-changed"));
    });
    await waitFor(() =>
      expect(first.getByTestId("first").textContent).toBe("a,b"),
    );
    first.unmount();

    getPlugins.mockResolvedValue([plugin("c")]);
    window.dispatchEvent(new CustomEvent("termix:plugins-changed"));
    const second = render(<Names label="second" />);
    await waitFor(() =>
      expect(second.getByTestId("second").textContent).toBe("c"),
    );
  });

  it("drops an answer that a plugin change made out of date", async () => {
    let finishOld: (value: PluginSummary[]) => void = () => {};
    getPlugins.mockImplementationOnce(
      () => new Promise((resolve) => (finishOld = resolve)),
    );
    const view = render(<Names label="view" />);

    getPlugins.mockResolvedValue([plugin("new")]);
    act(() => {
      window.dispatchEvent(new CustomEvent("termix:plugins-changed"));
    });
    await waitFor(() =>
      expect(view.getByTestId("view").textContent).toBe("new"),
    );

    await act(async () => finishOld([plugin("old")]));
    expect(view.getByTestId("view").textContent).toBe("new");
  });
});
