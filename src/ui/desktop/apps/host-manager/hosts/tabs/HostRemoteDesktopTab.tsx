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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import type { HostRemoteDesktopTabProps } from "./shared/tab-types";

type RemoteDesktopForm = HostRemoteDesktopTabProps["form"];

function GuacField({
  form,
  path,
  label,
  description,
  type = "text",
}: {
  form: RemoteDesktopForm;
  path: string;
  label: string;
  description?: string;
  type?: "text" | "number" | "password" | "switch";
}) {
  const fieldName = `guacamoleConfig.${path}` as never;

  if (type === "switch") {
    return (
      <FormField
        control={form.control}
        name={fieldName}
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
            <div className="space-y-0.5">
              <FormLabel>{label}</FormLabel>
              {description && <FormDescription>{description}</FormDescription>}
            </div>
            <FormControl>
              <Switch
                checked={!!field.value}
                onCheckedChange={field.onChange}
              />
            </FormControl>
          </FormItem>
        )}
      />
    );
  }

  if (type === "password") {
    return (
      <FormField
        control={form.control}
        name={fieldName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <PasswordInput
                value={field.value || ""}
                onChange={field.onChange}
              />
            </FormControl>
            {description && <FormDescription>{description}</FormDescription>}
          </FormItem>
        )}
      />
    );
  }

  return (
    <FormField
      control={form.control}
      name={fieldName}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={type}
              value={field.value ?? ""}
              onChange={(e) =>
                field.onChange(
                  type === "number"
                    ? e.target.value === ""
                      ? undefined
                      : parseInt(e.target.value)
                    : e.target.value,
                )
              }
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
        </FormItem>
      )}
    />
  );
}

function GuacSelect({
  form,
  path,
  label,
  options,
  placeholder,
}: {
  form: RemoteDesktopForm;
  path: string;
  label: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const fieldName = `guacamoleConfig.${path}` as never;

  return (
    <FormField
      control={form.control}
      name={fieldName}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            value={field.value || "auto"}
            onValueChange={(v) => field.onChange(v === "auto" ? "" : v)}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={placeholder || label} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormItem>
      )}
    />
  );
}

export function HostRemoteDesktopTab({
  form,
  connectionType,
  t,
}: HostRemoteDesktopTabProps) {
  const isRDP = connectionType === "rdp";
  const isVNC = connectionType === "vnc";
  const isTelnet = connectionType === "telnet";

  return (
    <div className="pt-2 space-y-4">
      <Accordion
        type="multiple"
        defaultValue={["connection", "display"]}
        className="w-full"
      >
        {/* Connection Settings */}
        {isRDP && (
          <AccordionItem value="connection">
            <AccordionTrigger>{t("hosts.connectionSettings")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <FormField
                control={form.control}
                name="security"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("hosts.securityMode")}</FormLabel>
                    <Select
                      value={field.value || "any"}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="nla">NLA</SelectItem>
                        <SelectItem value="nla-ext">NLA Extended</SelectItem>
                        <SelectItem value="tls">TLS</SelectItem>
                        <SelectItem value="vmconnect">VMConnect</SelectItem>
                        <SelectItem value="rdp">RDP</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ignoreCert"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 bg-elevated dark:bg-input/30">
                    <div className="space-y-0.5">
                      <FormLabel>{t("hosts.ignoreCert")}</FormLabel>
                      <FormDescription>
                        {t("hosts.ignoreCertDesc")}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Display Settings */}
        <AccordionItem value="display">
          <AccordionTrigger>{t("hosts.displaySettings")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            {!isTelnet && (
              <GuacSelect
                form={form}
                path="color-depth"
                label={t("hosts.colorDepth")}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "8", label: "8-bit" },
                  { value: "16", label: "16-bit" },
                  { value: "24", label: "24-bit" },
                  { value: "32", label: "32-bit" },
                ]}
              />
            )}
            <div className="grid grid-cols-2 gap-4">
              <GuacField
                form={form}
                path="width"
                label={t("hosts.width")}
                type="number"
              />
              <GuacField
                form={form}
                path="height"
                label={t("hosts.height")}
                type="number"
              />
            </div>
            {!isTelnet && (
              <>
                <GuacField
                  form={form}
                  path="dpi"
                  label={t("hosts.dpi")}
                  type="number"
                />
                <GuacSelect
                  form={form}
                  path="resize-method"
                  label={t("hosts.resizeMethod")}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "display-update", label: "Display Update" },
                    { value: "reconnect", label: "Reconnect" },
                  ]}
                />
                <GuacField
                  form={form}
                  path="force-lossless"
                  label={t("hosts.forceLossless")}
                  type="switch"
                />
              </>
            )}
          </AccordionContent>
        </AccordionItem>

        {/* Telnet Terminal Settings */}
        {isTelnet && (
          <AccordionItem value="telnet-terminal">
            <AccordionTrigger>
              {t("hosts.telnetTerminalSettings")}
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacSelect
                form={form}
                path="terminal-type"
                label={t("hosts.terminalType")}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "xterm", label: "xterm" },
                  { value: "xterm-256color", label: "xterm-256color" },
                  { value: "vt100", label: "VT100" },
                  { value: "vt220", label: "VT220" },
                ]}
              />
              <GuacField
                form={form}
                path="font-name"
                label={t("hosts.guacFontName")}
              />
              <GuacField
                form={form}
                path="font-size"
                label={t("hosts.guacFontSize")}
                type="number"
              />
              <GuacSelect
                form={form}
                path="color-scheme"
                label={t("hosts.guacColorScheme")}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "black-white", label: "Black on White" },
                  { value: "white-black", label: "White on Black" },
                  { value: "gray-black", label: "Gray on Black" },
                  { value: "green-black", label: "Green on Black" },
                ]}
              />
              <GuacSelect
                form={form}
                path="backspace"
                label={t("hosts.guacBackspaceKey")}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "127", label: "DEL (127)" },
                  { value: "8", label: "BS (8)" },
                ]}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Audio Settings */}
        {(isRDP || isVNC) && (
          <AccordionItem value="audio">
            <AccordionTrigger>{t("hosts.audioSettings")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacField
                form={form}
                path="disable-audio"
                label={t("hosts.disableAudio")}
                type="switch"
              />
              {isRDP && (
                <GuacField
                  form={form}
                  path="enable-audio-input"
                  label={t("hosts.enableAudioInput")}
                  type="switch"
                />
              )}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* RDP Performance */}
        {isRDP && (
          <AccordionItem value="performance">
            <AccordionTrigger>{t("hosts.rdpPerformance")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacField
                form={form}
                path="enable-wallpaper"
                label={t("hosts.enableWallpaper")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-theming"
                label={t("hosts.enableTheming")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-font-smoothing"
                label={t("hosts.enableFontSmoothing")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-full-window-drag"
                label={t("hosts.enableFullWindowDrag")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-desktop-composition"
                label={t("hosts.enableDesktopComposition")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-menu-animations"
                label={t("hosts.enableMenuAnimations")}
                type="switch"
              />
              <GuacField
                form={form}
                path="disable-bitmap-caching"
                label={t("hosts.disableBitmapCaching")}
                type="switch"
              />
              <GuacField
                form={form}
                path="disable-offscreen-caching"
                label={t("hosts.disableOffscreenCaching")}
                type="switch"
              />
              <GuacField
                form={form}
                path="disable-glyph-caching"
                label={t("hosts.disableGlyphCaching")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-gfx"
                label={t("hosts.enableGfx")}
                type="switch"
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* RDP Device Redirection */}
        {isRDP && (
          <AccordionItem value="device-redirection">
            <AccordionTrigger>{t("hosts.deviceRedirection")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacField
                form={form}
                path="enable-printing"
                label={t("hosts.enablePrinting")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-drive"
                label={t("hosts.enableDrive")}
                type="switch"
              />
              <GuacField
                form={form}
                path="drive-name"
                label={t("hosts.driveName")}
              />
              <GuacField
                form={form}
                path="drive-path"
                label={t("hosts.drivePath")}
              />
              <GuacField
                form={form}
                path="create-drive-path"
                label={t("hosts.createDrivePath")}
                type="switch"
              />
              <GuacField
                form={form}
                path="disable-download"
                label={t("hosts.disableDownload")}
                type="switch"
              />
              <GuacField
                form={form}
                path="disable-upload"
                label={t("hosts.disableUpload")}
                type="switch"
              />
              <GuacField
                form={form}
                path="enable-touch"
                label={t("hosts.enableTouch")}
                type="switch"
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* RDP Session */}
        {isRDP && (
          <AccordionItem value="session">
            <AccordionTrigger>{t("hosts.rdpSession")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacField
                form={form}
                path="client-name"
                label={t("hosts.clientName")}
              />
              <GuacField
                form={form}
                path="console"
                label={t("hosts.consoleSession")}
                type="switch"
              />
              <GuacField
                form={form}
                path="initial-program"
                label={t("hosts.initialProgram")}
              />
              <GuacSelect
                form={form}
                path="server-layout"
                label={t("hosts.serverLayout")}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "en-us-qwerty", label: "English (US) QWERTY" },
                  { value: "en-gb-qwerty", label: "English (UK) QWERTY" },
                  { value: "de-de-qwertz", label: "German QWERTZ" },
                  { value: "fr-fr-azerty", label: "French AZERTY" },
                  { value: "it-it-qwerty", label: "Italian QWERTY" },
                  { value: "sv-se-qwerty", label: "Swedish QWERTY" },
                  { value: "ja-jp-qwerty", label: "Japanese QWERTY" },
                  { value: "pt-br-qwerty", label: "Portuguese (BR) QWERTY" },
                  { value: "es-es-qwerty", label: "Spanish QWERTY" },
                  { value: "failsafe", label: "Failsafe (Unicode)" },
                ]}
              />
              <GuacField
                form={form}
                path="timezone"
                label={t("hosts.timezone")}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* RDP Gateway */}
        {isRDP && (
          <AccordionItem value="gateway">
            <AccordionTrigger>{t("hosts.gatewaySettings")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacField
                form={form}
                path="gateway-hostname"
                label={t("hosts.gatewayHostname")}
              />
              <GuacField
                form={form}
                path="gateway-port"
                label={t("hosts.gatewayPort")}
                type="number"
              />
              <GuacField
                form={form}
                path="gateway-username"
                label={t("hosts.gatewayUsername")}
              />
              <GuacField
                form={form}
                path="gateway-password"
                label={t("hosts.gatewayPassword")}
                type="password"
              />
              <GuacField
                form={form}
                path="gateway-domain"
                label={t("hosts.gatewayDomain")}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* RDP RemoteApp */}
        {isRDP && (
          <AccordionItem value="remoteapp">
            <AccordionTrigger>{t("hosts.remoteApp")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacField
                form={form}
                path="remote-app"
                label={t("hosts.remoteAppProgram")}
              />
              <GuacField
                form={form}
                path="remote-app-dir"
                label={t("hosts.remoteAppDir")}
              />
              <GuacField
                form={form}
                path="remote-app-args"
                label={t("hosts.remoteAppArgs")}
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Clipboard */}
        <AccordionItem value="clipboard">
          <AccordionTrigger>{t("hosts.clipboardSettings")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <GuacSelect
              form={form}
              path="normalize-clipboard"
              label={t("hosts.normalizeClipboard")}
              options={[
                { value: "auto", label: "Auto" },
                { value: "preserve", label: "Preserve" },
                { value: "unix", label: "Unix (LF)" },
                { value: "windows", label: "Windows (CRLF)" },
              ]}
            />
            <GuacField
              form={form}
              path="disable-copy"
              label={t("hosts.disableCopy")}
              type="switch"
            />
            <GuacField
              form={form}
              path="disable-paste"
              label={t("hosts.disablePaste")}
              type="switch"
            />
          </AccordionContent>
        </AccordionItem>

        {/* VNC Specific */}
        {isVNC && (
          <AccordionItem value="vnc-specific">
            <AccordionTrigger>{t("hosts.vncSettings")}</AccordionTrigger>
            <AccordionContent className="space-y-4 pt-4">
              <GuacSelect
                form={form}
                path="cursor"
                label={t("hosts.cursorMode")}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "local", label: "Local" },
                  { value: "remote", label: "Remote" },
                ]}
              />
              <GuacField
                form={form}
                path="swap-red-blue"
                label={t("hosts.swapRedBlue")}
                type="switch"
              />
              <GuacField
                form={form}
                path="read-only"
                label={t("hosts.readOnly")}
                type="switch"
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Recording */}
        <AccordionItem value="recording">
          <AccordionTrigger>{t("hosts.recordingSettings")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <GuacField
              form={form}
              path="recording-path"
              label={t("hosts.recordingPath")}
            />
            <GuacField
              form={form}
              path="recording-name"
              label={t("hosts.recordingName")}
            />
            <GuacField
              form={form}
              path="create-recording-path"
              label={t("hosts.createRecordingPath")}
              type="switch"
            />
            <GuacField
              form={form}
              path="recording-exclude-output"
              label={t("hosts.excludeOutput")}
              type="switch"
            />
            <GuacField
              form={form}
              path="recording-exclude-mouse"
              label={t("hosts.excludeMouse")}
              type="switch"
            />
            <GuacField
              form={form}
              path="recording-include-keys"
              label={t("hosts.includeKeys")}
              type="switch"
            />
          </AccordionContent>
        </AccordionItem>

        {/* Wake-on-LAN */}
        <AccordionItem value="wol">
          <AccordionTrigger>{t("hosts.wakeOnLan")}</AccordionTrigger>
          <AccordionContent className="space-y-4 pt-4">
            <GuacField
              form={form}
              path="wol-send-packet"
              label={t("hosts.sendWolPacket")}
              type="switch"
            />
            <GuacField
              form={form}
              path="wol-mac-addr"
              label={t("hosts.wolMacAddr")}
            />
            <GuacField
              form={form}
              path="wol-broadcast-addr"
              label={t("hosts.wolBroadcastAddr")}
            />
            <GuacField
              form={form}
              path="wol-udp-port"
              label={t("hosts.wolUdpPort")}
              type="number"
            />
            <GuacField
              form={form}
              path="wol-wait-time"
              label={t("hosts.wolWaitTime")}
              type="number"
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
