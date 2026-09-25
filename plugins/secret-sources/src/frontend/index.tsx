import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { SecretSourceManager } from "./SecretSourceManager";
import { SecretReferenceHint } from "./SecretReferenceHint";

export function activate(app: TermixApp): void {
  app.registerComponent("credentials.secretHint", SecretReferenceHint);
  app.registerComponent("credentials.secretManager", SecretSourceManager);
}
