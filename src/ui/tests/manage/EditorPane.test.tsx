import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { EditorPane, EditorSection, LazySection } from "@/manage/EditorPane";
import { Field } from "@/components/form-fields";
import { HIDDEN_ATTR } from "@/settings/page-filter";

afterEach(cleanup);

function renderEditor() {
  return render(
    <EditorPane
      bands={[
        {
          id: "main",
          label: "Main",
          items: [
            { id: "general", label: "General" },
            { id: "terminal", label: "Terminal" },
          ],
        },
      ]}
    >
      <EditorSection id="general" label="General">
        <Field label="Address">
          <input />
        </Field>
        <Field label="Port">
          <input />
        </Field>
      </EditorSection>
      <EditorSection id="terminal" label="Terminal">
        <LazySection>
          <Field label="Font size">
            <input />
          </Field>
        </LazySection>
      </EditorSection>
    </EditorPane>,
  );
}

const hidden = (el: Element | null) => !!el?.closest(`[${HIDDEN_ATTR}]`);

describe("EditorPane search", () => {
  it("filters sections and fields, and hides their nav entries", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("manage.searchSettings"), {
      target: { value: "port" },
    });

    await waitFor(() => {
      expect(hidden(screen.getByText("Port"))).toBe(false);
      expect(hidden(screen.getByText("Address"))).toBe(true);
      expect(hidden(document.querySelector('[data-section="terminal"]'))).toBe(
        true,
      );
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Terminal" })).toBeNull(),
    );
  });

  it("mounts lazy sections so their fields can be found", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("manage.searchSettings"), {
      target: { value: "font" },
    });
    await waitFor(() => {
      expect(hidden(screen.getByText("Font size"))).toBe(false);
      expect(hidden(document.querySelector('[data-section="general"]'))).toBe(
        true,
      );
    });
  });
});
