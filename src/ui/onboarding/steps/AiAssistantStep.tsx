import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { saveUserPreferences } from "@/main-axios";

/**
 * Asks once, plainly.
 *
 * "Leave it off" is preselected and applied on mount, so someone who clicks
 * straight through ends up without the assistant rather than with it. Both
 * options are described in the same flat register and neither is marked
 * recommended: this is a choice, not a pitch.
 */
export function AiAssistantStep() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);

  function apply(next: boolean) {
    setEnabled(next);

    const hidden = new Set<string>(
      JSON.parse(localStorage.getItem("hiddenRailTabs") ?? "[]"),
    );
    if (next) hidden.delete("ai");
    else hidden.add("ai");

    const serialized = JSON.stringify([...hidden]);
    localStorage.setItem("hiddenRailTabs", serialized);
    window.dispatchEvent(new Event("hiddenRailTabsChanged"));

    saveUserPreferences({
      aiAssistantEnabled: next,
      hiddenRailTabs: serialized,
    }).catch(() => {
      // The local choice still applies if the write fails.
    });
  }

  // Skipping the step entirely still has to mean off, not unset.
  useEffect(() => {
    apply(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = [
    {
      value: false,
      title: t("onboarding.aiSkipTitle"),
      description: t("onboarding.aiSkipDesc"),
    },
    {
      value: true,
      title: t("onboarding.aiEnableTitle"),
      description: t("onboarding.aiEnableDesc"),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("onboarding.aiIntro")}</p>

      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => apply(option.value)}
            className={`flex items-start gap-2.5 border p-2.5 text-left ${
              enabled === option.value
                ? "border-accent-brand bg-accent-brand/10"
                : "border-border bg-card"
            }`}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-medium">{option.title}</span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {option.description}
              </span>
            </div>
            {/*
              Always rendered and only made visible when selected, so picking an
              option never reflows the text beside it.
            */}
            <Check
              size={14}
              className={`ml-auto mt-0.5 shrink-0 ${
                enabled === option.value ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/70">
        {t("onboarding.aiNote")}
      </p>
    </div>
  );
}
