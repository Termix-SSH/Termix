import type { TermixApp } from "@termix/plugin-sdk/frontend";
import { SecretSourceManager } from "./SecretSourceManager";
import { SecretReferenceHint } from "./SecretReferenceHint";

export function activate(app: TermixApp): void {
  app.registerComponent("secret-sources.hint", SecretReferenceHint);
  app.registerComponent("secret-sources.manager", SecretSourceManager);
}
