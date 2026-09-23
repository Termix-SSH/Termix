import type { ComponentType } from "react";
import { createRegistry } from "@/lib/registry";

/**
 * Auth UI plugins contribute.
 *
 * SSH auth editors are live: the host editor lists registered auth types next
 * to the core ones (password, key, credential, agent, none) and renders the
 * plugin's editor when one is picked. Login methods and second factors are
 * declared here so the app object is complete; A8 wires them into the login
 * screen.
 */
export interface SshAuthEditorDef {
  /** The authType value stored on the host. */
  id: string;
  pluginId?: string;
  titleKey: string;
  hintKey?: string;
  component?: ComponentType<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form: any;
    setField: (key: string, value: unknown) => void;
  }>;
}

export interface LoginMethodDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  icon?: ComponentType<{ className?: string }>;
  component: ComponentType<Record<string, unknown>>;
}

export interface SecondFactorDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  component: ComponentType<Record<string, unknown>>;
}

const sshAuthEditors = createRegistry<SshAuthEditorDef>();
const loginMethods = createRegistry<LoginMethodDef>();
const secondFactors = createRegistry<SecondFactorDef>();

export const registerSshAuthEditor = sshAuthEditors.register;
export const getSshAuthEditor = sshAuthEditors.get;
export const useSshAuthEditors = sshAuthEditors.useList;

export const registerLoginMethod = loginMethods.register;
export const useLoginMethods = loginMethods.useList;

export const registerSecondFactor = secondFactors.register;
export const useSecondFactors = secondFactors.useList;

export function resetAuthRegistries(): void {
  sshAuthEditors.reset();
  loginMethods.reset();
  secondFactors.reset();
}
