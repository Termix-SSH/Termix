import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import type { HostTunnelTabProps } from "./shared/tab-types";

export function HostTunnelTab({
  form,
  sshConfigDropdownOpen,
  setSshConfigDropdownOpen,
  sshConfigInputRefs,
  sshConfigDropdownRefs,
  getFilteredSshConfigs,
  handleSshConfigClick,
  t,
}: HostTunnelTabProps) {
  return (
    <div>
      <FormField
        control={form.control}
        name="enableTunnel"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("hosts.enableTunnel")}</FormLabel>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormDescription>{t("hosts.enableTunnelDesc")}</FormDescription>
          </FormItem>
        )}
      />
      {form.watch("enableTunnel") && (
        <>
          <Alert className="mt-4">
            <AlertDescription>
              <strong>{t("hosts.sshpassRequired")}</strong>
              <div>
                {t("hosts.sshpassRequiredDesc")}{" "}
                <code className="bg-muted px-1 rounded inline">
                  sudo apt install sshpass
                </code>{" "}
                {t("hosts.debianUbuntuEquivalent")}
              </div>
              <div className="mt-2">
                <strong>{t("hosts.otherInstallMethods")}</strong>
                <div>
                  • {t("hosts.centosRhelFedora")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    sudo yum install sshpass
                  </code>{" "}
                  {t("hosts.or")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    sudo dnf install sshpass
                  </code>
                </div>
                <div>
                  • {t("hosts.macos")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    brew install hudochenkov/sshpass/sshpass
                  </code>
                </div>
                <div>
                  • {t("hosts.windows")}{" "}
                  <code className="bg-muted px-1 rounded inline">
                    sudo apt install sshpass
                  </code>
                </div>
              </div>
            </AlertDescription>
          </Alert>

          <Alert className="mt-4">
            <AlertDescription>
              <strong>{t("hosts.sshServerConfigRequired")}</strong>
              <div>{t("hosts.sshServerConfigDesc")}</div>
              <div>
                •{" "}
                <code className="bg-muted px-1 rounded inline">
                  GatewayPorts yes
                </code>{" "}
                {t("hosts.gatewayPortsYes")}
              </div>
              <div>
                •{" "}
                <code className="bg-muted px-1 rounded inline">
                  AllowTcpForwarding yes
                </code>{" "}
                {t("hosts.allowTcpForwardingYes")}
              </div>
              <div>
                •{" "}
                <code className="bg-muted px-1 rounded inline">
                  PermitRootLogin yes
                </code>{" "}
                {t("hosts.permitRootLoginYes")}
              </div>
              <div className="mt-2">
                {t("hosts.editSshConfig")}{" "}
                <code className="bg-muted px-1 rounded inline">
                  {t("hosts.sshConfigPath")}
                </code>
              </div>
              <div className="mt-2">
                {t("hosts.restartSshService")}{" "}
                <code className="bg-muted px-1 rounded inline">
                  {t("hosts.restartSshCommand")}
                </code>
              </div>
            </AlertDescription>
          </Alert>
          <div className="mt-3 flex justify-between">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() =>
                window.open("https://docs.termix.site/tunnels", "_blank")
              }
            >
              {t("common.documentation")}
            </Button>
          </div>
          <FormField
            control={form.control}
            name="tunnelConnections"
            render={({ field }) => (
              <FormItem className="mt-4">
                <FormLabel>{t("hosts.tunnelConnections")}</FormLabel>
                <FormControl>
                  <div className="space-y-4">
                    {field.value.map((connection, index) => (
                      <div
                        key={index}
                        className="p-4 border rounded-lg bg-muted/50"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold">
                            {t("hosts.connection")} {index + 1}
                          </h4>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const newConnections = field.value.filter(
                                (_, i) => i !== index,
                              );
                              field.onChange(newConnections);
                            }}
                          >
                            {t("hosts.remove")}
                          </Button>
                        </div>
                        <div className="mb-4">
                          <FormField
                            control={form.control}
                            name={`tunnelConnections.${index}.tunnelType`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>{t("hosts.tunnelType")}</FormLabel>
                                <FormControl>
                                  <div className="flex gap-6">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="radio"
                                        value="local"
                                        checked={field.value === "local"}
                                        onChange={() => field.onChange("local")}
                                        className="w-4 h-4 text-primary border-input focus:ring-ring"
                                      />
                                      <div className="flex flex-col">
                                        <span className="text-sm font-medium">
                                          {t("hosts.tunnelTypeLocal")}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {t("hosts.tunnelTypeLocalDesc")}
                                        </span>
                                      </div>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="radio"
                                        value="remote"
                                        checked={field.value === "remote"}
                                        onChange={() =>
                                          field.onChange("remote")
                                        }
                                        className="w-4 h-4 text-primary border-input focus:ring-ring"
                                      />
                                      <div className="flex flex-col">
                                        <span className="text-sm font-medium">
                                          {t("hosts.tunnelTypeRemote")}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {t("hosts.tunnelTypeRemoteDesc")}
                                        </span>
                                      </div>
                                    </label>
                                  </div>
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-12 gap-4">
                          <FormField
                            control={form.control}
                            name={`tunnelConnections.${index}.sourcePort`}
                            render={({ field: sourcePortField }) => (
                              <FormItem className="col-span-4">
                                <FormLabel>
                                  {t("hosts.sourcePort")}
                                  {t("hosts.sourcePortDesc")}
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder={t("placeholders.defaultPort")}
                                    {...sourcePortField}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`tunnelConnections.${index}.endpointPort`}
                            render={({ field: endpointPortField }) => (
                              <FormItem className="col-span-4">
                                <FormLabel>{t("hosts.endpointPort")}</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder={t(
                                      "placeholders.defaultEndpointPort",
                                    )}
                                    {...endpointPortField}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`tunnelConnections.${index}.endpointHost`}
                            render={({ field: endpointHostField }) => (
                              <FormItem className="col-span-4 relative">
                                <FormLabel>
                                  {t("hosts.endpointSshConfig")}
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    ref={(el) => {
                                      sshConfigInputRefs.current[index] = el;
                                    }}
                                    placeholder={t("placeholders.sshConfig")}
                                    className="min-h-[40px]"
                                    autoComplete="off"
                                    value={endpointHostField.value}
                                    onFocus={() =>
                                      setSshConfigDropdownOpen((prev) => ({
                                        ...prev,
                                        [index]: true,
                                      }))
                                    }
                                    onChange={(e) => {
                                      endpointHostField.onChange(e);
                                      setSshConfigDropdownOpen((prev) => ({
                                        ...prev,
                                        [index]: true,
                                      }));
                                    }}
                                    onBlur={(e) => {
                                      endpointHostField.onChange(
                                        e.target.value.trim(),
                                      );
                                      endpointHostField.onBlur();
                                    }}
                                  />
                                </FormControl>
                                {sshConfigDropdownOpen[index] &&
                                  getFilteredSshConfigs(index).length > 0 && (
                                    <div
                                      ref={(el) => {
                                        sshConfigDropdownRefs.current[index] =
                                          el;
                                      }}
                                      className="absolute top-full left-0 z-50 mt-1 w-full bg-canvas border border-input rounded-md shadow-lg max-h-40 overflow-y-auto thin-scrollbar p-1"
                                    >
                                      <div className="grid grid-cols-1 gap-1 p-0">
                                        {getFilteredSshConfigs(index).map(
                                          (config) => (
                                            <Button
                                              key={config}
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="w-full justify-start text-left rounded px-2 py-1.5 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
                                              onClick={() =>
                                                handleSshConfigClick(
                                                  config,
                                                  index,
                                                )
                                              }
                                            >
                                              {config}
                                            </Button>
                                          ),
                                        )}
                                      </div>
                                    </div>
                                  )}
                              </FormItem>
                            )}
                          />
                        </div>

                        <p className="text-sm text-muted-foreground mt-2">
                          {form.watch(
                            `tunnelConnections.${index}.tunnelType`,
                          ) === "local"
                            ? t("hosts.tunnelForwardDescriptionLocal", {
                                sourcePort:
                                  form.watch(
                                    `tunnelConnections.${index}.sourcePort`,
                                  ) || "22",
                                endpointPort:
                                  form.watch(
                                    `tunnelConnections.${index}.endpointPort`,
                                  ) || "224",
                              })
                            : t("hosts.tunnelForwardDescriptionRemote", {
                                sourcePort:
                                  form.watch(
                                    `tunnelConnections.${index}.sourcePort`,
                                  ) || "22",
                                endpointPort:
                                  form.watch(
                                    `tunnelConnections.${index}.endpointPort`,
                                  ) || "224",
                              })}
                        </p>

                        <div className="grid grid-cols-12 gap-4 mt-4">
                          <FormField
                            control={form.control}
                            name={`tunnelConnections.${index}.maxRetries`}
                            render={({ field: maxRetriesField }) => (
                              <FormItem className="col-span-4">
                                <FormLabel>{t("hosts.maxRetries")}</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder={t("placeholders.maxRetries")}
                                    {...maxRetriesField}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t("hosts.maxRetriesDescription")}
                                </FormDescription>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`tunnelConnections.${index}.retryInterval`}
                            render={({ field: retryIntervalField }) => (
                              <FormItem className="col-span-4">
                                <FormLabel>
                                  {t("hosts.retryInterval")}
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder={t(
                                      "placeholders.retryInterval",
                                    )}
                                    {...retryIntervalField}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t("hosts.retryIntervalDescription")}
                                </FormDescription>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`tunnelConnections.${index}.autoStart`}
                            render={({ field }) => (
                              <FormItem className="col-span-4">
                                <FormLabel>
                                  {t("hosts.autoStartContainer")}
                                </FormLabel>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                                <FormDescription>
                                  {t("hosts.autoStartDesc")}
                                </FormDescription>
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        field.onChange([
                          ...field.value,
                          {
                            tunnelType: "remote",
                            sourcePort: 22,
                            endpointPort: 224,
                            endpointHost: "",
                            maxRetries: 3,
                            retryInterval: 10,
                            autoStart: false,
                          },
                        ]);
                      }}
                    >
                      {t("hosts.addConnection")}
                    </Button>
                  </div>
                </FormControl>
              </FormItem>
            )}
          />
        </>
      )}
    </div>
  );
}
