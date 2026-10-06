import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { CapabilityRow } from "@/plugins/plugin-bits";

afterEach(cleanup);

describe("CapabilityRow", () => {
  it("resolves capability ids that contain a colon", async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      lng: "en",
      resources: {
        en: {
          translation: {
            plugins: {
              capabilities: {
                "users:impersonate": {
                  title: "Act as other users",
                  consequence: "It can do anything a user can.",
                },
              },
            },
          },
        },
      },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <CapabilityRow capability="users:impersonate" />
      </I18nextProvider>,
    );

    expect(screen.getByText("Act as other users")).toBeTruthy();
    expect(screen.getByText("It can do anything a user can.")).toBeTruthy();
  });
});
