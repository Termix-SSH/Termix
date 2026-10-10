import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/main-axios", () => ({
  getHostAccess: vi.fn(async () => ({ accessList: [] })),
  getUserList: vi.fn(async () => ({
    users: [
      { userId: "me", username: "admin" },
      { userId: "u2", username: "bob" },
    ],
  })),
  getUserInfo: vi.fn(async () => ({ userId: "me", username: "admin" })),
  getRoles: vi.fn(async () => ({ roles: [] })),
  shareHost: vi.fn(),
  shareFolder: vi.fn(),
  updateHostAccess: vi.fn(),
  revokeHostAccess: vi.fn(),
}));

import { SurfaceScope } from "@/components/surface/surface-scope";
import { HostShareModal } from "@/sidebar/HostShareModal";
import type { Host } from "@/types/ui-types";

describe("HostShareModal", () => {
  it("does not offer the current user as someone to share with", async () => {
    render(
      <SurfaceScope>
        <HostShareModal
          open
          onClose={() => {}}
          host={{ id: 1, name: "web" } as unknown as Host}
        />
      </SurfaceScope>,
    );
    expect(await screen.findByText("bob")).toBeTruthy();
    expect(screen.queryByText("admin")).toBeNull();
  });
});
