import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  Facts,
  PanelSearch,
  PanelShell,
  Segmented,
  ToolbarBand,
  ViewToggle,
  gridSizeStyle,
} from "@/components/panel-layout";
import { TileColumn } from "@/components/tile-grid/TileColumn";
import { TileStack } from "@/components/tile-grid/TileStack";

afterEach(cleanup);

describe("PanelSearch", () => {
  it("clears with the button and with Esc", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PanelSearch value="web" onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("panel.clearSearch"));
    expect(onChange).toHaveBeenLastCalledWith("");

    rerender(<PanelSearch value="db" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("hides the clear button while empty", () => {
    render(<PanelSearch value="" onChange={() => {}} />);
    expect(screen.queryByLabelText("panel.clearSearch")).toBeNull();
  });
});

describe("Segmented", () => {
  it("marks the active option and reports a pick", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="hosts"
        onChange={onChange}
        options={[
          { value: "hosts", label: "Hosts", count: 3 },
          { value: "credentials", label: "Credentials" },
        ]}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith("credentials");
  });
});

describe("ViewToggle", () => {
  it("switches view and density", () => {
    const onView = vi.fn();
    const onDensity = vi.fn();
    render(
      <ViewToggle
        view="grid"
        onView={onView}
        density="comfortable"
        onDensity={onDensity}
      />,
    );
    fireEvent.click(screen.getByLabelText("panel.listView"));
    expect(onView).toHaveBeenCalledWith("list");
    fireEvent.click(screen.getByLabelText("panel.compactRows"));
    expect(onDensity).toHaveBeenCalledWith("compact");
  });

  it("shows the columns picker only in grid view", () => {
    const props = { onView: vi.fn(), columns: "auto" as const };
    const { rerender } = render(
      <ViewToggle view="grid" {...props} onColumns={vi.fn()} />,
    );
    expect(screen.getByLabelText("panel.columns.title")).toBeTruthy();

    rerender(<ViewToggle view="list" {...props} onColumns={vi.fn()} />);
    expect(screen.queryByLabelText("panel.columns.title")).toBeNull();

    rerender(<ViewToggle view="grid" {...props} />);
    expect(screen.queryByLabelText("panel.columns.title")).toBeNull();
  });
});

describe("gridSizeStyle", () => {
  it("fits auto cards to the pane", () => {
    expect(gridSizeStyle("auto", 280).gridTemplateColumns).toBe(
      "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
    );
  });

  it("splits the width for a fixed count", () => {
    expect(gridSizeStyle("4").gridTemplateColumns).toContain(
      "(100% - 3 * 0.5rem) / 4",
    );
  });
});

describe("Facts", () => {
  it("puts a rule only between facts", () => {
    const { container } = render(
      <Facts>
        <span>one</span>
        {null}
        <span>two</span>
      </Facts>,
    );
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(1);
  });

  it("separates facts passed inside a fragment", () => {
    const { container } = render(
      <Facts>
        <>
          <span>Termix</span>
          {false}
          <span>v1.0.0</span>
          <span>Monitoring</span>
        </>
      </Facts>,
    );
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(2);
  });
});

describe("PanelShell", () => {
  it("draws the header, toolbar and footer", () => {
    render(
      <PanelShell
        title="Docker"
        status="2 running"
        toolbar={<span>toolbar</span>}
        footer={<span>footer</span>}
      >
        body
      </PanelShell>,
    );
    expect(screen.getByText("Docker")).toBeTruthy();
    expect(screen.getByText("2 running")).toBeTruthy();
    expect(screen.getByText("toolbar")).toBeTruthy();
    expect(screen.getByText("footer")).toBeTruthy();
  });
});

describe("toolbar sizing", () => {
  it("fits small controls in the toolbar and in ToolbarBand", () => {
    render(
      <>
        <PanelShell title="X" toolbar={<span>tools</span>}>
          body
        </PanelShell>
        <ToolbarBand>band</ToolbarBand>
      </>,
    );
    const band = screen.getByText("band");
    expect(band.className).toContain(
      "[&_[data-slot=button][data-size=sm]]:h-8",
    );
    expect(screen.getByText("tools").parentElement!.className).toContain(
      "[&_[data-slot=input]]:h-8",
    );
  });

  it("keeps Segmented at its natural width", () => {
    render(
      <Segmented<"a" | "b">
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    expect(screen.getByRole("radiogroup").className).toContain("w-fit");
  });

  it("clips the last tile line when a footer is pinned", () => {
    const { container } = render(
      <PanelShell title="Form" footer={<span>save</span>}>
        <TileColumn>
          <div>field</div>
        </TileColumn>
      </PanelShell>,
    );
    expect(container.querySelector(".-mb-px")).toBeTruthy();
  });
});

describe("ToolbarBand in a tile stack", () => {
  it("leaves the line under it to the stack", () => {
    render(
      <TileStack>
        <ToolbarBand>inside</ToolbarBand>
      </TileStack>,
    );
    expect(screen.getByText("inside").parentElement!.className).toContain(
      "[&>[data-slot=toolbar-band]]:border-b-0",
    );
  });
});
