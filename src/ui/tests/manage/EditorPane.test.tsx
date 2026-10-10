import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import {
  EditorPane,
  EditorSection,
  LazySection,
  useScrollSpy,
} from "@/manage/EditorPane";
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

describe("useScrollSpy scrollTo", () => {
  it("follows a section that moves while the form is still mounting", async () => {
    const container = document.createElement("div");
    const section = document.createElement("div");
    section.dataset.section = "rdp";
    container.appendChild(section);
    document.body.appendChild(container);
    let sectionTop = 300;
    section.getBoundingClientRect = () => ({ top: sectionTop }) as DOMRect;
    container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const calls: number[] = [];
    container.scrollTo = ((options: ScrollToOptions) => {
      calls.push(options.top ?? 0);
    }) as typeof container.scrollTo;

    const ref = { current: container };
    const { result } = renderHook(() => useScrollSpy(ref, ["general", "rdp"]));
    act(() => result.current.scrollTo("rdp"));
    expect(calls).toEqual([292]);

    sectionTop = 900;
    await waitFor(() => expect(calls).toContain(892));
    container.remove();
  });
});
