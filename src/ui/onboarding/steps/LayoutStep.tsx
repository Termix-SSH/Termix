import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Download, Power } from "lucide-react";
import type { OnboardingStepProps } from "@termix-ssh/plugin-sdk/frontend";
import { Button } from "@/components/button";
import { LoadingState } from "@/components/loading-state";
import { usePermissions } from "@/hooks/use-permissions";
import { chooseLayout, loadLook, useLookState } from "@/look/look-store";
import { layoutLabel, useLayouts } from "@/look/layout-registry";
import { resolveLayoutId } from "@/look/resolve-look";
import { usePluginStore } from "@/plugin-host/plugin-store";
import { PluginConsentPrompt } from "@/plugins/PluginConsentPrompt";
import { PluginIconBox } from "@/plugins/plugin-bits";
import { isLayoutOffer, youtubeThumbnailUrl } from "@/plugins/plugin-model";
import { usePluginsManager } from "@/plugins/use-plugins-manager";
import { ONBOARDING_ADMIN_PERMISSION } from "../onboarding-flow";

/** The plugin's video thumbnail, or a plain drawing when there is none. */
function LayoutPicture({ videoId, icon }: { videoId?: string; icon?: string }) {
  const src = youtubeThumbnailUrl(videoId);
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden border-b border-border bg-muted/40">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full">
          <div className="w-[8%] border-r border-border/60 bg-muted/60" />
          <div className="w-1/4 border-r border-border/60 bg-muted/30" />
          <div className="flex flex-1 items-center justify-center">
            <PluginIconBox name={icon} size="sm" muted />
          </div>
        </div>
      )}
    </div>
  );
}

function LayoutCard({
  title,
  description,
  picture,
  selected,
  tag,
  onClick,
  action,
}: {
  title: string;
  description?: string;
  picture: ReactNode;
  selected?: boolean;
  tag?: string;
  onClick?: () => void;
  action?: ReactNode;
}) {
  const body = (
    <>
      {picture}
      <div className="flex flex-1 flex-col gap-1 px-2.5 py-2">
        <span className="flex items-center justify-between gap-2 text-xs text-foreground">
          <span className="truncate">{title}</span>
          {selected ? (
            <Check size={12} className="shrink-0 text-accent-brand" />
          ) : (
            tag && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {tag}
              </span>
            )
          )}
        </span>
        {description && (
          <span className="line-clamp-2 text-[11px] text-muted-foreground">
            {description}
          </span>
        )}
        {action && <div className="mt-auto pt-1">{action}</div>}
      </div>
    </>
  );
  const frame = `flex flex-col overflow-hidden border text-left transition-colors ${
    selected
      ? "border-accent-brand ring-1 ring-accent-brand"
      : "border-border hover:border-foreground/40"
  }`;
  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={frame}
    >
      {body}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {children}
    </span>
  );
}

const GRID = "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3";

/** Admins only: layouts from the registry, and installed ones turned off. */
function MoreLayouts() {
  const { t } = useTranslation();
  const manager = usePluginsManager();
  const offers = manager.plugins.filter(isLayoutOffer);

  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>{t("onboarding.layoutMore")}</SectionLabel>
      {manager.loading ? (
        <LoadingState compact />
      ) : offers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {manager.registryError
            ? t("looks.repair.registryUnreachable")
            : t("onboarding.layoutNoMore")}
        </p>
      ) : (
        <div className={GRID}>
          {offers.map((plugin) => {
            const busy = manager.busy.has(plugin.id);
            return (
              <LayoutCard
                key={`${plugin.registryId ?? ""}:${plugin.id}`}
                title={plugin.name}
                description={plugin.description}
                picture={
                  <LayoutPicture videoId={plugin.videoId} icon={plugin.icon} />
                }
                action={
                  plugin.installed ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void manager.toggle(plugin)}
                    >
                      <Power />
                      {t("onboarding.layoutTurnOn")}
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => manager.requestInstall(plugin)}
                    >
                      <Download />
                      {t("onboarding.layoutInstall")}
                    </Button>
                  )
                }
              />
            );
          })}
        </div>
      )}
      <PluginConsentPrompt
        request={manager.consent}
        onCancel={manager.cancelConsent}
        onConfirm={() => void manager.confirmConsent()}
      />
    </div>
  );
}

/**
 * Picks the whole app layout. Lists every installed layout with a picture,
 * and for admins the ones that can still be installed or turned on.
 */
export function LayoutStep(_props: OnboardingStepProps) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const isAdmin = has(ONBOARDING_ADMIN_PERMISSION);
  const layouts = useLayouts();
  const look = useLookState();
  const store = usePluginStore();

  useEffect(() => {
    void loadLook();
  }, []);

  const response = look.response;
  const current = resolveLayoutId(response);
  const defaultId =
    response?.defaults.layout ?? response?.defaultLook.layout ?? null;

  const pick = (id: string) => {
    if (id === current) return;
    void chooseLayout(id).catch(() => toast.error(t("looks.saveFailed")));
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">
        {t("onboarding.layoutIntro")}
      </p>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>{t("onboarding.layoutInstalled")}</SectionLabel>
        {!look.loaded ? (
          <LoadingState compact />
        ) : (
          <div className={GRID}>
            {layouts.map((layout) => {
              const summary = layout.pluginId
                ? store.records.get(layout.pluginId)?.summary
                : undefined;
              const description = layout.description
                ? layoutLabel({ ...layout, label: layout.description }, t)
                : summary?.description;
              return (
                <LayoutCard
                  key={layout.id}
                  title={layoutLabel(layout, t)}
                  description={description}
                  selected={layout.id === current}
                  tag={
                    layout.id === defaultId
                      ? t("onboarding.layoutDefault")
                      : undefined
                  }
                  picture={
                    <LayoutPicture
                      videoId={summary?.videoId}
                      icon={summary?.icon}
                    />
                  }
                  onClick={response ? () => pick(layout.id) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      {isAdmin && <MoreLayouts />}

      <p className="border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        {isAdmin
          ? t("onboarding.layoutChangeLaterAdmin")
          : t("onboarding.layoutChangeLater")}
      </p>
    </div>
  );
}
