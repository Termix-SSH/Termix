import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isElectron } from "@/lib/electron";
import {
  unreachableTunnelReason,
  type TunnelRefusalReason,
} from "@/lib/web-endpoint-url";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Checkbox } from "@/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import {
  MAX_WEB_ENDPOINTS,
  MAX_WEB_ENDPOINT_LABEL_LENGTH,
  type WebEndpoint,
  type WebUiConfig,
} from "@/types/index";
import {
  MAX_WEB_ENDPOINT_PORT,
  MIN_WEB_ENDPOINT_PORT,
  isWebEndpointPortValid,
  webEndpointErrorKey,
  webEndpointRowError,
} from "@/lib/web-endpoint-validation";

/**
 * crypto.randomUUID is undefined outside a secure context, so a plain-http web
 * deployment -- a first-class target for the direct+external path -- would
 * throw on "Add endpoint". Matches the guarded form already used in
 * MacrosPanel, PanePreview, KeybindingsDialog and AppShell.
 */
function endpointId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const BIND_HOST_REFUSAL_MESSAGES: Record<TunnelRefusalReason, string> = {
  "loopback-bind-on-remote-backend": "hosts.webUiBindHostUnreachable",
  "shares-session-cookie-with-termix": "hosts.webUiBindHostSharesSessionCookie",
};

/**
 * True when the bind address reaches beyond the machine running the backend. A
 * forward bound there serves the target's web UI to anyone who can reach the
 * port, with no authentication in front of it, so the editor says so plainly
 * rather than leaving it to be discovered.
 */
function isExposedBindHost(bindHost: string | undefined): boolean {
  const value = (bindHost ?? "").trim();
  if (!value) return false;
  return !["127.0.0.1", "localhost", "::1", "[::1]"].includes(
    value.toLowerCase(),
  );
}

function newEndpoint(label: string): WebEndpoint {
  return {
    id: endpointId(),
    label,
    scheme: "https",
    port: 443,
    path: "/",
    access: "direct",
    render: "external",
  };
}

export function HostEditorWebUiSection({
  enableWebUi,
  webUiConfig,
  tunnelAvailable,
  setField,
}: {
  enableWebUi: boolean;
  webUiConfig: WebUiConfig;
  tunnelAvailable: boolean;
  setField: (field: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const endpoints = webUiConfig?.endpoints ?? [];

  const commit = (next: WebEndpoint[]) =>
    setField("webUiConfig", { endpoints: next });

  const update = (index: number, patch: Partial<WebEndpoint>) =>
    commit(
      endpoints.map((endpoint, i) =>
        i === index ? { ...endpoint, ...patch } : endpoint,
      ),
    );

  // Labels identify an endpoint in the sidebar picker, so a fresh row must not
  // silently collide with one already there.
  const uniqueLabel = (base: string) => {
    const taken = new Set(endpoints.map((e) => e.label.trim()));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base} ${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  };

  const addEndpoint = () =>
    commit([
      ...endpoints,
      newEndpoint(uniqueLabel(t("hosts.webUiNewEndpointLabel"))),
    ]);

  return (
    // Two cards, as the tunnels tab does: settings first, then the list it
    // governs, each with its own header.
    <>
      <SectionCard
        title={t("hosts.webUiIntegration")}
        icon={<Globe className="size-3.5" />}
      >
        <div className="flex flex-col gap-4 py-3">
          <SettingRow
            label={t("hosts.enableWebUi")}
            description={t("hosts.enableWebUiDesc")}
          >
            <FakeSwitch
              checked={enableWebUi}
              onChange={(v: boolean) => setField("enableWebUi", v)}
            />
          </SettingRow>
          <div className="text-xs text-muted-foreground p-3 bg-muted/30 border border-border space-y-1">
            <p>{t("hosts.webUiRequirementsText")}</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("hosts.webUiEndpointsSection")}
        icon={<Globe className="size-3.5" />}
        action={
          enableWebUi ? (
            // Same header control, and the same classes, as the tunnels list.
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
              disabled={endpoints.length >= MAX_WEB_ENDPOINTS}
              onClick={addEndpoint}
            >
              {t("hosts.webUiAddEndpoint")}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4 py-3">
          {enableWebUi && (
            <div className="flex flex-col gap-3">
              {endpoints.map((endpoint, index) => {
                const rowError = webEndpointRowError(endpoint);
                return (
                  <div
                    key={endpoint.id}
                    className="flex flex-col gap-3 p-3 border border-border bg-muted/20 relative group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-muted-foreground">
                        {t("hosts.webUiEndpointLabel", { number: index + 1 })}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("hosts.webUiRemoveEndpoint")}
                        className="h-6 text-[10px] px-2 text-destructive"
                        onClick={() =>
                          commit(endpoints.filter((_, i) => i !== index))
                        }
                      >
                        {t("common.delete")}
                      </Button>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground">
                        {t("hosts.webUiLabel")}
                      </label>
                      <Input
                        aria-label={t("hosts.webUiLabel")}
                        value={endpoint.label}
                        onChange={(e) =>
                          update(index, { label: e.target.value })
                        }
                        maxLength={MAX_WEB_ENDPOINT_LABEL_LENGTH}
                        className="h-7 text-xs"
                      />
                    </div>

                    {rowError && (
                      <p className="text-[11px] text-destructive">
                        {t(webEndpointErrorKey(rowError), { row: index + 1 })}
                      </p>
                    )}

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground">
                        {t("hosts.webUiAddress")}
                      </label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={endpoint.scheme}
                          onValueChange={(value) =>
                            update(index, {
                              scheme: value as WebEndpoint["scheme"],
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label={t("hosts.webUiScheme")}
                            className="h-7 w-24 text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="https" className="text-xs">
                              https
                            </SelectItem>
                            <SelectItem value="http" className="text-xs">
                              http
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          aria-label={t("hosts.webUiPort")}
                          type="number"
                          min={MIN_WEB_ENDPOINT_PORT}
                          max={MAX_WEB_ENDPOINT_PORT}
                          value={endpoint.port}
                          onChange={(e) => {
                            // Number("") is 0, which the normalizer rejects --
                            // so clearing the field would otherwise write an
                            // endpoint that is silently dropped on save.
                            // Commit only a value the normalizer would keep;
                            // anything else leaves the last good port.
                            const parsed = Number(e.target.value);
                            if (isWebEndpointPortValid(parsed)) {
                              update(index, { port: parsed });
                            }
                          }}
                          className="h-7 w-20 text-xs"
                        />
                        <Input
                          aria-label={t("hosts.webUiPath")}
                          value={endpoint.path ?? "/"}
                          onChange={(e) =>
                            update(index, { path: e.target.value })
                          }
                          className="h-7 flex-1 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground">
                        {t("hosts.webUiOpening")}
                      </label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={endpoint.access}
                          onValueChange={(value) =>
                            update(index, {
                              access: value as WebEndpoint["access"],
                              // Meaningless for a tunnel, whose host component
                              // is loopback and already exempt.
                              ignoreCert:
                                value === "direct"
                                  ? endpoint.ignoreCert
                                  : false,
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label={t("hosts.webUiAccess")}
                            className="h-7 flex-1 text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="direct" className="text-xs">
                              {t("hosts.webUiAccessDirect")}
                            </SelectItem>
                            <SelectItem
                              value="tunnel"
                              disabled={!tunnelAvailable}
                            >
                              {t("hosts.webUiAccessTunnel")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={endpoint.render}
                          onValueChange={(value) =>
                            update(index, {
                              render: value as WebEndpoint["render"],
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label={t("hosts.webUiRender")}
                            className="h-7 flex-1 text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="external" className="text-xs">
                              {t("hosts.webUiRenderExternal")}
                            </SelectItem>
                            <SelectItem value="embedded" className="text-xs">
                              {t("hosts.webUiRenderEmbedded")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {endpoint.access === "tunnel" && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground">
                          {t("hosts.bindHost")}
                        </label>
                        <Input
                          aria-label={t("hosts.bindHost")}
                          placeholder="127.0.0.1"
                          value={endpoint.bindHost ?? ""}
                          onChange={(e) =>
                            update(index, { bindHost: e.target.value })
                          }
                          className="h-7 text-xs"
                        />
                        <p className="text-[11px] opacity-70">
                          {t("hosts.webUiBindHostDesc")}
                        </p>
                        <label className="text-[10px] font-bold text-muted-foreground">
                          {t("hosts.webUiLocalPort")}
                        </label>
                        <Input
                          aria-label={t("hosts.webUiLocalPort")}
                          type="number"
                          min={MIN_WEB_ENDPOINT_PORT}
                          max={MAX_WEB_ENDPOINT_PORT}
                          placeholder={t("hosts.webUiLocalPortAuto")}
                          value={endpoint.localPort ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              update(index, { localPort: undefined });
                              return;
                            }
                            const parsed = Number(raw);
                            if (isWebEndpointPortValid(parsed)) {
                              update(index, { localPort: parsed });
                            }
                          }}
                          className="h-7 text-xs"
                        />
                        <p className="text-[11px] opacity-70">
                          {t("hosts.webUiLocalPortDesc")}
                        </p>
                        {isExposedBindHost(endpoint.bindHost) && (
                          <p className="text-[11px] text-destructive">
                            {t("hosts.webUiBindHostExposed")}
                          </p>
                        )}
                        {(() => {
                          // Said while configuring, not only when the tab fails
                          // to load: a loopback bind on a backend that is not
                          // this machine opens fine and then leaves the browser
                          // with nothing to connect to, and a tunnel reached at
                          // Termix's own hostname would hand the tunnelled
                          // service this session.
                          const refusal = unreachableTunnelReason(
                            endpoint,
                            isElectron(),
                          );
                          if (!refusal) return null;
                          return (
                            <p className="text-[11px] text-destructive">
                              {t(BIND_HOST_REFUSAL_MESSAGES[refusal])}
                            </p>
                          );
                        })()}
                      </div>
                    )}

                    {endpoint.render === "embedded" && (
                      <p className="text-[11px] opacity-70">
                        {t("hosts.webUiRenderEmbeddedDesc")}
                      </p>
                    )}

                    {endpoint.access === "direct" && (
                      <div className="flex flex-col gap-1">
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={endpoint.ignoreCert === true}
                            onCheckedChange={(value) =>
                              update(index, { ignoreCert: value === true })
                            }
                          />
                          {t("hosts.webUiIgnoreCert")}
                        </label>
                        <p className="text-[11px] opacity-70">
                          {t("hosts.webUiIgnoreCertDesc")}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {!tunnelAvailable && endpoints.length > 0 && (
                // Shown whenever tunnelling is unavailable, not only once a row
                // already asks for it: the Tunnel option renders disabled, and
                // a disabled control with no stated reason reads as the
                // dropdown being broken.
                <p className="text-[11px] opacity-70">
                  {t("hosts.webUiAccessTunnelUnavailable")}
                </p>
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </>
  );
}
