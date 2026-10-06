import { createContext, useContext } from "react";
import type { OnboardingPluginList } from "@/api/plugins-api";

export interface OnboardingStageValue {
  /** Fetched by the boot gate for admins; null means fetch on demand. */
  plugins: OnboardingPluginList | null;
  setPlugins: (list: OnboardingPluginList) => void;
}

export const OnboardingStageContext =
  createContext<OnboardingStageValue | null>(null);

export function useOnboardingStage(): OnboardingStageValue | null {
  return useContext(OnboardingStageContext);
}
