import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import type { HostDockerTabProps } from "./shared/tab-types";
import { Button } from "@/components/ui/button.tsx";

export function HostDockerTab({ form, t }: HostDockerTabProps) {
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-3 text-xs"
        onClick={() => window.open("https://docs.termix.site/docker", "_blank")}
      >
        {t("common.documentation")}
      </Button>
      <FormField
        control={form.control}
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
