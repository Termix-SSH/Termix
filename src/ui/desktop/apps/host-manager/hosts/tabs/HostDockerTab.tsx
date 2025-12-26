import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import type { HostDockerTabProps } from "./shared/tab-types";

export function HostDockerTab({ control, t }: HostDockerTabProps) {
  return (
    <div className="space-y-4">
      <FormField
        control={control}
        name="enableDocker"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("hosts.enableDocker")}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormDescription>{t("hosts.enableDockerDesc")}</FormDescription>
          </FormItem>
        )}
      />
    </div>
  );
}
