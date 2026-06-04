import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { FakeSwitch, SectionCard, SettingRow } from "@/components/section-card";
import type { Host } from "@/types/ui-types";
import {
  Globe,
  Monitor,
  MousePointerClick,
  Plus,
  Tag,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type { HostEditorForm, HostProtocols } from "./HostEditorData";

type HostEditorSetField = <K extends keyof HostEditorForm>(
  key: K,
  value: HostEditorForm[K],
) => void;

export function HostEditorGeneralTab({
  form,
  setField,
  protocols,
  handleProtocolToggle,
  hosts,
  host,
}: {
  form: HostEditorForm;
  setField: HostEditorSetField;
  protocols: HostProtocols;
  handleProtocolToggle: (proto: keyof HostProtocols, value: boolean) => void;
  hosts: Host[];
  host: Host | null;
}) {
  const { t } = useTranslation();

  return (
    <>
      {/* Protocols — enable/disable each connection type */}
      <SectionCard
        title={t("hosts.protocols")}
        icon={<Globe className="size-3.5" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 py-3">
          {[
            {
              proto: "enableSsh" as const,
              label: t("hosts.tabSsh"),
              desc: t("hosts.secureShell"),
              icon: <Terminal className="size-4" />,
              portField: "sshPort" as const,
            },
            {
              proto: "enableRdp" as const,
              label: t("hosts.tabRdp"),
              desc: t("hosts.remoteDesktop"),
              icon: <Monitor className="size-4" />,
              portField: "rdpPort" as const,
            },
            {
              proto: "enableVnc" as const,
              label: t("hosts.tabVnc"),
              desc: t("hosts.virtualNetwork"),
              icon: <MousePointerClick className="size-4" />,
              portField: "vncPort" as const,
            },
            {
              proto: "enableTelnet" as const,
              label: t("hosts.tabTelnet"),
              desc: t("hosts.unencryptedShell"),
              icon: <Terminal className="size-4" />,
              portField: "telnetPort" as const,
            },
          ].map(({ proto, label, desc, icon }) => {
            const enabled = protocols[proto];
            return (
              <div
                key={proto}
                className={`flex items-center gap-3 p-3 border transition-colors ${enabled ? "border-accent-brand/20 bg-accent-brand/5" : "border-border bg-muted/10"}`}
              >
                <div
                  className={`size-8 flex items-center justify-center shrink-0 ${enabled ? "text-accent-brand" : "text-muted-foreground/30"}`}
                >
                  {icon}
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <span
                    className={`text-xs font-bold ${enabled ? "text-foreground" : "text-muted-foreground/50"}`}
                  >
                    {label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50">
                    {desc}
                  </span>
                </div>
                <FakeSwitch
                  checked={enabled}
                  onChange={(v: boolean) => handleProtocolToggle(proto, v)}
                />
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.connectionDetails")}
        icon={<Globe className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.addressIp")}
            </label>
            <Input
              placeholder="10.0.0.1 or example.com"
              value={form.ip}
              onChange={(e) => setField("ip", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.friendlyName")}
              </label>
              <Input
                placeholder="e.g. Web Server Production"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>
            {protocols.enableSsh && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  MAC Address
                </label>
                <Input
                  placeholder="AA:BB:CC:DD:EE:FF"
                  value={form.macAddress}
                  onChange={(e) => setField("macAddress", e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {!protocols.enableSsh &&
        !protocols.enableRdp &&
        !protocols.enableVnc &&
        !protocols.enableTelnet && (
          <div className="flex items-center gap-3 p-3 border border-border bg-muted/20 text-xs text-muted-foreground">
            <Globe className="size-4 shrink-0 text-muted-foreground/40" />
            <span>{t("hosts.enableAtLeastOneProtocol")}</span>
          </div>
        )}

      <SectionCard
        title={t("hosts.folderAndAdvanced")}
        icon={<Tag className="size-3.5" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.folder")}
            </label>
            <Input
              placeholder="e.g. Production"
              value={form.folder}
              onChange={(e) => setField("folder", e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.tags")}
            </label>
            <div className="flex flex-wrap items-center gap-1 min-h-9 px-2 py-1 border border-border bg-background focus-within:ring-1 focus-within:ring-ring">
              {form.tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-muted border border-border/60 text-foreground"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() =>
                      setField(
                        "tags",
                        form.tags.filter((tg) => tg !== tag),
                      )
                    }
                    className="text-muted-foreground hover:text-destructive ml-0.5"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
              <input
                className="flex-1 min-w-16 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                placeholder={form.tags.length === 0 ? t("hosts.addTag") : ""}
                value={form.tagInput}
                onChange={(e) => setField("tagInput", e.target.value)}
                onKeyDown={(e) => {
                  if (
                    (e.key === " " || e.key === "Enter") &&
                    form.tagInput.trim()
                  ) {
                    e.preventDefault();
                    const tag = form.tagInput.trim();
                    if (!form.tags.includes(tag))
                      setField("tags", [...form.tags, tag]);
                    setField("tagInput", "");
                  } else if (
                    e.key === "Backspace" &&
                    !form.tagInput &&
                    form.tags.length > 0
                  ) {
                    setField("tags", form.tags.slice(0, -1));
                  }
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 col-span-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.privateNotes")}
            </label>
            <textarea
              rows={3}
              placeholder={t("hosts.privateNotesPlaceholder")}
              className="w-full px-3 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </div>
          <SettingRow
            label={t("hosts.pinToTop")}
            description={t("hosts.pinToTopDesc")}
          >
            <FakeSwitch
              checked={form.pin}
              onChange={(v) => setField("pin", v)}
            />
          </SettingRow>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4 pb-0">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("hosts.portKnockingSequence")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
              onClick={() =>
                setField("portKnockSequence", [
                  ...form.portKnockSequence,
                  { port: 0, protocol: "tcp" as const, delay: 0 },
                ])
              }
            >
              <Plus className="size-3 mr-1" /> {t("hosts.addKnockBtn")}
            </Button>
          </div>
          {form.portKnockSequence.length === 0 && (
            <p className="text-[10px] text-muted-foreground/50">
              {t("hosts.noPortKnocking")}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {form.portKnockSequence.map((knock, i) => (
              <div
                key={i}
                className="flex items-end gap-1.5 p-1.5 bg-muted/30 border border-border"
              >
                <span className="text-[9px] font-bold text-muted-foreground/50 mb-1.5 shrink-0">
                  {i + 1}.
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wide px-0.5">
                    {t("hosts.knockPort")}
                  </span>
                  <Input
                    className="h-7 text-xs w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="8080"
                    type="number"
                    value={knock.port}
                    onChange={(e) => {
                      const updated = [...form.portKnockSequence];
                      updated[i] = {
                        ...updated[i],
                        port: Number(e.target.value),
                      };
                      setField("portKnockSequence", updated);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wide px-0.5">
                    {t("hosts.protocol")}
                  </span>
                  <select
                    className="h-7 text-[10px] bg-background border border-border px-1"
                    value={knock.protocol}
                    onChange={(e) => {
                      const updated = [...form.portKnockSequence];
                      updated[i] = {
                        ...updated[i],
                        protocol: e.target.value as "tcp" | "udp",
                      };
                      setField("portKnockSequence", updated);
                    }}
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wide px-0.5">
                    {t("hosts.delayAfterMs")}
                  </span>
                  <Input
                    className="h-7 text-xs w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    placeholder="100"
                    type="number"
                    value={knock.delay}
                    onChange={(e) => {
                      const updated = [...form.portKnockSequence];
                      updated[i] = {
                        ...updated[i],
                        delay: Number(e.target.value),
                      };
                      setField("portKnockSequence", updated);
                    }}
                  />
                </div>
                <button
                  className="text-destructive p-1 mb-0.5"
                  onClick={() =>
                    setField(
                      "portKnockSequence",
                      form.portKnockSequence.filter((_, idx) => idx !== i),
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-border pt-4 pb-2">
          <SettingRow
            label={t("hosts.useSocks5Proxy")}
            description={t("hosts.useSocks5ProxyDesc")}
          >
            <FakeSwitch
              checked={form.useSocks5}
              onChange={(v) => setField("useSocks5", v)}
            />
          </SettingRow>
          {form.useSocks5 && (
            <div className="flex flex-col gap-3">
              {/* Single / Chain mode toggle */}
              <div className="flex gap-2">
                {(["single", "chain"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setField("socks5ProxyMode", m)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${form.socks5ProxyMode === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {m === "single"
                      ? t("hosts.proxySingleMode")
                      : t("hosts.proxyChainMode")}
                  </button>
                ))}
              </div>

              {form.socks5ProxyMode === "single" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-muted/20 border border-border">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.proxyHost")}
                    </label>
                    <Input
                      className="h-7 text-xs"
                      placeholder="proxy.example.com"
                      value={form.socks5Host}
                      onChange={(e) => setField("socks5Host", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.proxyPort")}
                    </label>
                    <Input
                      className="h-7 text-xs"
                      type="number"
                      placeholder="1080"
                      value={form.socks5Port}
                      onChange={(e) =>
                        setField("socks5Port", Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.proxyUsername")}
                    </label>
                    <Input
                      className="h-7 text-xs"
                      placeholder={t("hosts.optional")}
                      value={form.socks5Username}
                      onChange={(e) =>
                        setField("socks5Username", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.proxyPassword")}
                    </label>
                    <PasswordInput
                      className="h-7 text-xs pr-8"
                      placeholder={t("hosts.optional")}
                      value={form.socks5Password}
                      onChange={(e) =>
                        setField("socks5Password", e.target.value)
                      }
                    />
                  </div>
                </div>
              )}

              {form.socks5ProxyMode === "chain" && (
                <div className="flex flex-col gap-2">
                  {form.socks5ProxyChain.map((node, ni) => (
                    <div
                      key={ni}
                      className="flex flex-col gap-2 p-3 bg-muted/20 border border-border"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-muted-foreground">
                          {t("hosts.proxyNode")} {ni + 1}
                        </span>
                        <button
                          type="button"
                          className="text-destructive"
                          onClick={() =>
                            setField(
                              "socks5ProxyChain",
                              form.socks5ProxyChain.filter(
                                (_, idx) => idx !== ni,
                              ),
                            )
                          }
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyHost")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            placeholder="proxy.example.com"
                            value={node.host}
                            onChange={(e) => {
                              const u = [...form.socks5ProxyChain];
                              u[ni] = { ...u[ni], host: e.target.value };
                              setField("socks5ProxyChain", u);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyPort")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            type="number"
                            placeholder="1080"
                            value={node.port}
                            onChange={(e) => {
                              const u = [...form.socks5ProxyChain];
                              u[ni] = {
                                ...u[ni],
                                port: Number(e.target.value),
                              };
                              setField("socks5ProxyChain", u);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyType")}
                          </label>
                          <select
                            className="h-7 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                            value={node.type}
                            onChange={(e) => {
                              const u = [...form.socks5ProxyChain];
                              u[ni] = { ...u[ni], type: e.target.value };
                              setField("socks5ProxyChain", u);
                            }}
                          >
                            <option value="socks5">SOCKS5</option>
                            <option value="socks4">SOCKS4</option>
                            <option value="http">HTTP</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyUsername")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            placeholder={t("hosts.optional")}
                            value={node.username}
                            onChange={(e) => {
                              const u = [...form.socks5ProxyChain];
                              u[ni] = {
                                ...u[ni],
                                username: e.target.value,
                              };
                              setField("socks5ProxyChain", u);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1 col-span-2">
                          <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyPassword")}
                          </label>
                          <PasswordInput
                            className="h-7 text-xs pr-8"
                            placeholder={t("hosts.optional")}
                            value={node.password}
                            onChange={(e) => {
                              const u = [...form.socks5ProxyChain];
                              u[ni] = {
                                ...u[ni],
                                password: e.target.value,
                              };
                              setField("socks5ProxyChain", u);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand self-start"
                    onClick={() =>
                      setField("socks5ProxyChain", [
                        ...form.socks5ProxyChain,
                        {
                          host: "",
                          port: 1080,
                          type: "socks5",
                          username: "",
                          password: "",
                        },
                      ])
                    }
                  >
                    <Plus className="size-3 mr-1" /> {t("hosts.addProxyNode")}
                  </Button>
                </div>
              )}

              {/* Connection path visualization */}
              {(form.socks5ProxyMode === "single" && form.socks5Host) ||
              (form.socks5ProxyMode === "chain" &&
                form.socks5ProxyChain.length > 0) ? (
                <div className="flex items-center gap-1 flex-wrap p-2 bg-muted/30 border border-border text-[10px]">
                  <span className="px-2 py-0.5 bg-background border border-border text-foreground font-mono">
                    {t("hosts.you")}
                  </span>
                  {form.socks5ProxyMode === "single" && form.socks5Host ? (
                    <>
                      <span className="text-muted-foreground">→</span>
                      <span className="px-2 py-0.5 bg-muted border border-border text-muted-foreground font-mono">
                        {form.socks5Host}:{form.socks5Port}
                      </span>
                    </>
                  ) : (
                    form.socks5ProxyChain
                      .filter((n) => n.host)
                      .map((n, ni) => (
                        <React.Fragment key={ni}>
                          <span className="text-muted-foreground">→</span>
                          <span className="px-2 py-0.5 bg-muted border border-border text-muted-foreground font-mono">
                            {n.host}:{n.port}
                          </span>
                        </React.Fragment>
                      ))
                  )}
                  {form.jumpHosts
                    .filter((j) => j.hostId)
                    .map((j, ji) => {
                      const jh = hosts.find((h) => h.id === j.hostId);
                      return jh ? (
                        <React.Fragment key={`j${ji}`}>
                          <span className="text-muted-foreground">→</span>
                          <span className="px-2 py-0.5 bg-muted border border-border text-muted-foreground font-mono">
                            {jh.name || jh.ip}
                          </span>
                        </React.Fragment>
                      ) : null;
                    })}
                  <span className="text-muted-foreground">→</span>
                  <span className="px-2 py-0.5 bg-accent-brand/10 border border-accent-brand/30 text-accent-brand font-mono">
                    {form.ip || "target"}:{form.sshPort}
                  </span>
                </div>
              ) : null}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.jumpHostChainLabel")}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                onClick={() =>
                  setField("jumpHosts", [...form.jumpHosts, { hostId: "" }])
                }
              >
                <Plus className="size-3 mr-1" /> {t("hosts.addJumpBtn")}
              </Button>
            </div>
            {form.jumpHosts.length === 0 && (
              <p className="text-[10px] text-muted-foreground/50">
                {t("hosts.noJumpHosts")}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {form.jumpHosts.map((jh, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 bg-background border border-border"
                >
                  <span className="text-[10px] font-bold text-muted-foreground shrink-0">
                    {i + 1}.
                  </span>
                  <select
                    className="flex h-7 flex-1 border border-border bg-background px-2 py-0 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={jh.hostId}
                    onChange={(e) => {
                      const updated = [...form.jumpHosts];
                      updated[i] = { hostId: e.target.value };
                      setField("jumpHosts", updated);
                    }}
                  >
                    <option value="">{t("hosts.selectAServer")}</option>
                    {hosts
                      .filter((h) => (host ? h.id !== host.id : true))
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name || h.ip}
                        </option>
                      ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    onClick={() =>
                      setField(
                        "jumpHosts",
                        form.jumpHosts.filter((_, idx) => idx !== i),
                      )
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  );
}
