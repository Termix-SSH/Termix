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
 * login. Either kind may bring an enrolment section for Settings > Security.
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
  /** Also drawn under the password form. */
  placement?: "inline";
  enrollment?: ComponentType<Record<string, unknown>>;
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
export const useSshAuthEditors = sshAuthEditors.useList;

export const registerLoginMethod = loginMethods.register;
export const getLoginMethodUI = loginMethods.get;
export const useLoginMethods = loginMethods.useList;
export const listLoginMethodUIs = loginMethods.list;

export const registerSecondFactor = secondFactors.register;
export const getSecondFactorUI = secondFactors.get;
export const useSecondFactors = secondFactors.useList;
export const listSecondFactorUIs = secondFactors.list;
