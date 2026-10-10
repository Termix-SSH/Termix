import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/sync-api", () => ({
  probeServer: vi.fn(),
  getLinkPreview: vi.fn(),
  completeLink: vi.fn(),
  reloginLink: vi.fn(),
}));
vi.mock("@/auth/ElectronLoginForm", () => ({ ElectronLoginForm: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { SurfaceScope } = await import("@/components/surface/surface-scope");
const { LinkServerDialog } = await import("@/settings/sync/LinkServerDialog");

afterEach(cleanup);

describe("LinkServerDialog", () => {
  it("opens inline in the surface instead of a popup", () => {
    render(
      <SurfaceScope kind="tab">
        <LinkServerDialog open onOpenChange={() => {}} onLinked={() => {}} />
      </SurfaceScope>,
    );
    expect(screen.getByText("sync.wizard.title")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
