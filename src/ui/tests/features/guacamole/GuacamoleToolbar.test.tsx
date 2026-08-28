import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuacamoleToolbar } from "../../../features/guacamole/GuacamoleToolbar.js";
import type { GuacamoleDisplayHandle } from "../../../features/guacamole/GuacamoleDisplay.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("GuacamoleToolbar Windows key", () => {
  it("sends Super_L for Win shortcuts and the sticky modifier", () => {
    const sendKey = vi.fn();
    const displayRef = {
      current: {
        disconnect: vi.fn(),
        isConnected: () => true,
        sendKey,
        sendMouse: vi.fn(),
        setClipboard: vi.fn(),
        getFilesystem: () => null,
        uploadFile: async () => {},
        zoomIn: vi.fn(() => 1.25),
        zoomOut: vi.fn(() => 0.75),
        resetZoom: vi.fn(() => 1),
      } satisfies GuacamoleDisplayHandle,
    } as React.RefObject<GuacamoleDisplayHandle>;
    const { getByText } = render(
      <GuacamoleToolbar displayRef={displayRef} protocol="rdp" />,
    );

    fireEvent.click(getByText("Win+L"));
    expect(sendKey.mock.calls).toEqual([
      [0xffeb, true],
      [0x006c, true],
      [0x006c, false],
      [0xffeb, false],
    ]);

    sendKey.mockClear();
    fireEvent.click(getByText("Win"));
    expect(sendKey.mock.calls).toEqual([
      [0xffeb, true],
      [0xffeb, false],
    ]);

    sendKey.mockClear();
    fireEvent.click(getByText("guacamole.toolbar.win"));
    expect(sendKey).toHaveBeenCalledWith(0xffeb, true);
  });

  it("exposes VNC zoom controls without showing them for RDP", () => {
    const zoomIn = vi.fn(() => 1.25);
    const zoomOut = vi.fn(() => 0.75);
    const resetZoom = vi.fn(() => 1);
    const displayRef = {
      current: {
        disconnect: vi.fn(),
        isConnected: () => true,
        sendKey: vi.fn(),
        sendMouse: vi.fn(),
        setClipboard: vi.fn(),
        getFilesystem: () => null,
        uploadFile: async () => {},
        zoomIn,
        zoomOut,
        resetZoom,
      } satisfies GuacamoleDisplayHandle,
    } as React.RefObject<GuacamoleDisplayHandle>;
    const { getByLabelText, getByText } = render(
      <GuacamoleToolbar displayRef={displayRef} protocol="vnc" zoom={1.25} />,
    );

    fireEvent.click(getByLabelText("guacamole.toolbar.zoomOut"));
    fireEvent.click(getByLabelText("guacamole.toolbar.zoomIn"));
    fireEvent.click(getByText("125%"));
    expect(zoomOut).toHaveBeenCalledOnce();
    expect(zoomIn).toHaveBeenCalledOnce();
    expect(resetZoom).toHaveBeenCalledOnce();
  });
});
