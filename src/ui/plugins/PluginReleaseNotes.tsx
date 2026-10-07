import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/button";
import { SectionCard } from "@/components/section-card";
import { getPluginChangelog } from "@/api/plugins-api";
import type { ChangelogRelease } from "@termix-ssh/plugin-sdk/changelog";
import {
  groupChanges,
  mergeReleaseNotes,
  youtubeEmbedUrl,
  type PluginEntry,
  type ReleaseRow,
} from "./plugin-model";

/** A long release shows this many changes until it is opened up. */
const MAX_CHANGES = 8;

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

/** Backticks become code, everything else stays plain text. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={i}
            className="bg-muted px-1 py-px font-mono text-[10px] text-foreground"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function Release({
  row,
  installedVersion,
}: {
  row: ReleaseRow;
  installedVersion: string | null;
}) {
  const { t } = useTranslation();
  const [full, setFull] = useState(false);
  const all = groupChanges(row.changes);
  const hidden = full ? 0 : Math.max(0, row.changes.length - MAX_CHANGES);
  let budget = full ? Infinity : MAX_CHANGES;
  const groups = all
    .map((group) => {
      const items = group.items.slice(0, Math.max(0, budget));
      budget -= items.length;
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">{row.version}</span>
        {row.version === installedVersion && (
          <span className="border border-accent-brand/40 bg-accent-brand/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-brand">
            {t("plugins.manager.installedBadge")}
          </span>
        )}
        {!row.compatible && (
          <span className="border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
            {t("plugins.manager.incompatible")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {formatDate(row.date)}
        </span>
      </div>
      {row.summary && (
        <p
          className={`whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground ${full ? "" : "line-clamp-4"}`}
        >
          <InlineText text={row.summary} />
        </p>
      )}
      {groups.map((group) => (
        <div key={group.type} className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {t(`plugins.manager.changeTypes.${group.type}`)}
          </span>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[11px] leading-snug">
            {group.items.map((item, i) => (
              <li key={i} className="whitespace-pre-line">
                <InlineText text={item} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setFull(true)}
          className="w-fit text-[11px] text-muted-foreground hover:text-accent-brand"
        >
          {t("plugins.manager.showMoreChanges", { count: hidden })}
        </button>
      )}
      {groups.length === 0 && !row.summary && (
        <span className="text-[11px] text-muted-foreground">
          {t("plugins.manager.noReleaseNotes")}
        </span>
      )}
      {row.releaseNotesUrl && (
        <a
          href={row.releaseNotesUrl}
          target="_blank"
          rel="noreferrer"
          className="w-fit text-[11px] text-muted-foreground hover:text-accent-brand"
        >
          {t("plugins.manager.viewRelease")}
        </a>
      )}
    </div>
  );
}

/**
 * The newest version's notes, from the registry and the installed
 * CHANGELOG.md, with older versions behind a toggle in a capped scroll area.
 * Renders nothing when there are no versions to list.
 */
export function PluginReleaseNotes({ plugin }: { plugin: PluginEntry }) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<ChangelogRelease[]>([]);
  const [showOlder, setShowOlder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLocal([]);
    if (!plugin.installed) return;
    getPluginChangelog(plugin.id)
      .then((releases) => {
        if (!cancelled) setLocal(releases);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [plugin.id, plugin.installed, plugin.version]);

  const rows = useMemo(
    () => mergeReleaseNotes(plugin.versions, local),
    [plugin.versions, local],
  );
  if (rows.length === 0) return null;
  const [latest, ...older] = rows;

  return (
    <SectionCard
      title={t("plugins.manager.releaseNotes")}
      icon={null}
      action={
        older.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => setShowOlder((v) => !v)}
          >
            {showOlder
              ? t("plugins.manager.hideOlderReleases")
              : t("plugins.manager.showOlderReleases", {
                  count: older.length,
                })}
          </Button>
        ) : undefined
      }
    >
      <div className="-mx-3 -my-1 md:-mx-4">
        <Release row={latest} installedVersion={plugin.version} />
        {showOlder && older.length > 0 && (
          <div className="max-h-96 divide-y divide-border overflow-y-auto border-t border-border">
            {older.map((row) => (
              <Release
                key={row.version}
                row={row}
                installedVersion={plugin.version}
              />
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/** The plugin's YouTube video. Nothing is loaded when it has none. */
export function PluginVideo({
  videoId,
  name,
}: {
  videoId?: string;
  name: string;
}) {
  const { t } = useTranslation();
  const src = youtubeEmbedUrl(videoId);
  if (!src) return null;

  return (
    <div className="aspect-video w-full border border-border bg-black">
      <iframe
        src={src}
        title={t("plugins.manager.videoTitle", { name })}
        className="size-full"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}
