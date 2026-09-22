/**
 * The schema-driven settings form.
 *
 * A plugin declares fields and core draws them, so the thing worth proving is
 * that every declared type renders a usable control, reports what the user
 * typed, and that a secret's value never appears in the DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginSettingsField } from "@/api/plugins-api";
import { SettingsFieldRow } from "@/settings/SettingsFields";
import { isFieldActive } from "@/settings/settings-fields-util";
import {
  registerSettingsComponent,
  resetSettingsComponents,
} from "@/settings/settings-components";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderField(
  field: PluginSettingsField,
  values: Record<string, unknown> = {},
  options: { running?: boolean } = {},
) {
  const setValue = vi.fn();
  render(
    <SettingsFieldRow
      pluginId="sample"
      field={field}
      values={values}
      setValue={setValue}
      running={options.running ?? true}
    />,
  );
  return { setValue };
}

beforeEach(() => {
  resetSettingsComponents();
});

afterEach(() => {
  cleanup();
});

describe("field types", () => {
  it("renders a boolean as a switch and reports the toggle", () => {
    const { setValue } = renderField(
      { key: "enabled", type: "boolean", labelKey: "enabled.label" },
      { enabled: false },
    );

    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);

    expect(setValue).toHaveBeenCalledWith("enabled", true);
  });

  it("renders a string as a text box and reports what was typed", () => {
    const { setValue } = renderField(
      { key: "baseUrl", type: "string", labelKey: "baseUrl.label" },
      { baseUrl: "https://a" },
    );

    const input = screen.getByDisplayValue("https://a");
    fireEvent.change(input, { target: { value: "https://b" } });

    expect(setValue).toHaveBeenCalledWith("baseUrl", "https://b");
  });

  it("renders a number with its declared bounds", () => {
    const { setValue } = renderField(
      { key: "retries", type: "number", labelKey: "k", min: 0, max: 5 },
      { retries: 2 },
    );

    const input = screen.getByDisplayValue("2") as HTMLInputElement;
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("5");

    fireEvent.change(input, { target: { value: "4" } });
    expect(setValue).toHaveBeenCalledWith("retries", 4);
  });

  it("clears a number to null rather than to zero", () => {
    const { setValue } = renderField(
      { key: "retries", type: "number", labelKey: "k" },
      { retries: 2 },
    );

    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "" } });

    expect(setValue).toHaveBeenCalledWith("retries", null);
  });

  it("renders a textarea", () => {
    const { setValue } = renderField(
      { key: "notes", type: "textarea", labelKey: "k" },
      { notes: "hello" },
    );

    fireEvent.change(screen.getByDisplayValue("hello"), {
      target: { value: "goodbye" },
    });

    expect(setValue).toHaveBeenCalledWith("notes", "goodbye");
  });

  it("renders json as editable text", () => {
    renderField({ key: "raw", type: "json", labelKey: "k" }, { raw: { a: 1 } });

    expect(screen.getByDisplayValue(/"a": 1/)).toBeTruthy();
  });

  it("renders a multiselect option per choice and reports a selection", () => {
    const { setValue } = renderField(
      {
        key: "tags",
        type: "multiselect",
        labelKey: "k",
        options: [
          { value: "a", labelKey: "opt.a" },
          { value: "b", labelKey: "opt.b" },
        ],
      },
      { tags: ["a"] },
    );

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);

    fireEvent.click(boxes[1]);
    expect(setValue).toHaveBeenCalledWith("tags", ["a", "b"]);
  });

  it("removes a multiselect value when unticked", () => {
    const { setValue } = renderField(
      {
        key: "tags",
        type: "multiselect",
        labelKey: "k",
        options: [
          { value: "a", labelKey: "opt.a" },
          { value: "b", labelKey: "opt.b" },
        ],
      },
      { tags: ["a", "b"] },
    );

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(setValue).toHaveBeenCalledWith("tags", ["b"]);
  });

  it("disables every control while the plugin is not running", () => {
    renderField(
      { key: "baseUrl", type: "string", labelKey: "k" },
      { baseUrl: "https://a" },
      { running: false },
    );

    expect(
      (screen.getByDisplayValue("https://a") as HTMLInputElement).disabled,
    ).toBe(true);
  });
});

describe("secrets", () => {
  const field: PluginSettingsField = {
    key: "apiKey",
    type: "secret",
    labelKey: "apiKey.label",
  };

  it("shows a stored secret as set, without its value", () => {
    renderField(field, { apiKey: { set: true } });

    expect(screen.getByText("settings.secretSet")).toBeTruthy();
    expect(document.body.textContent).not.toContain("tskey");
  });

  it("shows an unset secret as not set", () => {
    renderField(field, { apiKey: { set: false } });

    expect(screen.getByText("settings.secretNotSet")).toBeTruthy();
  });

  it("switches to an input when replacing", () => {
    const { setValue } = renderField(field, { apiKey: { set: true } });

    fireEvent.click(screen.getByText("settings.secretReplace"));

    expect(setValue).toHaveBeenCalledWith("apiKey", "");
  });

  it("takes a new value once editing", () => {
    const { setValue } = renderField(field, { apiKey: "" });

    // A password input has no textbox role, so it is found by its type.
    const input = document.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tskey-new" } });

    expect(setValue).toHaveBeenCalledWith("apiKey", "tskey-new");
  });

  it("restores the redacted marker on cancel, so saving changes nothing", () => {
    const { setValue } = renderField(field, { apiKey: "half-typed" });

    fireEvent.click(screen.getByText("common.cancel"));

    expect(setValue).toHaveBeenCalledWith("apiKey", { set: false });
  });
});

describe("custom fields", () => {
  it("renders a registered component", () => {
    registerSettingsComponent("sample", "devices", () => (
      <div>custom-component-here</div>
    ));

    renderField({ key: "devices", type: "custom", component: "devices" });

    expect(screen.getByText("custom-component-here")).toBeTruthy();
  });

  it("renders nothing when no component is registered", () => {
    const { container } = render(
      <SettingsFieldRow
        pluginId="sample"
        field={{ key: "devices", type: "custom", component: "missing" }}
        values={{}}
        setValue={vi.fn()}
        running
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("keeps two plugins' components apart", () => {
    registerSettingsComponent("sample", "shared", () => <div>mine</div>);
    registerSettingsComponent("other", "shared", () => <div>theirs</div>);

    renderField({ key: "shared", type: "custom", component: "shared" });

    expect(screen.getByText("mine")).toBeTruthy();
    expect(screen.queryByText("theirs")).toBeNull();
  });
});

describe("errors", () => {
  it("shows a per-field message from a rejected save", () => {
    render(
      <SettingsFieldRow
        pluginId="sample"
        field={{ key: "retries", type: "number", labelKey: "k" }}
        values={{ retries: 99 }}
        setValue={vi.fn()}
        running
        error='"retries" must be at most 5'
      />,
    );

    expect(screen.getByText('"retries" must be at most 5')).toBeTruthy();
  });
});

describe("isFieldActive", () => {
  const gated: PluginSettingsField = {
    key: "socketPath",
    type: "string",
    labelKey: "k",
    requires: "enableDocker",
  };

  it("is inactive while the named boolean is off", () => {
    expect(isFieldActive(gated, { enableDocker: false })).toBe(false);
    expect(isFieldActive(gated, {})).toBe(false);
  });

  it("is active once the named boolean is on", () => {
    expect(isFieldActive(gated, { enableDocker: true })).toBe(true);
  });

  it("is always active without a requires", () => {
    expect(isFieldActive({ key: "a", type: "string", labelKey: "k" }, {})).toBe(
      true,
    );
  });
});
