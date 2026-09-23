import type { ComponentType } from "react";
import type {
  LoginMethodUIProps,
  SecondFactorUIProps,
} from "@termix/plugin-sdk/frontend";
import { createRegistry } from "@/lib/registry";

/**
 * Auth UI plugins contribute.
 *
 * SSH auth editors render in the host and credential editors when their auth
 * type is picked. Login methods render on the login screen for methods the
 * server reports as enabled; second factors render in the step after a first
 * login and, when they bring one, in Settings > Security for enrolment.
 * Core's own (OIDC, LDAP, passkeys, TOTP) register from
 * src/ui/auth/legacy-auth-ui.tsx until they move into plugins.
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
  component: ComponentType<LoginMethodUIProps>;
}

export interface SecondFactorDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  component: ComponentType<SecondFactorUIProps>;
  enrollment?: ComponentType<Record<string, unknown>>;
}

const sshAuthEditors = createRegistry<SshAuthEditorDef>();
const loginMethods = createRegistry<LoginMethodDef>();
const secondFactors = createRegistry<SecondFactorDef>();

export const registerSshAuthEditor = sshAuthEditors.register;
export const getSshAuthEditor = sshAuthEditors.get;
export const useSshAuthEditors = sshAuthEditors.useList;

export const registerLoginMethod = loginMethods.register;
export const getLoginMethodUI = loginMethods.get;
export const useLoginMethods = loginMethods.useList;

export const registerSecondFactor = secondFactors.register;
export const getSecondFactorUI = secondFactors.get;
export const useSecondFactors = secondFactors.useList;

export function resetAuthRegistries(): void {
  sshAuthEditors.reset();
  loginMethods.reset();
  secondFactors.reset();
}
