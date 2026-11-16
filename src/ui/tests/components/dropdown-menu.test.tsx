import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";

afterEach(cleanup);

describe("DropdownMenuSubContent", () => {
  it("renders outside the parent menu so its scroll area can't clip it", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Tools</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>Send key</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Ctrl+Q</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByText("Ctrl+Q");
    const parent = document.querySelector(
      '[data-slot="dropdown-menu-content"]',
    );
    expect(parent).toBeTruthy();
    expect(parent!.contains(item)).toBe(false);
  });
});
