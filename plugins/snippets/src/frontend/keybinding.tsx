import {
  useTranslation,
  type KeybindingAction,
  type KeybindingActionEditorProps,
  type KeybindingRunContext,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import { fetchSnippet, runInSession } from "./run-flows";
import { useSnippetOptions } from "./use-snippet-options";

/** Stored as action.type; kept from 2.8 so saved bindings keep working. */
export const RUN_SNIPPET_ACTION = "runSnippet";

function snippetIdOf(action: KeybindingAction): string {
  return typeof action.snippetId === "string" ? action.snippetId : "";
}

/** Picks the snippet a "Run snippet" binding runs. */
export function RunSnippetEditor({
  action,
  onChange,
}: KeybindingActionEditorProps) {
  const { t } = useTranslation();
  const { options } = useSnippetOptions();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold">
        {t("keybindings.snippetLabel")}
      </label>
      <select
        aria-label={t("keybindings.snippetLabel")}
        value={snippetIdOf(action)}
        onChange={(e) =>
          onChange({
            type: RUN_SNIPPET_ACTION,
            snippetId: e.target.value || undefined,
            appendEnter: true,
          })
        }
        className="h-8 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">{t("keybindings.selectSnippet")}</option>
        {options.map((snippet) => (
          <option key={snippet.id} value={String(snippet.id)}>
            {snippet.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The bound snippet's name in the binding list, or a warning once it is gone. */
export function RunSnippetSummary({ action }: KeybindingActionEditorProps) {
  const { t } = useTranslation();
  const { options, loaded } = useSnippetOptions();
  if (!loaded) return null;
  const snippet = options.find((s) => String(s.id) === snippetIdOf(action));
  if (snippet) return <span>({snippet.name})</span>;
  return (
    <span className="text-destructive">
      ({t("keybindings.snippetMissing")})
    </span>
  );
}

export function validateRunSnippet(action: KeybindingAction): string | null {
  return /^\d+$/.test(snippetIdOf(action))
    ? null
    : "keybindings.snippetRequired";
}

/** Runs a bound snippet in the terminal the key was pressed in. */
export function runSnippetBinding(
  app: Pick<TermixApp, "api" | "t">,
  action: KeybindingAction,
  context: KeybindingRunContext,
): void {
  void fetchSnippet(app, Number(snippetIdOf(action))).then((snippet) => {
    if (!snippet) return;
    void runInSession(
      app,
      { ...snippet, isNote: false },
      { sessionId: context.sessionId, send: context.send },
      context.host ?? null,
      { pressEnter: action.appendEnter !== false },
    );
  });
}
