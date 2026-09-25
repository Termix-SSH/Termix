import { useCallback, useEffect, useState } from "react";
import {
  usePermission,
  usePluginApi,
  useTranslation,
  type SshAuthEditorProps,
} from "@termix/plugin-sdk/frontend";
import { Select2 } from "@termix/plugin-sdk/ui";
import { VaultProfileManager } from "./VaultProfileManager";
import type { VaultProfile } from "./types";

const PLUGIN_ID = "vault";
const DOCS_URL = "https://docs.termix.site/features/authentication/vault";

type PluginSettingsBag = Record<string, Record<string, unknown>>;

/**
 * The host editor's "vault" auth method: pick a signer profile, and manage
 * profiles in place. The choice is the profileId host setting, which the
 * editor saves with the rest of the host's plugin settings.
 */
export function VaultAuthEditor({ form, setField }: SshAuthEditorProps) {
  const { t } = useTranslation();
  const api = usePluginApi();
  const canUse = usePermission("use");
  const [profiles, setProfiles] = useState<VaultProfile[]>([]);
  const [showManager, setShowManager] = useState(false);

  const bag = (form.pluginSettings as PluginSettingsBag | undefined) ?? {};
  const profileId = bag[PLUGIN_ID]?.profileId;

  const reload = useCallback(() => {
    if (!canUse) return;
    api
      .get<VaultProfile[]>("/profiles")
      .then(({ data }) => setProfiles(Array.isArray(data) ? data : []))
      .catch(() => setProfiles([]));
  }, [api, canUse]);

  useEffect(() => {
    reload();
  }, [reload]);

  const select = (value: string) => {
    setField("pluginSettings", {
      ...bag,
      [PLUGIN_ID]: {
        ...(bag[PLUGIN_ID] ?? {}),
        profileId: value ? Number(value) : null,
      },
    });
  };

  return (
    <>
      <div className="flex flex-col gap-1.5 col-span-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t("editor.profile")}
        </label>
        <Select2
          value={profileId != null ? String(profileId) : ""}
          onChange={(e) => select(e.target.value)}
          className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t("editor.selectProfile")}</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={String(profile.id)}>
              {profile.shared
                ? t("editor.sharedProfile", { name: profile.name })
                : profile.name}
            </option>
          ))}
        </Select2>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            {t("editor.hint")}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-accent-brand hover:underline"
            >
              {t("editor.docs")}
            </a>
            {canUse && (
              <button
                type="button"
                className="text-[10px] text-accent-brand hover:text-accent-brand/80"
                onClick={() => setShowManager((shown) => !shown)}
              >
                {t("profiles.manage")}
              </button>
            )}
          </div>
        </div>
      </div>
      {showManager && (
        <VaultProfileManager
          profiles={profiles}
          onChanged={reload}
          onClose={() => setShowManager(false)}
        />
      )}
    </>
  );
}
