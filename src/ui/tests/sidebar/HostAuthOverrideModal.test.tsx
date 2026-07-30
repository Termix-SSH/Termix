import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@/types/ui-types";

const api = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getHostAuthOverride: vi.fn(),
  setHostAuthOverride: vi.fn(),
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/main-axios", () => api);
vi.mock("sonner", () => ({ toast }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { HostAuthOverrideModal } from "../../sidebar/HostAuthOverrideModal";
import { canOverrideHostAuth } from "../../sidebar/host-permissions";

const host = {
  id: "42",
  name: "Shared production",
  isShared: true,
  enableSsh: true,
  authOverrides: {
    ssh: {
      required: true,
      ownerAuthShared: false,
    },
  },
} as Host;

beforeEach(() => {
  api.getCredentials.mockReset();
  api.getHostAuthOverride.mockReset();
  api.setHostAuthOverride.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.getCredentials.mockResolvedValue([
    {
      id: 7,
      name: "Personal key",
      username: "alice",
      authType: "key",
    },
    {
      id: 8,
      name: "Fallback password",
      username: "alice",
      authType: "password",
    },
  ]);
  api.getHostAuthOverride.mockResolvedValue({ credentialId: 7 });
  api.setHostAuthOverride.mockResolvedValue({
    success: true,
    credentialId: 8,
  });
});

afterEach(cleanup);

describe("HostAuthOverrideModal", () => {
  it("loads the current selection and saves another owned credential", async () => {
    const onOpenChange = vi.fn();
    render(
      <HostAuthOverrideModal
        open
        onOpenChange={onOpenChange}
        host={host}
        protocol="ssh"
      />,
    );

    const select = await screen.findByLabelText(
      "hosts.sharing.authOverrideCredentialLabel",
    );
    expect((select as HTMLSelectElement).value).toBe("7");

    fireEvent.change(select, { target: { value: "8" } });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => {
      expect(api.getHostAuthOverride).toHaveBeenCalledWith(42, "ssh");
      expect(api.setHostAuthOverride).toHaveBeenCalledWith(42, "ssh", 8);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("clears the personal credential and explains when one is required", async () => {
    render(
      <HostAuthOverrideModal
        open
        onOpenChange={() => {}}
        host={host}
        protocol="ssh"
      />,
    );

    const select = await screen.findByLabelText(
      "hosts.sharing.authOverrideCredentialLabel",
    );
    expect(screen.getByText("hosts.sharing.noPersonalCredential")).toBeTruthy();
    fireEvent.change(select, { target: { value: "" } });
    expect(screen.getByText("hosts.sharing.authOverrideRequired")).toBeTruthy();
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() => {
      expect(api.setHostAuthOverride).toHaveBeenCalledWith(42, "ssh", null);
    });
  });

  it("offers the preexisting shared authentication when the owner enables it", async () => {
    render(
      <HostAuthOverrideModal
        open
        onOpenChange={() => {}}
        host={{
          ...host,
          shareSshAuth: true,
          authOverrides: {
            ssh: {
              required: false,
              ownerAuthShared: true,
            },
          },
        }}
        protocol="ssh"
      />,
    );

    await screen.findByLabelText("hosts.sharing.authOverrideCredentialLabel");
    expect(
      screen.getByText("hosts.sharing.useSharedAuthentication"),
    ).toBeTruthy();
    expect(
      screen.getByText("hosts.sharing.authOverrideDescriptionShared"),
    ).toBeTruthy();
  });

  it("renders empty and load-error states", async () => {
    api.getCredentials.mockResolvedValueOnce([]);
    const { unmount } = render(
      <HostAuthOverrideModal
        open
        onOpenChange={() => {}}
        host={host}
        protocol="ssh"
      />,
    );
    expect(
      await screen.findByText("hosts.sharing.authOverrideNoCredentials"),
    ).toBeTruthy();
    unmount();

    api.getCredentials.mockRejectedValueOnce(new Error("offline"));
    render(
      <HostAuthOverrideModal
        open
        onOpenChange={() => {}}
        host={host}
        protocol="ssh"
      />,
    );
    expect(
      await screen.findByText("hosts.sharing.authOverrideLoadError"),
    ).toBeTruthy();
  });
});

describe("canOverrideHostAuth", () => {
  it("allows every shared SSH permission level and excludes owners and non-SSH hosts", () => {
    for (const permissionLevel of [
      "connect",
      "view",
      "edit",
      "manage",
    ] as const) {
      expect(
        canOverrideHostAuth({ ...host, permissionLevel } as Host, "ssh"),
      ).toBe(true);
    }
    expect(
      canOverrideHostAuth({ ...host, isShared: false } as Host, "ssh"),
    ).toBe(false);
    expect(
      canOverrideHostAuth({ ...host, enableSsh: false } as Host, "ssh"),
    ).toBe(false);
    expect(
      canOverrideHostAuth({ ...host, enableRdp: true } as Host, "rdp"),
    ).toBe(false);
  });
});
