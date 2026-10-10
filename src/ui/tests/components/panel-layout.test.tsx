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
  ViewToggle,
} from "@/components/panel-layout";

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
