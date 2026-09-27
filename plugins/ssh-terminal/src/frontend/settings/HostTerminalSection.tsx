import type { HostEditorSectionProps } from "@termix/plugin-sdk/frontend";
import { HostFeatureFields, HostTerminalSettings } from "@termix/plugin-sdk/ui";

/** The host editor's Terminal tab: this plugin's switches, then the look. */
export function HostTerminalSection({
  form,
  setField,
  updateForm,
  snippets,
}: HostEditorSectionProps) {
  return (
    <>
      <HostFeatureFields form={form} updateForm={updateForm} />
      <HostTerminalSettings
        form={form}
        setField={setField}
        snippets={snippets}
      />
    </>
  );
}
