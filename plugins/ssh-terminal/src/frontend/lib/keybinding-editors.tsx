import {
  useTranslation,
  type KeybindingActionEditorProps,
} from "@termix/plugin-sdk/frontend";
import { Input } from "@termix/plugin-sdk/ui";

export function PasteNote() {
  const { t } = useTranslation();
  return (
    <span className="text-xs text-muted-foreground">
      {t("keybindings.clipboardPermissionNote")}
    </span>
  );
}

export function SendControlCodeEditor({
  action,
  onChange,
}: KeybindingActionEditorProps) {
  const { t } = useTranslation();
  const value =
    typeof action.controlCode === "string" ? action.controlCode : "";
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold">
        {t("keybindings.controlCodeLabel")}
      </label>
      <Input
        aria-label={t("keybindings.controlCodeLabel")}
        value={value}
        maxLength={1}
        onChange={(e) =>
          onChange({
            type: action.type,
            controlCode: e.target.value.toLowerCase() || undefined,
          })
        }
        placeholder="w"
        className="w-16 font-mono"
      />
    </div>
  );
}

export function SendTextEditor({
  action,
  onChange,
}: KeybindingActionEditorProps) {
  const { t } = useTranslation();
  const text = typeof action.text === "string" ? action.text : "";
  const appendEnter = action.appendEnter === true;
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold">
        {t("keybindings.textLabel")}
      </label>
      <textarea
        aria-label={t("keybindings.textLabel")}
        value={text}
        onChange={(e) =>
          onChange({ type: action.type, text: e.target.value, appendEnter })
        }
        className="w-full h-24 px-3 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={appendEnter}
          onChange={(e) =>
            onChange({
              type: action.type,
              text,
              appendEnter: e.target.checked,
            })
          }
        />
        {t("keybindings.appendEnterLabel")}
      </label>
    </div>
  );
}
