import { BUILTIN_LAYOUT_ID, registerLayout } from "@/look/layout-registry";
import { DefaultLayout } from "./DefaultLayout";

let registered = false;

/** Core's own layout, there whatever plugins are installed. */
export function registerBuiltinLayout(): void {
  if (registered) return;
  registered = true;
  registerLayout({ id: BUILTIN_LAYOUT_ID, component: DefaultLayout });
}
