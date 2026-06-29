import type {
  FileManagerWidgetConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { SingleHostEditForm } from "./SingleHostEditForm";

export function FileManagerWidgetEditForm({
  config,
  onChange,
}: WidgetEditFormProps<FileManagerWidgetConfig>) {
  return (
    <SingleHostEditForm
      hostId={config.hostId}
      onChange={(hostId) => onChange({ ...config, hostId })}
      filter={(h) => !!(h.enableSsh && h.enableFileManager)}
    />
  );
}
