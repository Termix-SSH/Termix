import { useTranslation } from "react-i18next";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { FakeSwitch, SectionCard, SettingRow } from "@/components/section-card";
import type { Host } from "@/types/ui-types";
import {
  Activity,
  Copy,
  Globe,
  Monitor,
  Network,
  Server,
  Settings,
  Shield,
  Terminal,
  Zap,
  Cpu,
} from "lucide-react";
import type { HostEditorForm } from "./HostEditorData";

type HostEditorSetField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

type GuacFieldSetter = (key: string, value: unknown) => void;

function DocsLinkAction({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[10px] text-accent-brand hover:underline normal-case tracking-normal font-normal"
    >
      {label}
    </a>
  );
}

export function HostEditorRdpTab({
  form,
  setField,
  setGuacField,
  host,
  credentials,
}: {
  form: HostEditorForm;
  setField: HostEditorSetField;
  setGuacField: GuacFieldSetter;
  host?: Host | null;
  credentials?: { id: string; name: string; username: string }[];
}) {
  const { t } = useTranslation();

  return (
    <>
      <SectionCard
        title={t("hosts.guac.connection")}
        icon={<Globe className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/setup/remote-desktop"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.rdpPort")}
            </label>
            <Input
              type="number"
              placeholder="3389"
              value={form.rdpPort}
              onChange={(e) => setField("rdpPort", Number(e.target.value))}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.statusChecksLabel")}
        icon={<Activity className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.enableStatusChecks")}
            description={t("hosts.enableStatusChecksDesc")}
          >
            <FakeSwitch
              checked={form.statsConfig.statusCheckEnabled}
              onChange={(v) =>
                setField("statsConfig", {
                  ...form.statsConfig,
                  statusCheckEnabled: v,
                })
              }
            />
          </SettingRow>
          {form.statsConfig.statusCheckEnabled && (
            <SettingRow
              label={t("hosts.useGlobalInterval")}
              description={t("hosts.useGlobalIntervalDesc")}
            >
              <FakeSwitch
                checked={form.statsConfig.useGlobalStatusInterval}
                onChange={(v) =>
                  setField("statsConfig", {
                    ...form.statsConfig,
                    useGlobalStatusInterval: v,
                  })
                }
              />
            </SettingRow>
          )}
          {form.statsConfig.statusCheckEnabled &&
            !form.statsConfig.useGlobalStatusInterval && (
              <SettingRow
                label={t("hosts.checkIntervalS")}
                description={t("hosts.checkIntervalDesc")}
              >
                <Input
                  type="number"
                  value={form.statsConfig.statusCheckInterval}
                  onChange={(e) =>
                    setField("statsConfig", {
                      ...form.statsConfig,
                      statusCheckInterval: Number(e.target.value),
                    })
                  }
                  className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </SettingRow>
            )}
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.guac.guacdProxy")}
        icon={<Cpu className="size-3.5" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.guacdHostname")}
            </label>
            <Input
              placeholder={t("hosts.guac.guacdHostnamePlaceholder")}
              value={(form.guacamoleConfig["guacd-hostname"] as string) ?? ""}
              onChange={(e) => setGuacField("guacd-hostname", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.guacdPort")}
            </label>
            <Input
              type="number"
              placeholder="4822"
              value={(form.guacamoleConfig["guacd-port"] as string) ?? ""}
              onChange={(e) => setGuacField("guacd-port", e.target.value)}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <p className="col-span-full text-[10px] text-muted-foreground -mt-2">
            {t("hosts.guac.guacdProxyDesc")}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.authentication")}
        icon={<Shield className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          {credentials && credentials.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.authMethod")}
              </label>
              <div className="flex gap-2">
                {(["direct", "credential"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setField("rdpAuthType", m)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                      form.rdpAuthType === m
                        ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(
                      `hosts.guac.authType${m.charAt(0).toUpperCase() + m.slice(1)}`,
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {form.rdpAuthType === "credential" &&
            credentials &&
            credentials.length > 0 ? (
              <div className="flex flex-col gap-1.5 col-span-full">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.guac.storedCredential")}
                </label>
                <select
                  value={form.rdpCredentialId}
                  onChange={(e) => setField("rdpCredentialId", e.target.value)}
                  className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("hosts.guac.selectCredential")}</option>
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.username ? `${c.name} (${c.username})` : c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.username")}
                  </label>
                  <Input
                    placeholder="Administrator"
                    value={form.rdpUser}
                    onChange={(e) => setField("rdpUser", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.password")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder="••••••••"
                    value={form.rdpPassword}
                    onChange={(e) => setField("rdpPassword", e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.domain")}
              </label>
              <Input
                placeholder="WORKGROUP"
                value={form.domain}
                onChange={(e) => setField("domain", e.target.value)}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.connectionSettings")}
        icon={<Shield className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.securityMode")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.security ?? "any"}
              onChange={(e) => setField("security", e.target.value)}
            >
              <option value="any">Any</option>
              <option value="nla">NLA</option>
              <option value="nla-ext">NLA Extended</option>
              <option value="tls">TLS</option>
              <option value="vmconnect">VMConnect</option>
              <option value="rdp">RDP</option>
            </select>
          </div>
          <SettingRow
            label={t("hosts.guac.ignoreCertificate")}
            description={t("hosts.guac.ignoreCertificateDesc")}
          >
            <FakeSwitch
              checked={form.ignoreCert}
              onChange={(v) => setField("ignoreCert", v)}
            />
          </SettingRow>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.loadBalanceInfo")}
            </label>
            <Input
              placeholder="tsv://MS Terminal Services Plugin.1.CollectionName"
              value={
                (form.guacamoleConfig["load-balance-info"] as string) ?? ""
              }
              onChange={(e) =>
                setGuacField("load-balance-info", e.target.value)
              }
            />
            <p className="text-[10px] text-muted-foreground">
              {t("hosts.guac.loadBalanceInfoDesc")}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.displaySettings")}
        icon={<Monitor className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.colorDepth")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["color-depth"] ?? "auto"}
              onChange={(e) => setGuacField("color-depth", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="8">8-bit</option>
              <option value="16">16-bit</option>
              <option value="24">24-bit</option>
              <option value="32">32-bit</option>
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.width")}
              </label>
              <Input
                type="number"
                placeholder="Auto"
                value={form.guacamoleConfig["width"] ?? ""}
                onChange={(e) => setGuacField("width", e.target.value)}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.height")}
              </label>
              <Input
                type="number"
                placeholder="Auto"
                value={form.guacamoleConfig["height"] ?? ""}
                onChange={(e) => setGuacField("height", e.target.value)}
                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.dpi")}
            </label>
            <Input
              type="number"
              placeholder="96"
              value={form.guacamoleConfig["dpi"] ?? ""}
              onChange={(e) => setGuacField("dpi", e.target.value)}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.resizeMethod")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["resize-method"] ?? "auto"}
              onChange={(e) => setGuacField("resize-method", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="display-update">Display Update</option>
              <option value="reconnect">Reconnect</option>
            </select>
          </div>
          <SettingRow
            label={t("hosts.guac.forceLossless")}
            description={t("hosts.guac.forceLosslessDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["force-lossless"]}
              onChange={(v) => setGuacField("force-lossless", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.audioSettings")}
        icon={<Activity className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.guac.disableAudio")}
            description={t("hosts.guac.disableAudioDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-audio"]}
              onChange={(v) => setGuacField("disable-audio", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.enableAudioInput")}
            description={t("hosts.guac.enableAudioInputDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-audio-input"]}
              onChange={(v) => setGuacField("enable-audio-input", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.rdpPerformance")}
        icon={<Zap className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.guac.wallpaper")}
            description={t("hosts.guac.wallpaperDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-wallpaper"]}
              onChange={(v) => setGuacField("enable-wallpaper", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.theming")}
            description={t("hosts.guac.themingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-theming"]}
              onChange={(v) => setGuacField("enable-theming", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.fontSmoothing")}
            description={t("hosts.guac.fontSmoothingDesc")}
          >
            <FakeSwitch
              checked={form.guacamoleConfig["enable-font-smoothing"] !== false}
              onChange={(v) => setGuacField("enable-font-smoothing", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.fullWindowDrag")}
            description={t("hosts.guac.fullWindowDragDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-full-window-drag"]}
              onChange={(v) => setGuacField("enable-full-window-drag", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.desktopComposition")}
            description={t("hosts.guac.desktopCompositionDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-desktop-composition"]}
              onChange={(v) => setGuacField("enable-desktop-composition", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.menuAnimations")}
            description={t("hosts.guac.menuAnimationsDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-menu-animations"]}
              onChange={(v) => setGuacField("enable-menu-animations", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.disableBitmapCaching")}
            description={t("hosts.guac.disableBitmapCachingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-bitmap-caching"]}
              onChange={(v) => setGuacField("disable-bitmap-caching", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.disableOffscreenCaching")}
            description={t("hosts.guac.disableOffscreenCachingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-offscreen-caching"]}
              onChange={(v) => setGuacField("disable-offscreen-caching", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.disableGlyphCaching")}
            description={t("hosts.guac.disableGlyphCachingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-glyph-caching"]}
              onChange={(v) => setGuacField("disable-glyph-caching", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.enableGfx")}
            description={t("hosts.guac.enableGfxDesc")}
          >
            <FakeSwitch
              checked={form.guacamoleConfig["enable-gfx"] !== false}
              onChange={(v) => setGuacField("enable-gfx", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.deviceRedirection")}
        icon={<Settings className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <SettingRow
            label={t("hosts.guac.enablePrinting")}
            description={t("hosts.guac.enablePrintingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-printing"]}
              onChange={(v) => setGuacField("enable-printing", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.enableDriveRedirection")}
            description={t("hosts.guac.enableDriveRedirectionDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-drive"]}
              onChange={(v) => setGuacField("enable-drive", v)}
            />
          </SettingRow>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-border pt-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.driveName")}
              </label>
              <Input
                placeholder="Termix Drive"
                value={form.guacamoleConfig["drive-name"] ?? ""}
                onChange={(e) => setGuacField("drive-name", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.drivePath")}
              </label>
              <Input
                placeholder="/home/user/shared"
                value={form.guacamoleConfig["drive-path"] ?? ""}
                onChange={(e) => setGuacField("drive-path", e.target.value)}
              />
            </div>
          </div>
          <SettingRow
            label={t("hosts.guac.createDrivePath")}
            description={t("hosts.guac.createDrivePathDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["create-drive-path"]}
              onChange={(v) => setGuacField("create-drive-path", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.disableDownload")}
            description={t("hosts.guac.disableDownloadDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-download"]}
              onChange={(v) => setGuacField("disable-download", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.disableUpload")}
            description={t("hosts.guac.disableUploadDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-upload"]}
              onChange={(v) => setGuacField("disable-upload", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.enableTouch")}
            description={t("hosts.guac.enableTouchDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["enable-touch"]}
              onChange={(v) => setGuacField("enable-touch", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.session")}
        icon={<Server className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.clientName")}
            </label>
            <Input
              placeholder="Termix"
              value={form.guacamoleConfig["client-name"] ?? ""}
              onChange={(e) => setGuacField("client-name", e.target.value)}
            />
          </div>
          <SettingRow
            label={t("hosts.guac.consoleSession")}
            description={t("hosts.guac.consoleSessionDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["console"]}
              onChange={(v) => setGuacField("console", v)}
            />
          </SettingRow>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.initialProgram")}
            </label>
            <Input
              placeholder="e.g. cmd.exe"
              value={form.guacamoleConfig["initial-program"] ?? ""}
              onChange={(e) => setGuacField("initial-program", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.serverLayout")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["server-layout"] ?? "auto"}
              onChange={(e) => setGuacField("server-layout", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option>en-us-qwerty</option>
              <option>en-gb-qwerty</option>
              <option>de-de-qwertz</option>
              <option>fr-fr-azerty</option>
              <option>it-it-qwerty</option>
              <option>sv-se-qwerty</option>
              <option>ja-jp-qwerty</option>
              <option>pt-br-qwerty</option>
              <option>es-es-qwerty</option>
              <option>failsafe</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.timezone")}
            </label>
            <Input
              placeholder="e.g. America/New_York"
              value={form.guacamoleConfig["timezone"] ?? ""}
              onChange={(e) => setGuacField("timezone", e.target.value)}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.gateway")}
        icon={<Network className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.gatewayHostname")}
              </label>
              <Input
                placeholder="gateway.example.com"
                value={form.guacamoleConfig["gateway-hostname"] ?? ""}
                onChange={(e) =>
                  setGuacField("gateway-hostname", e.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.gatewayPort")}
              </label>
              <Input
                type="number"
                placeholder="443"
                value={form.guacamoleConfig["gateway-port"] ?? ""}
                onChange={(e) => setGuacField("gateway-port", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.gatewayUsername")}
              </label>
              <Input
                placeholder="user"
                value={form.guacamoleConfig["gateway-username"] ?? ""}
                onChange={(e) =>
                  setGuacField("gateway-username", e.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.gatewayPassword")}
              </label>
              <PasswordInput
                className="h-8 text-xs pr-8"
                placeholder="••••••••"
                value={form.guacamoleConfig["gateway-password"] ?? ""}
                onChange={(e) =>
                  setGuacField("gateway-password", e.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.gatewayDomain")}
              </label>
              <Input
                placeholder="DOMAIN"
                value={form.guacamoleConfig["gateway-domain"] ?? ""}
                onChange={(e) => setGuacField("gateway-domain", e.target.value)}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.remoteApp")}
        icon={<Monitor className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.remoteAppProgram")}
            </label>
            <Input
              placeholder="||MyApp"
              value={form.guacamoleConfig["remote-app"] ?? ""}
              onChange={(e) => setGuacField("remote-app", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.workingDirectory")}
            </label>
            <Input
              placeholder="C:\Apps\MyApp"
              value={form.guacamoleConfig["remote-app-dir"] ?? ""}
              onChange={(e) => setGuacField("remote-app-dir", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.arguments")}
            </label>
            <Input
              placeholder="--flag value"
              value={form.guacamoleConfig["remote-app-args"] ?? ""}
              onChange={(e) => setGuacField("remote-app-args", e.target.value)}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.clipboard")}
        icon={<Copy className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.normalizeLineEndings")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["normalize-clipboard"] ?? "auto"}
              onChange={(e) =>
                setGuacField("normalize-clipboard", e.target.value)
              }
            >
              <option value="auto">Auto</option>
              <option value="preserve">Preserve</option>
              <option value="unix">Unix (LF)</option>
              <option value="windows">Windows (CRLF)</option>
            </select>
          </div>
          <SettingRow
            label={t("hosts.guac.disableCopy")}
            description={t("hosts.guac.disableCopyDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-copy"]}
              onChange={(v) => setGuacField("disable-copy", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.disablePaste")}
            description={t("hosts.guac.disablePasteDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-paste"]}
              onChange={(v) => setGuacField("disable-paste", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.sessionRecording")}
        icon={<Activity className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/setup/remote-desktop#session-recording"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.recordingPath")}
            </label>
            <Input
              placeholder="/var/lib/termix/recordings"
              value={form.guacamoleConfig["recording-path"] ?? ""}
              onChange={(e) => setGuacField("recording-path", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.recordingName")}
            </label>
            <Input
              placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
              value={form.guacamoleConfig["recording-name"] ?? ""}
              onChange={(e) => setGuacField("recording-name", e.target.value)}
            />
          </div>
          <SettingRow
            label={t("hosts.guac.createPathIfMissing")}
            description={t("hosts.guac.createPathIfMissingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["create-recording-path"]}
              onChange={(v) => setGuacField("create-recording-path", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.excludeOutput")}
            description={t("hosts.guac.excludeOutputDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-exclude-output"]}
              onChange={(v) => setGuacField("recording-exclude-output", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.excludeMouse")}
            description={t("hosts.guac.excludeMouseDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-exclude-mouse"]}
              onChange={(v) => setGuacField("recording-exclude-mouse", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.includeKeystrokes")}
            description={t("hosts.guac.includeKeystrokesDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-include-keys"]}
              onChange={(v) => setGuacField("recording-include-keys", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.wakeOnLan")}
        icon={<Zap className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/features/networking/wake-on-lan"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <SettingRow
            label={t("hosts.guac.sendWolPacket")}
            description={t("hosts.guac.sendWolPacketDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["wol-send-packet"]}
              onChange={(v) => setGuacField("wol-send-packet", v)}
            />
          </SettingRow>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.macAddress")}
              </label>
              <Input
                placeholder="AA:BB:CC:DD:EE:FF"
                value={
                  form.guacamoleConfig["wol-mac-addr"] ?? host?.macAddress ?? ""
                }
                onChange={(e) => setGuacField("wol-mac-addr", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.broadcastAddress")}
              </label>
              <Input
                placeholder="255.255.255.255"
                value={form.guacamoleConfig["wol-broadcast-addr"] ?? ""}
                onChange={(e) =>
                  setGuacField("wol-broadcast-addr", e.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.udpPort")}
              </label>
              <Input
                type="number"
                placeholder="9"
                value={form.guacamoleConfig["wol-udp-port"] ?? ""}
                onChange={(e) => setGuacField("wol-udp-port", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.waitTimeS")}
              </label>
              <Input
                type="number"
                placeholder="0"
                value={form.guacamoleConfig["wol-wait-time"] ?? ""}
                onChange={(e) => setGuacField("wol-wait-time", e.target.value)}
              />
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

export function HostEditorVncTab({
  form,
  setField,
  setGuacField,
  host,
  credentials,
}: {
  form: HostEditorForm;
  setField: HostEditorSetField;
  setGuacField: GuacFieldSetter;
  host?: Host | null;
  credentials?: { id: string; name: string; username: string }[];
}) {
  const { t } = useTranslation();

  return (
    <>
      <SectionCard
        title={t("hosts.guac.connection")}
        icon={<Globe className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/setup/remote-desktop"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.vncPort")}
            </label>
            <Input
              type="number"
              placeholder="5900"
              value={form.vncPort}
              onChange={(e) => setField("vncPort", Number(e.target.value))}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.statusChecksLabel")}
        icon={<Activity className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.enableStatusChecks")}
            description={t("hosts.enableStatusChecksDesc")}
          >
            <FakeSwitch
              checked={form.statsConfig.statusCheckEnabled}
              onChange={(v) =>
                setField("statsConfig", {
                  ...form.statsConfig,
                  statusCheckEnabled: v,
                })
              }
            />
          </SettingRow>
          {form.statsConfig.statusCheckEnabled && (
            <SettingRow
              label={t("hosts.useGlobalInterval")}
              description={t("hosts.useGlobalIntervalDesc")}
            >
              <FakeSwitch
                checked={form.statsConfig.useGlobalStatusInterval}
                onChange={(v) =>
                  setField("statsConfig", {
                    ...form.statsConfig,
                    useGlobalStatusInterval: v,
                  })
                }
              />
            </SettingRow>
          )}
          {form.statsConfig.statusCheckEnabled &&
            !form.statsConfig.useGlobalStatusInterval && (
              <SettingRow
                label={t("hosts.checkIntervalS")}
                description={t("hosts.checkIntervalDesc")}
              >
                <Input
                  type="number"
                  value={form.statsConfig.statusCheckInterval}
                  onChange={(e) =>
                    setField("statsConfig", {
                      ...form.statsConfig,
                      statusCheckInterval: Number(e.target.value),
                    })
                  }
                  className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </SettingRow>
            )}
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.guac.guacdProxy")}
        icon={<Cpu className="size-3.5" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.guacdHostname")}
            </label>
            <Input
              placeholder={t("hosts.guac.guacdHostnamePlaceholder")}
              value={(form.guacamoleConfig["guacd-hostname"] as string) ?? ""}
              onChange={(e) => setGuacField("guacd-hostname", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.guacdPort")}
            </label>
            <Input
              type="number"
              placeholder="4822"
              value={(form.guacamoleConfig["guacd-port"] as string) ?? ""}
              onChange={(e) => setGuacField("guacd-port", e.target.value)}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <p className="col-span-full text-[10px] text-muted-foreground -mt-2">
            {t("hosts.guac.guacdProxyDesc")}
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.authentication")}
        icon={<Shield className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          {credentials && credentials.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.authMethod")}
              </label>
              <div className="flex gap-2">
                {(["direct", "credential"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setField("vncAuthType", m)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                      form.vncAuthType === m
                        ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(
                      `hosts.guac.authType${m.charAt(0).toUpperCase() + m.slice(1)}`,
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.vncAuthType === "credential" &&
          credentials &&
          credentials.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.storedCredential")}
              </label>
              <select
                value={form.vncCredentialId}
                onChange={(e) => setField("vncCredentialId", e.target.value)}
                className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("hosts.guac.selectCredential")}</option>
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.guac.vncPassword")}
                </label>
                <PasswordInput
                  className="h-8 text-xs pr-8"
                  placeholder="••••••••"
                  value={form.vncPassword}
                  onChange={(e) => setField("vncPassword", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.guac.vncUsernameOptional")}
                </label>
                <Input
                  placeholder={t("hosts.guac.vncLeaveBlank")}
                  value={form.vncUser}
                  onChange={(e) => setField("vncUser", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.displaySettings")}
        icon={<Monitor className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.colorDepth")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["color-depth"] ?? "auto"}
              onChange={(e) => setGuacField("color-depth", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="8">8-bit</option>
              <option value="16">16-bit</option>
              <option value="24">24-bit</option>
              <option value="32">32-bit</option>
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.width")}
              </label>
              <Input
                type="number"
                placeholder="Auto"
                value={form.guacamoleConfig["width"] ?? ""}
                onChange={(e) => setGuacField("width", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.height")}
              </label>
              <Input
                type="number"
                placeholder="Auto"
                value={form.guacamoleConfig["height"] ?? ""}
                onChange={(e) => setGuacField("height", e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.resizeMethod")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["resize-method"] ?? "auto"}
              onChange={(e) => setGuacField("resize-method", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="display-update">Display Update</option>
              <option value="reconnect">Reconnect</option>
            </select>
          </div>
          <SettingRow
            label={t("hosts.guac.forceLossless")}
            description={t("hosts.guac.forceLosslessDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["force-lossless"]}
              onChange={(v) => setGuacField("force-lossless", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.audioSettings")}
        icon={<Activity className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.guac.disableAudio")}
            description={t("hosts.guac.disableAudioDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-audio"]}
              onChange={(v) => setGuacField("disable-audio", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.vncSettings")}
        icon={<Settings className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.cursorMode")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["cursor"] ?? "auto"}
              onChange={(e) => setGuacField("cursor", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="local">Local</option>
              <option value="remote">Remote</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.serverLayout")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["server-layout"] ?? "auto"}
              onChange={(e) => setGuacField("server-layout", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option>en-us-qwerty</option>
              <option>en-gb-qwerty</option>
              <option>de-de-qwertz</option>
              <option>fr-fr-azerty</option>
              <option>it-it-qwerty</option>
              <option>sv-se-qwerty</option>
              <option>ja-jp-qwerty</option>
              <option>pt-br-qwerty</option>
              <option>es-es-qwerty</option>
              <option>failsafe</option>
            </select>
          </div>
          <SettingRow
            label={t("hosts.guac.swapRedBlue")}
            description={t("hosts.guac.swapRedBlueDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["swap-red-blue"]}
              onChange={(v) => setGuacField("swap-red-blue", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.readOnly")}
            description={t("hosts.guac.readOnlyDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["read-only"]}
              onChange={(v) => setGuacField("read-only", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.clipboard")}
        icon={<Copy className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.normalizeLineEndings")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["normalize-clipboard"] ?? "auto"}
              onChange={(e) =>
                setGuacField("normalize-clipboard", e.target.value)
              }
            >
              <option value="auto">Auto</option>
              <option value="preserve">Preserve</option>
              <option value="unix">Unix (LF)</option>
              <option value="windows">Windows (CRLF)</option>
            </select>
          </div>
          <SettingRow
            label={t("hosts.guac.disableCopy")}
            description={t("hosts.guac.disableCopyDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-copy"]}
              onChange={(v) => setGuacField("disable-copy", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.disablePaste")}
            description={t("hosts.guac.disablePasteDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["disable-paste"]}
              onChange={(v) => setGuacField("disable-paste", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.sessionRecording")}
        icon={<Activity className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/setup/remote-desktop#session-recording"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.recordingPath")}
            </label>
            <Input
              placeholder="/var/lib/termix/recordings"
              value={form.guacamoleConfig["recording-path"] ?? ""}
              onChange={(e) => setGuacField("recording-path", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.recordingName")}
            </label>
            <Input
              placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
              value={form.guacamoleConfig["recording-name"] ?? ""}
              onChange={(e) => setGuacField("recording-name", e.target.value)}
            />
          </div>
          <SettingRow
            label={t("hosts.guac.createPathIfMissing")}
            description={t("hosts.guac.createPathIfMissingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["create-recording-path"]}
              onChange={(v) => setGuacField("create-recording-path", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.excludeOutput")}
            description={t("hosts.guac.excludeOutputDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-exclude-output"]}
              onChange={(v) => setGuacField("recording-exclude-output", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.excludeMouse")}
            description={t("hosts.guac.excludeMouseDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-exclude-mouse"]}
              onChange={(v) => setGuacField("recording-exclude-mouse", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.includeKeystrokes")}
            description={t("hosts.guac.includeKeystrokesDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-include-keys"]}
              onChange={(v) => setGuacField("recording-include-keys", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.wakeOnLan")}
        icon={<Zap className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/features/networking/wake-on-lan"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <SettingRow
            label={t("hosts.guac.sendWolPacket")}
            description={t("hosts.guac.sendWolPacketDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["wol-send-packet"]}
              onChange={(v) => setGuacField("wol-send-packet", v)}
            />
          </SettingRow>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.macAddress")}
              </label>
              <Input
                placeholder="AA:BB:CC:DD:EE:FF"
                value={
                  form.guacamoleConfig["wol-mac-addr"] ?? host?.macAddress ?? ""
                }
                onChange={(e) => setGuacField("wol-mac-addr", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.broadcastAddress")}
              </label>
              <Input
                placeholder="255.255.255.255"
                value={form.guacamoleConfig["wol-broadcast-addr"] ?? ""}
                onChange={(e) =>
                  setGuacField("wol-broadcast-addr", e.target.value)
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.udpPort")}
              </label>
              <Input
                type="number"
                placeholder="9"
                value={form.guacamoleConfig["wol-udp-port"] ?? ""}
                onChange={(e) => setGuacField("wol-udp-port", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.waitTimeS")}
              </label>
              <Input
                type="number"
                placeholder="0"
                value={form.guacamoleConfig["wol-wait-time"] ?? ""}
                onChange={(e) => setGuacField("wol-wait-time", e.target.value)}
              />
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

export function HostEditorTelnetTab({
  form,
  setField,
  setGuacField,
  credentials,
}: {
  form: HostEditorForm;
  setField: HostEditorSetField;
  setGuacField: GuacFieldSetter;
  host?: Host | null;
  credentials?: { id: string; name: string; username: string }[];
}) {
  const { t } = useTranslation();

  return (
    <>
      <SectionCard
        title={t("hosts.guac.connection")}
        icon={<Globe className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/setup/remote-desktop"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.telnetPort")}
            </label>
            <Input
              type="number"
              placeholder="23"
              value={form.telnetPort}
              onChange={(e) => setField("telnetPort", Number(e.target.value))}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.statusChecksLabel")}
        icon={<Activity className="size-3.5" />}
      >
        <div className="flex flex-col gap-0 py-1">
          <SettingRow
            label={t("hosts.enableStatusChecks")}
            description={t("hosts.enableStatusChecksDesc")}
          >
            <FakeSwitch
              checked={form.statsConfig.statusCheckEnabled}
              onChange={(v) =>
                setField("statsConfig", {
                  ...form.statsConfig,
                  statusCheckEnabled: v,
                })
              }
            />
          </SettingRow>
          {form.statsConfig.statusCheckEnabled && (
            <SettingRow
              label={t("hosts.useGlobalInterval")}
              description={t("hosts.useGlobalIntervalDesc")}
            >
              <FakeSwitch
                checked={form.statsConfig.useGlobalStatusInterval}
                onChange={(v) =>
                  setField("statsConfig", {
                    ...form.statsConfig,
                    useGlobalStatusInterval: v,
                  })
                }
              />
            </SettingRow>
          )}
          {form.statsConfig.statusCheckEnabled &&
            !form.statsConfig.useGlobalStatusInterval && (
              <SettingRow
                label={t("hosts.checkIntervalS")}
                description={t("hosts.checkIntervalDesc")}
              >
                <Input
                  type="number"
                  value={form.statsConfig.statusCheckInterval}
                  onChange={(e) =>
                    setField("statsConfig", {
                      ...form.statsConfig,
                      statusCheckInterval: Number(e.target.value),
                    })
                  }
                  className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </SettingRow>
            )}
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.guac.guacdProxy")}
        icon={<Cpu className="size-3.5" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.guacdHostname")}
            </label>
            <Input
              placeholder={t("hosts.guac.guacdHostnamePlaceholder")}
              value={(form.guacamoleConfig["guacd-hostname"] as string) ?? ""}
              onChange={(e) => setGuacField("guacd-hostname", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.guacdPort")}
            </label>
            <Input
              type="number"
              placeholder="4822"
              value={(form.guacamoleConfig["guacd-port"] as string) ?? ""}
              onChange={(e) => setGuacField("guacd-port", e.target.value)}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <p className="col-span-full text-[10px] text-muted-foreground -mt-2">
            {t("hosts.guac.guacdProxyDesc")}
          </p>
        </div>
      </SectionCard>
      <SectionCard
        title={t("hosts.guac.authentication")}
        icon={<Shield className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          {credentials && credentials.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.authMethod")}
              </label>
              <div className="flex gap-2">
                {(["direct", "credential"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setField("telnetAuthType", m)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                      form.telnetAuthType === m
                        ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(
                      `hosts.guac.authType${m.charAt(0).toUpperCase() + m.slice(1)}`,
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.telnetAuthType === "credential" &&
          credentials &&
          credentials.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.storedCredential")}
              </label>
              <select
                value={form.telnetCredentialId}
                onChange={(e) => setField("telnetCredentialId", e.target.value)}
                className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("hosts.guac.selectCredential")}</option>
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.username ? `${c.name} (${c.username})` : c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.guac.username")}
                </label>
                <Input
                  placeholder="admin"
                  value={form.telnetUser}
                  onChange={(e) => setField("telnetUser", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.guac.password")}
                </label>
                <PasswordInput
                  className="h-8 text-xs pr-8"
                  placeholder="••••••••"
                  value={form.telnetPassword}
                  onChange={(e) => setField("telnetPassword", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.displaySettings")}
        icon={<Monitor className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.width")}
              </label>
              <Input
                type="number"
                placeholder="Auto"
                value={form.guacamoleConfig["width"] ?? ""}
                onChange={(e) => setGuacField("width", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.guac.height")}
              </label>
              <Input
                type="number"
                placeholder="Auto"
                value={form.guacamoleConfig["height"] ?? ""}
                onChange={(e) => setGuacField("height", e.target.value)}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.terminalSettings")}
        icon={<Terminal className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.terminalType")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["terminal-type"] ?? "auto"}
              onChange={(e) => setGuacField("terminal-type", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="xterm">xterm</option>
              <option value="xterm-256color">xterm-256color</option>
              <option value="vt100">VT100</option>
              <option value="vt220">VT220</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.fontName")}
            </label>
            <Input
              placeholder="monospace"
              value={form.guacamoleConfig["font-name"] ?? ""}
              onChange={(e) => setGuacField("font-name", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.fontSize")}
            </label>
            <Input
              type="number"
              value={form.guacamoleConfig["font-size"] ?? 12}
              onChange={(e) =>
                setGuacField("font-size", Number(e.target.value))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.colorScheme")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["color-scheme"] ?? "auto"}
              onChange={(e) => setGuacField("color-scheme", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="black-white">Black on White</option>
              <option value="white-black">White on Black</option>
              <option value="gray-black">Gray on Black</option>
              <option value="green-black">Green on Black</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.backspaceKey")}
            </label>
            <select
              className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={form.guacamoleConfig["backspace"] ?? "auto"}
              onChange={(e) => setGuacField("backspace", e.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="127">DEL (127)</option>
              <option value="8">BS (8)</option>
            </select>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.guac.sessionRecording")}
        icon={<Activity className="size-3.5" />}
        action={
          <DocsLinkAction
            href="https://docs.termix.site/setup/remote-desktop#session-recording"
            label={t("hosts.docsLink")}
          />
        }
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.recordingPath")}
            </label>
            <Input
              placeholder="/var/lib/termix/recordings"
              value={form.guacamoleConfig["recording-path"] ?? ""}
              onChange={(e) => setGuacField("recording-path", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.guac.recordingName")}
            </label>
            <Input
              placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
              value={form.guacamoleConfig["recording-name"] ?? ""}
              onChange={(e) => setGuacField("recording-name", e.target.value)}
            />
          </div>
          <SettingRow
            label={t("hosts.guac.createPathIfMissing")}
            description={t("hosts.guac.createPathIfMissingDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["create-recording-path"]}
              onChange={(v) => setGuacField("create-recording-path", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.excludeOutput")}
            description={t("hosts.guac.excludeOutputDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-exclude-output"]}
              onChange={(v) => setGuacField("recording-exclude-output", v)}
            />
          </SettingRow>
          <SettingRow
            label={t("hosts.guac.includeKeystrokes")}
            description={t("hosts.guac.includeKeystrokesDesc")}
          >
            <FakeSwitch
              checked={!!form.guacamoleConfig["recording-include-keys"]}
              onChange={(v) => setGuacField("recording-include-keys", v)}
            />
          </SettingRow>
        </div>
      </SectionCard>
    </>
  );
}
