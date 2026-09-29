import type {
  HostEditorSectionProps,
  HostProtocolAuthForm,
} from "@termix/plugin-sdk/frontend";
import { PLUGIN_ID, remoteOptions, type Protocol } from "./host-remote";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The host editor fields the RDP, VNC and Telnet tabs edit. The logins are
 * core's, under form.protocolAuth (this plugin declares the protocols in its
 * manifest); the options (ports, security, guacd settings) are this plugin's
 * host settings. Both are presented here under the names the tabs use.
 */
export interface RemoteDesktopForm {
  domain: string;
  security: string;
  ignoreCert: boolean;
  rdpPort: number;
  vncPort: number;
  telnetPort: number;
  guacamoleConfig: Record<string, any>;
  enableToolbar: boolean;
  rdpAuthType: "direct" | "credential" | "none";
  rdpCredentialId: string;
  rdpUser: string;
  rdpPassword: string;
  vncAuthType: "direct" | "credential";
  vncCredentialId: string;
  vncUser: string;
  vncPassword: string;
  telnetAuthType: "direct" | "credential";
  telnetCredentialId: string;
  telnetUser: string;
  telnetPassword: string;
}

export type RemoteFormSetField = <K extends keyof RemoteDesktopForm>(
  key: K,
  value: RemoteDesktopForm[K],
) => void;

/** Tab field name to this plugin's host setting key. */
const SETTING_FOR_FIELD: Partial<Record<keyof RemoteDesktopForm, string>> = {
  rdpPort: "rdpPort",
  vncPort: "vncPort",
  telnetPort: "telnetPort",
  security: "rdpSecurity",
  ignoreCert: "rdpIgnoreCert",
  enableToolbar: "enableToolbar",
};

type LoginPart = "authType" | "credentialId" | "username" | "password";

/** Tab field name to the protocol login it edits. */
const LOGIN_FOR_FIELD: Partial<
  Record<keyof RemoteDesktopForm, [Protocol, LoginPart | "domain"]>
> = {
  rdpAuthType: ["rdp", "authType"],
  rdpCredentialId: ["rdp", "credentialId"],
  rdpUser: ["rdp", "username"],
  rdpPassword: ["rdp", "password"],
  domain: ["rdp", "domain"],
  vncAuthType: ["vnc", "authType"],
  vncCredentialId: ["vnc", "credentialId"],
  vncUser: ["vnc", "username"],
  vncPassword: ["vnc", "password"],
  telnetAuthType: ["telnet", "authType"],
  telnetCredentialId: ["telnet", "credentialId"],
  telnetUser: ["telnet", "username"],
  telnetPassword: ["telnet", "password"],
};

type PluginSettingsBag = Record<string, Record<string, unknown>>;
type LoginBag = Record<string, HostProtocolAuthForm>;

const EMPTY_LOGIN: HostProtocolAuthForm = {
  authType: "direct",
  credentialId: "",
  username: "",
  password: "",
  fields: {},
};

export function loginOf(
  bag: LoginBag | undefined,
  protocol: Protocol,
): HostProtocolAuthForm {
  const login = bag?.[protocol];
  return login ? { ...EMPTY_LOGIN, ...login } : EMPTY_LOGIN;
}

function patchSettings(
  current: Record<string, unknown>,
  patch: (settings: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const bag = (current.pluginSettings as PluginSettingsBag | undefined) ?? {};
  const mine = bag[PLUGIN_ID] ?? {};
  return {
    pluginSettings: { ...bag, [PLUGIN_ID]: { ...mine, ...patch(mine) } },
  };
}

/** The form patch that sets one part of a protocol's login. */
export function patchLogin(
  current: Record<string, unknown>,
  protocol: Protocol,
  part: LoginPart | "domain",
  value: unknown,
): Record<string, unknown> {
  const bag = (current.protocolAuth as LoginBag | undefined) ?? {};
  const login = loginOf(bag, protocol);
  const next: HostProtocolAuthForm =
    part === "domain"
      ? { ...login, fields: { ...login.fields, domain: String(value ?? "") } }
      : ({ ...login, [part]: value } as HostProtocolAuthForm);
  return { protocolAuth: { ...bag, [protocol]: next } };
}

export function remoteDesktopForm(props: HostEditorSectionProps): {
  form: RemoteDesktopForm;
  setField: RemoteFormSetField;
  setGuacField: (key: string, value: unknown) => void;
} {
  const bag = props.form?.pluginSettings as PluginSettingsBag | undefined;
  const logins = props.form?.protocolAuth as LoginBag | undefined;
  const options = remoteOptions(bag?.[PLUGIN_ID]);
  const rdp = loginOf(logins, "rdp");
  const vnc = loginOf(logins, "vnc");
  const telnet = loginOf(logins, "telnet");
  const form: RemoteDesktopForm = {
    rdpPort: options.rdpPort,
    vncPort: options.vncPort,
    telnetPort: options.telnetPort,
    security: options.rdpSecurity,
    ignoreCert: options.rdpIgnoreCert,
    guacamoleConfig: options.guacamoleConfig as Record<string, any>,
    enableToolbar: options.enableToolbar,
    domain: rdp.fields.domain ?? "",
    rdpAuthType: rdp.authType,
    rdpCredentialId: rdp.credentialId,
    rdpUser: rdp.username,
    rdpPassword: rdp.password,
    vncAuthType: vnc.authType === "credential" ? "credential" : "direct",
    vncCredentialId: vnc.credentialId,
    vncUser: vnc.username,
    vncPassword: vnc.password,
    telnetAuthType: telnet.authType === "credential" ? "credential" : "direct",
    telnetCredentialId: telnet.credentialId,
    telnetUser: telnet.username,
    telnetPassword: telnet.password,
  };

  const setField: RemoteFormSetField = (key, value) => {
    const login = LOGIN_FOR_FIELD[key];
    if (login) {
      props.updateForm((current) =>
        patchLogin(current, login[0], login[1], value),
      );
      return;
    }
    const setting = SETTING_FOR_FIELD[key];
    if (!setting) {
      props.setField(key, value);
      return;
    }
    props.updateForm((current) =>
      patchSettings(current, () => ({ [setting]: value })),
    );
  };

  const setGuacField = (key: string, value: unknown) =>
    props.updateForm((current) =>
      patchSettings(current, (mine) => ({
        guacamoleConfig: {
          ...remoteOptions(mine).guacamoleConfig,
          [key]: value,
        },
      })),
    );

  return { form, setField, setGuacField };
}
