import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import type { HostFileManagerTabProps } from "./shared/tab-types";

export function HostFileManagerTab({ form, t }: HostFileManagerTabProps) {
  return (
    <div>
      <FormField
        control={form.control}
        name="enableFileManager"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("hosts.enableFileManager")}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormDescription>
              {t("hosts.enableFileManagerDesc")}
            </FormDescription>
          </FormItem>
        )}
      />

      {form.watch("enableFileManager") && (
        <div className="mt-4">
          <FormField
            control={form.control}
            name="defaultPath"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hosts.defaultPath")}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t("placeholders.homePath")}
                    {...field}
                    onBlur={(e) => {
                      field.onChange(e.target.value.trim());
                      field.onBlur();
                    }}
                  />
                </FormControl>
                <FormDescription>{t("hosts.defaultPathDesc")}</FormDescription>
              </FormItem>
            )}
          />
        </div>
      )}
    </div>
  );
}
