import type { HostEditorSectionProps } from "@termix/plugin-sdk/frontend";
import { HostFeatureFields } from "@termix/plugin-sdk/ui";
import { HostTerminalSettings } from "./HostTerminalSettings";

/** The host editor's Terminal tab: this plugin's switches, then the look. */
export function HostTerminalSection({
  form,
  setField,
  updateForm,
  host,
  snippets,
}: HostEditorSectionProps) {
  return (
    <>
      <HostFeatureFields form={form} updateForm={updateForm} />
      <HostTerminalSettings
        form={form}
        setField={setField}
        updateForm={updateForm}
        host={host}
        snippets={snippets}
      />
    </>
  );
}
