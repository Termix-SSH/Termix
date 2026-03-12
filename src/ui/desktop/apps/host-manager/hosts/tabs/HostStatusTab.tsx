import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import type { HostStatisticsTabProps } from "./shared/tab-types";

export function HostStatusTab({
  form,
  statusIntervalUnit,
  setStatusIntervalUnit,
  t,
}: Pick<
  HostStatisticsTabProps,
  "form" | "statusIntervalUnit" | "setStatusIntervalUnit" | "t"
>) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-3">
          <FormField
            control={form.control}
            name="statsConfig.statusCheckEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                <div className="space-y-0.5">
                  <FormLabel>{t("hosts.statusCheckEnabled")}</FormLabel>
                  <FormDescription>
                    {t("hosts.statusCheckEnabledDesc")}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {form.watch("statsConfig.statusCheckEnabled") && (
            <>
              <FormField
                control={form.control}
                name="statsConfig.useGlobalStatusInterval"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value ?? true}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      {t("hosts.useGlobalStatusInterval")}
                    </FormLabel>
                  </FormItem>
                )}
              />
              {form.watch("statsConfig.useGlobalStatusInterval") === false && (
                <FormField
                  control={form.control}
                  name="statsConfig.statusCheckInterval"
                  render={({ field }) => {
                    const displayValue =
                      statusIntervalUnit === "minutes"
                        ? Math.round((field.value || 30) / 60)
                        : field.value || 30;

                    const handleIntervalChange = (value: string) => {
                      const numValue = parseInt(value) || 0;
                      const seconds =
                        statusIntervalUnit === "minutes"
                          ? numValue * 60
                          : numValue;
                      field.onChange(seconds);
                    };

                    return (
                      <FormItem>
                        <FormLabel>{t("hosts.statusCheckInterval")}</FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input
                              type="number"
                              value={displayValue}
                              onChange={(e) =>
                                handleIntervalChange(e.target.value)
                              }
                              className="flex-1"
                            />
                          </FormControl>
                          <Select
                            value={statusIntervalUnit}
                            onValueChange={(value: "seconds" | "minutes") => {
                              setStatusIntervalUnit(value);
                              const currentSeconds = field.value || 30;
                              if (value === "minutes") {
                                const minutes = Math.round(currentSeconds / 60);
                                field.onChange(minutes * 60);
                              }
                            }}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="seconds">
                                {t("hosts.intervalSeconds")}
                              </SelectItem>
                              <SelectItem value="minutes">
                                {t("hosts.intervalMinutes")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <FormDescription>
                          {t("hosts.statusCheckIntervalDesc")}
                        </FormDescription>
                      </FormItem>
                    );
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
