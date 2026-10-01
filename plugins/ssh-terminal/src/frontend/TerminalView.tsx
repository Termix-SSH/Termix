import { Suspense, lazy, type Ref } from "react";
import type { TerminalHandle } from "./terminal/terminal-types";

const CommandHistoryProvider = lazy(() =>
  import("./terminal/command-history/CommandHistoryContext").then((m) => ({
    default: m.CommandHistoryProvider,
  })),
);
const Terminal = lazy(() =>
  import("./terminal/Terminal").then((m) => ({ default: m.Terminal })),
);

/**
 * The terminal as other code embeds it, registered as "terminal.view".
 *
 * Props are the terminal's own (hostConfig, isVisible, title, splitScreen,
 * executeCommand and the rest), plus `handleRef` for the TerminalHandle
 * (connect, disconnect, sendInput, fit), since a registered component cannot
 * take a React ref across the plugin boundary.
 */
export function TerminalView({
  handleRef,
  ...props
}: {
  handleRef?: Ref<TerminalHandle>;
  [prop: string]: unknown;
}) {
  return (
    <Suspense fallback={null}>
      <CommandHistoryProvider>
        <Terminal
          ref={handleRef}
          {...(props as unknown as React.ComponentProps<typeof Terminal>)}
        />
      </CommandHistoryProvider>
    </Suspense>
  );
}
