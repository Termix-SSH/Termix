import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { BootProgress, ColdBootStage } from "../../shell/ColdBootStage";
import {
  resetColdBoot,
  trackColdBoot,
} from "../../plugin-host/frames/cold-boot";

function boots(count: number) {
  const done: Array<() => void> = [];
  for (let i = 0; i < count; i++) {
    trackColdBoot(
      new Promise<void>((resolve) => {
        done.push(resolve);
      }),
    );
  }
  return done;
}

afterEach(() => {
  cleanup();
  resetColdBoot();
});

describe("ColdBootStage", () => {
  it("stays hidden for a few cold plugins", () => {
    act(() => void boots(3));
    render(<ColdBootStage />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows progress and goes away once every plugin is up", async () => {
    let done: Array<() => void> = [];
    act(() => {
      done = boots(6);
    });
    render(<ColdBootStage />);
    expect(screen.getByText("plugins.firstLoad.title")).toBeTruthy();
    await act(async () => {
      for (const finish of done) finish();
    });
    expect(screen.queryByText("plugins.firstLoad.title")).toBeNull();
    act(() => void boots(6));
    expect(screen.queryByText("plugins.firstLoad.title")).toBeNull();
  });

  it("can be skipped", () => {
    act(() => void boots(6));
    render(<ColdBootStage />);
    fireEvent.click(screen.getByText("plugins.firstLoad.skip"));
    expect(screen.queryByText("plugins.firstLoad.title")).toBeNull();
  });
});

describe("BootProgress", () => {
  it("shows only while many plugins start", async () => {
    let done: Array<() => void> = [];
    act(() => {
      done = boots(6);
    });
    render(<BootProgress />);
    expect(screen.getByText("plugins.firstLoad.title")).toBeTruthy();
    await act(async () => {
      for (const finish of done) finish();
    });
    expect(screen.queryByText("plugins.firstLoad.title")).toBeNull();
  });

  it("stays hidden for a few plugins", () => {
    act(() => void boots(3));
    render(<BootProgress />);
    expect(screen.queryByText("plugins.firstLoad.title")).toBeNull();
  });
});
