import { useTranslation } from "react-i18next";
import { Database, FileKey, Network, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog";

const accessItems = [
  { key: "connections", icon: Network },
  { key: "credentials", icon: FileKey },
  { key: "storage", icon: Database },
  { key: "services", icon: ShieldCheck },
] as const;

export function LegalDisclosure() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5 pt-3 text-xs">
      <article aria-labelledby="terms-heading" className="flex flex-col gap-2">
        <h3 id="terms-heading" className="font-bold text-foreground">
          {t("newUi.sidebar.userProfile.termsTitle")}
        </h3>
        <p className="leading-relaxed text-muted-foreground">
          {t("newUi.sidebar.userProfile.termsIntro")}
        </p>
        <ul className="list-disc space-y-1.5 pl-4 leading-relaxed text-muted-foreground">
          <li>{t("newUi.sidebar.userProfile.termsAuthorization")}</li>
          <li>{t("newUi.sidebar.userProfile.termsSecurity")}</li>
          <li>{t("newUi.sidebar.userProfile.termsAcceptableUse")}</li>
          <li>{t("newUi.sidebar.userProfile.termsAvailability")}</li>
        </ul>
      </article>

      <article
        aria-labelledby="access-heading"
        className="flex flex-col gap-2 border-t border-border pt-4"
      >
        <h3 id="access-heading" className="font-bold text-foreground">
          {t("newUi.sidebar.userProfile.accessDisclosureTitle")}
        </h3>
        <p className="leading-relaxed text-muted-foreground">
          {t("newUi.sidebar.userProfile.accessDisclosureIntro")}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {accessItems.map(({ key, icon: Icon }) => (
            <section
              key={key}
              className="border border-border bg-background p-3"
            >
              <div className="mb-1.5 flex items-center gap-2 font-semibold text-foreground">
                <Icon className="size-3.5 text-accent-brand" />
                {t(`newUi.sidebar.userProfile.access.${key}.title`)}
              </div>
              <p className="leading-relaxed text-muted-foreground">
                {t(`newUi.sidebar.userProfile.access.${key}.description`)}
              </p>
            </section>
          ))}
        </div>
        <p className="leading-relaxed text-muted-foreground">
          {t("newUi.sidebar.userProfile.telemetryDisclosure")}
        </p>
      </article>
    </div>
  );
}

export function LegalDisclosureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("newUi.sidebar.userProfile.sectionLegal")}
          </DialogTitle>
          <DialogDescription>
            {t("newUi.sidebar.userProfile.legalDescription")}
          </DialogDescription>
        </DialogHeader>
        <LegalDisclosure />
      </DialogContent>
    </Dialog>
  );
}
