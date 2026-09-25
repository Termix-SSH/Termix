import { useEffect, useMemo, useState } from "react";
import { Bell, Radio, Route } from "lucide-react";
import { usePluginApi, useTranslation } from "@termix/plugin-sdk/frontend";
import { cn } from "@termix/plugin-sdk/ui";
import { createAlertsApi } from "./api";
import { ChannelsView } from "./ChannelsView";
import { InboxView } from "./InboxView";
import { RulesView } from "./RulesView";
import type { AlertsStore } from "./store";

import type { Section, SectionRequests } from "./sections";

const SECTIONS: Array<{ id: Section; icon: typeof Bell; labelKey: string }> = [
  { id: "inbox", icon: Bell, labelKey: "sections.inbox" },
  { id: "channels", icon: Radio, labelKey: "sections.channels" },
  { id: "rules", icon: Route, labelKey: "sections.rules" },
];

export function AlertsView({
  store,
  sections,
}: {
  store: AlertsStore;
  sections: SectionRequests;
}) {
  const { t } = useTranslation();
  const client = usePluginApi();
  const api = useMemo(() => createAlertsApi(client), [client]);
  const [section, setSection] = useState<Section>(
    () => sections.take() ?? "inbox",
  );

  useEffect(
    () =>
      sections.subscribe((requested) => {
        sections.take();
        setSection(requested);
      }),
    [sections],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-background">
      <div className="flex items-center gap-1 border-b border-border px-2 shrink-0">
        {SECTIONS.map(({ id, icon: Icon, labelKey }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
              section === id
                ? "border-accent-brand text-accent-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        {section === "inbox" && <InboxView store={store} />}
        {section === "channels" && <ChannelsView api={api} />}
        {section === "rules" && <RulesView api={api} />}
      </div>
    </div>
  );
}
