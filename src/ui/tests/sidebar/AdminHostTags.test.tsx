import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const getHostTags = vi.fn();
const saveHostTags = vi.fn();

vi.mock("@/api/host-tags-api", () => ({
  getHostTags: () => getHostTags(),
  saveHostTags: (tags: string[]) => saveHostTags(tags),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { AdminHostTags } from "@/sidebar/AdminHostTags";

describe("AdminHostTags", () => {
  beforeEach(() => {
    getHostTags.mockReset().mockResolvedValue(["prod"]);
    saveHostTags.mockReset().mockImplementation(async (tags) => tags);
  });

  it("adds a tag on space and saves the list", async () => {
    render(<AdminHostTags />);
    await screen.findByText("prod");
    const input = screen.getByLabelText("admin.hostTags");
    await waitFor(() =>
      expect((input as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.change(input, { target: { value: "web" } });
    fireEvent.keyDown(input, { key: " " });
    await screen.findByText("web");
    expect(saveHostTags).toHaveBeenCalledWith(["prod", "web"]);
  });

  it("removes a tag and saves the list", async () => {
    render(<AdminHostTags />);
    await screen.findByText("prod");
    fireEvent.click(screen.getByLabelText("common.remove"));
    await waitFor(() => expect(screen.queryByText("prod")).toBeNull());
    expect(saveHostTags).toHaveBeenCalledWith([]);
  });
});
