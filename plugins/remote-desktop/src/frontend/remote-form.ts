import type { HostEditorSectionProps } from "@termix/plugin-sdk/frontend";
import { PLUGIN_ID, remoteOptions } from "./host-remote";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The host editor fields the RDP, VNC and Telnet tabs edit. The logins are
 * core host fields; the options (ports, security, guacd settings) are this
 * plugin's host settings, presented here under the names the tabs use.
 */
export interface RemoteDesktopForm {
  domain: string;
  security: string;
  ignoreCert: boolean;
  rdpPort: number;
  vncPort: number;
  telnetPort: number;
  guacamoleConfig: Record<string, any>;
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
};

type PluginSettingsBag = Record<string, Record<string, unknown>>;

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

export function remoteDesktopForm(props: HostEditorSectionProps): {
  form: RemoteDesktopForm;
  setField: RemoteFormSetField;
  setGuacField: (key: string, value: unknown) => void;
} {
  const bag = props.form?.pluginSettings as PluginSettingsBag | undefined;
  const options = remoteOptions(bag?.[PLUGIN_ID]);
  const form: RemoteDesktopForm = {
    ...(props.form as RemoteDesktopForm),
    rdpPort: options.rdpPort,
    vncPort: options.vncPort,
    telnetPort: options.telnetPort,
    security: options.rdpSecurity,
    ignoreCert: options.rdpIgnoreCert,
    guacamoleConfig: options.guacamoleConfig as Record<string, any>,
  };

  const setField: RemoteFormSetField = (key, value) => {
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
