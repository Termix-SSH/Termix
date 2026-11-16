import type { ComponentType } from "react";
import type {
  LoginMethodUIProps,
  SecondFactorUIProps,
} from "@termix-ssh/plugin-sdk/frontend";
import { createRegistry } from "@/lib/registry";
import {
  declareActionSlot,
  registerSlotContribution,
} from "@/shell/action-registry";

/**
 * Every enrolment screen is also offered in this slot, so a framed plugin
 * that names it in contributes.uses (a login policy asking someone to set up
 * a second factor) can show them through the shell.
 */
export const ENROLLMENT_SLOT = "auth.enrollment";
declareActionSlot({
  id: ENROLLMENT_SLOT,
  accepts: ["component"],
  fit: "content",
});

function withEnrollmentSlot<
  T extends {
    id: string;
    pluginId?: string;
    titleKey: string;
    enrollment?: ComponentType<Record<string, unknown>>;
  },
>(register: (entry: T) => () => void, kind: "method" | "factor") {
  return (entry: T): (() => void) => {
    const drop = register(entry);
    if (!entry.enrollment) return drop;
    const dropSlot = registerSlotContribution(ENROLLMENT_SLOT, {
      actionId: `${entry.pluginId ?? "core"}.enrollment.${kind}.${entry.id}`,
      titleKey: entry.titleKey,
      kind: "component",
      component: entry.enrollment,
      pluginId: entry.pluginId,
      order: kind === "factor" ? 1 : 0,
    });
    return () => {
      dropSlot();
      drop();
    };
  };
}

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
  /**
   * Only for a plugin running in the page. Without one the login screen
   * draws the method from what the server describes.
   */
  component?: ComponentType<LoginMethodUIProps>;
  /** Also drawn under the password form. */
  placement?: "inline";
  enrollment?: ComponentType<Record<string, unknown>>;
}

export interface SecondFactorDef {
  id: string;
  pluginId?: string;
  titleKey: string;
  /** Only for a plugin running in the page; see LoginMethodDef. */
  component?: ComponentType<SecondFactorUIProps>;
  enrollment?: ComponentType<Record<string, unknown>>;
}

const sshAuthEditors = createRegistry<SshAuthEditorDef>();
const loginMethods = createRegistry<LoginMethodDef>();
const secondFactors = createRegistry<SecondFactorDef>();

export const registerSshAuthEditor = sshAuthEditors.register;
export const useSshAuthEditors = sshAuthEditors.useList;

export const registerLoginMethod = withEnrollmentSlot(
  loginMethods.register,
  "method",
);
export const getLoginMethodUI = loginMethods.get;
export const useLoginMethods = loginMethods.useList;
export const listLoginMethodUIs = loginMethods.list;

export const registerSecondFactor = withEnrollmentSlot(
  secondFactors.register,
  "factor",
);
export const getSecondFactorUI = secondFactors.get;
export const useSecondFactors = secondFactors.useList;
export const listSecondFactorUIs = secondFactors.list;
