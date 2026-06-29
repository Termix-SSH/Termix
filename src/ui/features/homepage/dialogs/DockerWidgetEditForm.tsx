import type {
  DockerWidgetConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { SingleHostEditForm } from "./SingleHostEditForm";

export function DockerWidgetEditForm({
  config,
  onChange,
}: WidgetEditFormProps<DockerWidgetConfig>) {
  return (
    <SingleHostEditForm
      hostId={config.hostId}
      onChange={(hostId) => onChange({ ...config, hostId })}
      filter={(h) => !!(h.enableSsh && h.enableDocker)}
    />
  );
}
