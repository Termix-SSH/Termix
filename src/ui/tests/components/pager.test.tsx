import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Pager, pageOf, usePaged } from "../../components/pager";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

describe("pageOf", () => {
  it("clamps the page to what exists", () => {
    const items = [1, 2, 3, 4, 5];
    expect(pageOf(items, 9, 2)).toEqual({ rows: [5], page: 2, pages: 3 });
    expect(pageOf([], 0, 2)).toEqual({ rows: [], page: 0, pages: 1 });
  });
});

describe("usePaged", () => {
  it("goes back to the first page when reset changes", () => {
    const { result, rerender } = renderHook(
      ({ reset }) => usePaged([1, 2, 3], 1, reset),
      { initialProps: { reset: "a" } },
    );
    act(() => result.current.setPage(2));
    expect(result.current.rows).toEqual([3]);
    rerender({ reset: "b" });
    expect(result.current.page).toBe(0);
  });
});

describe("Pager", () => {
  it("hides with one page", () => {
    const { container } = render(
      <Pager page={0} pages={1} onPage={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("moves between pages", () => {
    const onPage = vi.fn();
    render(<Pager page={0} pages={3} onPage={onPage} />);
    expect(screen.getByText("panel.pager.previous")).toBeDisabled();
    fireEvent.click(screen.getByText("panel.pager.next"));
    expect(onPage).toHaveBeenCalledWith(1);
  });
});
