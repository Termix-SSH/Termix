import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataView } from "@/components/data-view";

afterEach(cleanup);

const items = [
  { id: "a", name: "alpha" },
  { id: "b", name: "beta" },
];

function renderView(view: "grid" | "list", onRowClick = vi.fn()) {
  return render(
    <DataView
      items={items}
      view={view}
      density="compact"
      getKey={(item) => item.id}
      renderCard={(item) => <div>card {item.name}</div>}
      columns={{ base: 1, md: 2 }}
      listColumns={[
        { key: "name", header: "Name", width: "1fr", cell: (i) => i.name },
      ]}
      onRowClick={onRowClick}
      empty={<span>nothing</span>}
    />,
  );
}

describe("DataView", () => {
  it("renders cards in grid mode", () => {
    renderView("grid");
    expect(screen.getByText("card alpha")).toBeTruthy();
    expect(screen.queryByText("Name")).toBeNull();
  });

  it("renders a header and clickable rows in list mode", () => {
    const onRowClick = vi.fn();
    renderView("list", onRowClick);
    expect(screen.getByText("Name")).toBeTruthy();
    fireEvent.click(screen.getByText("beta"));
    expect(onRowClick).toHaveBeenCalledWith(items[1]);
  });

  it("shows the empty state with no items", () => {
    render(
      <DataView
        items={[]}
        view="grid"
        getKey={() => ""}
        renderCard={() => null}
        columns={{}}
        listColumns={[]}
        empty={<span>nothing</span>}
      />,
    );
    expect(screen.getByText("nothing")).toBeTruthy();
  });
});
