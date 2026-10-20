/* eslint-disable react-refresh/only-export-components */
import { ShellRoot } from "@/shell/ShellRoot";

export { buildHostTree } from "@/sidebar/build-host-tree";
export { tabIcon, renderTabContent } from "@/shell/tabUtils";

/** The signed-in app. State lives in the shell controller, drawing in the layout. */
export function AppShell({
  username,
  onLogout,
}: {
  username: string;
  onLogout: (options?: { manual?: boolean }) => void;
}) {
  return <ShellRoot username={username} onLogout={onLogout} />;
}
