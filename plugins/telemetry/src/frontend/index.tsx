import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { TelemetryStatusSetting } from "./TelemetryStatusSetting";
import { startTabTracker } from "./tracker";

export function activate(app: TermixApp): void {
  app.registerSettingsComponent("status", TelemetryStatusSetting);
  if (!app.guest) app.onDispose(startTabTracker(app));
}

export function deactivate(): void {
  // Registrations through app are disposed by core.
}
