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
});
