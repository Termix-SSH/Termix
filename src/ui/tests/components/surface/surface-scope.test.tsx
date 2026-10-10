import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  InlineView,
  PanePrompt,
  SurfaceScope,
  useConfirm,
  type ConfirmOptions,
} from "@/components/surface/surface-scope";

afterEach(cleanup);

function Asker({
  options,
  onResult,
}: {
  options: ConfirmOptions;
  onResult: (ok: boolean) => void;
}) {
  const confirm = useConfirm();
  return (
    <button onClick={() => void confirm(options).then(onResult)}>ask</button>
  );
}

describe("useConfirm", () => {
  it("resolves true when confirmed with Enter", async () => {
    const onResult = vi.fn();
    render(
      <SurfaceScope>
        <Asker options={{ title: "Delete web-01?" }} onResult={onResult} />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("ask"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Delete web-01?")).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("resolves false on Esc and on Cancel", async () => {
    const onResult = vi.fn();
    render(
      <SurfaceScope>
        <Asker options={{ title: "Remove?" }} onResult={onResult} />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("ask"));
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onResult).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByText("ask"));
    await act(async () => {
      fireEvent.click(screen.getByText("common.cancel"));
    });
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenLastCalledWith(false);
  });

  it("stops Enter from reaching anything listening underneath", async () => {
    const underneath = vi.fn();
    window.addEventListener("keydown", underneath);
    render(
      <SurfaceScope>
        <Asker options={{ title: "Close?" }} onResult={() => {}} />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("ask"));
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(underneath).not.toHaveBeenCalled();
    window.removeEventListener("keydown", underneath);
  });

  it("uses a neutral confirm button when not destructive", () => {
    render(
      <SurfaceScope>
        <Asker
          options={{ title: "Apply?", destructive: false }}
          onResult={() => {}}
        />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("ask"));
    expect(screen.getByText("common.confirm")).toBeTruthy();
  });
});

function Editor({ onBeforeClose }: { onBeforeClose?: () => boolean }) {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <InlineView
        open={open}
        onOpenChange={setOpen}
        title="Edit folder"
        onBeforeClose={onBeforeClose}
      >
        <span>folder form</span>
        <button onClick={() => setNested(true)}>nested</button>
        <InlineView
          open={nested}
          onOpenChange={setNested}
          title="Pick icon"
          width="wide"
        >
          <span>icon grid</span>
        </InlineView>
      </InlineView>
    </>
  );
}

describe("InlineView", () => {
  it("takes over the surface and reports the widening", () => {
    const onEditingChange = vi.fn();
    render(
      <SurfaceScope onEditingChange={onEditingChange}>
        <Editor />
      </SurfaceScope>,
    );
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByText("folder form")).toBeTruthy();
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByText("nested"));
    expect(screen.getByText("icon grid")).toBeTruthy();
    expect(onEditingChange).toHaveBeenLastCalledWith("wide");
  });

  it("goes back one view at a time", async () => {
    render(
      <SurfaceScope>
        <Editor />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByText("nested"));
    const backs = screen.getAllByLabelText("common.back");
    await act(async () => {
      fireEvent.click(backs[backs.length - 1]);
    });
    expect(screen.queryByText("icon grid")).toBeNull();
    expect(screen.getByText("folder form")).toBeTruthy();
  });

  it("stays open when the close guard says no", async () => {
    render(
      <SurfaceScope>
        <Editor onBeforeClose={() => false} />
      </SurfaceScope>,
    );
    fireEvent.click(screen.getByText("open"));
    await act(async () => {
      fireEvent.click(screen.getByLabelText("common.back"));
    });
    expect(screen.getByText("folder form")).toBeTruthy();
  });
});

describe("PanePrompt", () => {
  it("dims the pane by default and closes on a backdrop click", () => {
    const onCancel = vi.fn();
    render(
      <PanePrompt open title="Title" onCancel={onCancel}>
        <p>body</p>
      </PanePrompt>,
    );
    const card = screen.getByRole("dialog", { name: "Title" });
    const layer = card.parentElement!;
    expect(layer.className).toContain("z-50");
    fireEvent.mouseDown(card);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.mouseDown(layer);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("covers a connecting surface with an opaque layer", () => {
    render(
      <PanePrompt
        open
        title="Login"
        layer="connection"
        backgroundColor="rgb(1, 2, 3)"
      />,
    );
    const layer = screen.getByRole("dialog", { name: "Login" }).parentElement!;
    expect(layer.className).toContain("z-500");
    expect(layer.style.backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("renders nothing when closed", () => {
    render(<PanePrompt open={false} title="Hidden" />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
