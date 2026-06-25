import type {
  TunnelWidgetConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { SingleHostEditForm } from "./SingleHostEditForm";

export function TunnelWidgetEditForm({
  config,
  onChange,
}: WidgetEditFormProps<TunnelWidgetConfig>) {
  return (
    <SingleHostEditForm
      hostId={config.hostId}
      onChange={(hostId) => onChange({ ...config, hostId })}
      filter={(h) => !!(h.enableSsh && h.enableTunnel)}
    />
  );
}
