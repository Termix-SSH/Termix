import { describe, expect, it } from "vitest";
import type { HostEditorSectionProps } from "@termix/plugin-sdk/frontend";
import {
  loginOf,
  patchLogin,
  remoteDesktopForm,
} from "../../src/frontend/remote-form";

function sectionProps(form: Record<string, unknown>) {
  const state = { form: { ...form } };
  const props = {
    form: state.form,
    setField: (key: string, value: unknown) => {
      state.form = { ...state.form, [key]: value };
    },
    updateForm: (
      patch: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      state.form = { ...state.form, ...patch(state.form) };
    },
  } as unknown as HostEditorSectionProps;
  return { props, state };
}

describe("remote desktop editor form", () => {
  it("reads each protocol's login from the host form's protocolAuth", () => {
    const { props } = sectionProps({
      protocolAuth: {
        rdp: {
          authType: "credential",
          credentialId: "4",
          username: "",
          password: "",
          fields: { domain: "CORP" },
        },
        vnc: {
          authType: "direct",
          credentialId: "",
          username: "",
          password: "saved",
          fields: {},
        },
      },
    });
    const { form } = remoteDesktopForm(props);
    expect(form).toMatchObject({
      rdpAuthType: "credential",
      rdpCredentialId: "4",
      domain: "CORP",
      vncPassword: "saved",
      telnetAuthType: "direct",
      telnetUser: "",
    });
  });

  it("writes the tabs' login fields into protocolAuth", () => {
    const { props, state } = sectionProps({});
    const { setField } = remoteDesktopForm(props);
    setField("rdpUser", "admin");
    setField("domain", "CORP");
    setField("telnetAuthType", "credential");

    expect(state.form.protocolAuth).toEqual({
      rdp: {
        authType: "direct",
        credentialId: "",
        username: "admin",
        password: "",
        fields: { domain: "CORP" },
      },
      telnet: {
        authType: "credential",
        credentialId: "",
        username: "",
        password: "",
        fields: {},
      },
    });
  });

  it("keeps other protocols when one changes", () => {
    const current = {
      protocolAuth: { vnc: { ...loginOf(undefined, "vnc"), username: "v" } },
    };
    const next = patchLogin(current, "rdp", "password", "pw");
    expect(next.protocolAuth).toMatchObject({
      vnc: { username: "v" },
      rdp: { password: "pw" },
    });
  });
});
