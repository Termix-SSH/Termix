import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Plus } from "lucide-react";
import { QuickActionItem } from "./shared/QuickActionItem.tsx";
import type { HostStatisticsTabProps } from "./shared/tab-types";

export function HostStatisticsTab({
  control,
  watch,
  setValue,
  statusIntervalUnit,
  setStatusIntervalUnit,
  metricsIntervalUnit,
  setMetricsIntervalUnit,
  t,
}: HostStatisticsTabProps) {
  // For quick actions - need to get snippets from parent
  const snippets = watch("snippets") || [];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() =>
              window.open("https://docs.termix.site/server-stats", "_blank")
            }
          >
            {t("common.documentation")}
          </Button>

          <FormField
            control={control}
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

          {watch("statsConfig.statusCheckEnabled") && (
            <FormField
              control={control}
              name="statsConfig.statusCheckInterval"
              render={({ field }) => {
                const displayValue =
                  statusIntervalUnit === "minutes"
                    ? Math.round((field.value || 30) / 60)
                    : field.value || 30;

                const handleIntervalChange = (value: string) => {
                  const numValue = parseInt(value) || 0;
                  const seconds =
                    statusIntervalUnit === "minutes" ? numValue * 60 : numValue;
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
                          onChange={(e) => handleIntervalChange(e.target.value)}
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
        </div>

        <div className="space-y-3">
          <FormField
            control={control}
            name="statsConfig.metricsEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                <div className="space-y-0.5">
                  <FormLabel>{t("hosts.metricsEnabled")}</FormLabel>
                  <FormDescription>
                    {t("hosts.metricsEnabledDesc")}
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

          {watch("statsConfig.metricsEnabled") && (
            <FormField
              control={control}
              name="statsConfig.metricsInterval"
              render={({ field }) => {
                const displayValue =
                  metricsIntervalUnit === "minutes"
                    ? Math.round((field.value || 30) / 60)
                    : field.value || 30;

                const handleIntervalChange = (value: string) => {
                  const numValue = parseInt(value) || 0;
                  const seconds =
                    metricsIntervalUnit === "minutes"
                      ? numValue * 60
                      : numValue;
                  field.onChange(seconds);
                };

                return (
                  <FormItem>
                    <FormLabel>{t("hosts.metricsInterval")}</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          type="number"
                          value={displayValue}
                          onChange={(e) => handleIntervalChange(e.target.value)}
                          className="flex-1"
                        />
                      </FormControl>
                      <Select
                        value={metricsIntervalUnit}
                        onValueChange={(value: "seconds" | "minutes") => {
                          setMetricsIntervalUnit(value);
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
                      {t("hosts.metricsIntervalDesc")}
                    </FormDescription>
                  </FormItem>
                );
              }}
            />
          )}
        </div>
      </div>

      {watch("statsConfig.metricsEnabled") && (
        <>
          <FormField
            control={control}
            name="statsConfig.enabledWidgets"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hosts.enabledWidgets")}</FormLabel>
                <FormDescription>
                  {t("hosts.enabledWidgetsDesc")}
                </FormDescription>
                <div className="space-y-3 mt-3">
                  {(
                    [
                      "cpu",
                      "memory",
                      "disk",
                      "network",
                      "uptime",
                      "processes",
                      "system",
                      "login_stats",
                    ] as const
                  ).map((widget) => (
                    <div key={widget} className="flex items-center space-x-2">
                      <Checkbox
                        checked={field.value?.includes(widget)}
                        onCheckedChange={(checked) => {
                          const currentWidgets = field.value || [];
                          if (checked) {
                            field.onChange([...currentWidgets, widget]);
                          } else {
                            field.onChange(
                              currentWidgets.filter((w) => w !== widget),
                            );
                          }
                        }}
                      />
                      <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        {widget === "cpu" && t("serverStats.cpuUsage")}
                        {widget === "memory" && t("serverStats.memoryUsage")}
                        {widget === "disk" && t("serverStats.diskUsage")}
                        {widget === "network" &&
                          t("serverStats.networkInterfaces")}
                        {widget === "uptime" && t("serverStats.uptime")}
                        {widget === "processes" && t("serverStats.processes")}
                        {widget === "system" && t("serverStats.systemInfo")}
                        {widget === "login_stats" &&
                          t("serverStats.loginStats")}
                      </label>
                    </div>
                  ))}
                </div>
              </FormItem>
            )}
          />
        </>
      )}
    </div>
  );
}
