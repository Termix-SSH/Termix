import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataView, type DataColumn } from "@/components/data-view";

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

  it("uses the picked size over breakpoint columns", () => {
    const { container } = render(
      <DataView
        items={items}
        view="grid"
        getKey={(item) => item.id}
        renderCard={(item) => <div>card {item.name}</div>}
        columns={{ base: 1, md: 2 }}
        size="3"
        listColumns={[]}
        empty={null}
      />,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).not.toContain("md:grid-cols-2");
    expect(grid.style.gridTemplateColumns).toContain("/ 3");
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

describe("list grid", () => {
  const listColumns: DataColumn<(typeof items)[number]>[] = [
    { key: "a", header: "A", width: "1fr", cell: (item) => `a ${item.name}` },
    {
      key: "b",
      header: "B",
      width: "90px",
      hideBelow: "md",
      cell: (item) => `b ${item.name}`,
    },
    { key: "c", header: "C", width: "2fr", cell: (item) => `c ${item.name}` },
    {
      key: "d",
      header: "D",
      width: "70px",
      hideBelow: "lg",
      cell: (item) => `d ${item.name}`,
    },
    {
      key: "e",
      header: "E",
      width: "minmax(0,1.2fr)",
      hideBelow: "md",
      cell: (item) => `e ${item.name}`,
    },
  ];

  function renderList(density?: "compact", columns = listColumns) {
    render(
      <DataView
        items={items}
        view="list"
        density={density}
        getKey={(item) => item.id}
        renderCard={() => null}
        columns={{}}
        listColumns={columns}
        empty={null}
      />,
    );
    const root = screen.getByRole("table");
    const header = root.children[0] as HTMLElement;
    const rows = Array.from(root.children[1].children) as HTMLElement[];
    return { root, header, rows };
  }

  it("sets container templates using only columns visible at each breakpoint", () => {
    const { root } = renderList();

    expect(root.style.getPropertyValue("--data-view-cols")).toBe("1fr 2fr");
    expect(root.style.getPropertyValue("--data-view-cols-md")).toBe(
      "1fr 90px 2fr minmax(0,1.2fr)",
    );
    expect(root.style.getPropertyValue("--data-view-cols-lg")).toBe(
      "1fr 90px 2fr 70px minmax(0,1.2fr)",
    );
    expect(root.classList.contains("@container")).toBe(true);
  });

  it("shares grid classes between the header and every body row", () => {
    const { header, rows } = renderList();
    const expectedGridClasses = [
      "grid",
      "grid-cols-[var(--data-view-cols)]",
      "@min-[48rem]:grid-cols-[var(--data-view-cols-md)]",
      "@min-[64rem]:grid-cols-[var(--data-view-cols-lg)]",
      "gap-x-2",
    ].sort();

    expect(rows).toHaveLength(items.length);
    for (const row of [header, ...rows]) {
      const gridClasses = Array.from(row.classList).filter(
        (className) =>
          className === "grid" ||
          className.includes("grid-cols-") ||
          className.startsWith("gap-x-"),
      );
      expect(gridClasses.sort()).toEqual(expectedGridClasses);
      expect(row.style.gridTemplateColumns).toBe("");
    }
  });

  it("uses container-query visibility for cells and their headers", () => {
    const { header, rows } = renderList();

    for (const row of [header, ...rows]) {
      for (const index of [1, 4]) {
        expect(row.children[index].classList.contains("hidden")).toBe(true);
        expect(
          row.children[index].classList.contains("@min-[48rem]:block"),
        ).toBe(true);
      }
      expect(row.children[3].classList.contains("hidden")).toBe(true);
      expect(row.children[3].classList.contains("@min-[64rem]:block")).toBe(
        true,
      );
      for (const index of [0, 2]) {
        expect(row.children[index].classList.contains("hidden")).toBe(false);
      }
    }
  });

  it("uses a minimum height for compact rows without a fixed height", () => {
    const { rows } = renderList("compact");

    for (const row of rows) {
      expect(row.classList.contains("min-h-7")).toBe(true);
      expect(row.classList.contains("h-7")).toBe(false);
    }
  });

  it("uses the default row minimum height when density is omitted", () => {
    const { rows } = renderList();

    for (const row of rows) {
      expect(row.classList.contains("min-h-9")).toBe(true);
    }
  });

  it("uses no base tracks when every column is hidden at the base width", () => {
    const { root } = renderList(undefined, [
      listColumns[1],
      listColumns[3],
      listColumns[4],
    ]);

    expect(root.style.getPropertyValue("--data-view-cols")).toBe("none");
  });
});
