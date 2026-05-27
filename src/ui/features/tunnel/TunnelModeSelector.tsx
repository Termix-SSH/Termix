import { useTranslation } from "react-i18next";
import type { TunnelMode } from "@/types/index.js";

type TunnelModeSelectorProps = {
  mode: TunnelMode;
  scope: "client" | "server";
  onChange: (mode: TunnelMode) => void;
};

export function TunnelModeSelector({
  mode,
  scope,
  onChange,
}: TunnelModeSelectorProps) {
  const { t } = useTranslation();

  const options: Array<{
    value: TunnelMode;
    label: string;
    description: string;
  }> = [
    {
      value: "local",
      label: t("tunnels.typeLocal"),
      description:
        scope === "client"
          ? t("tunnels.typeClientLocalDesc")
          : t("tunnels.typeServerLocalDesc"),
    },
    {
      value: "remote",
      label: t("tunnels.typeRemote"),
      description:
        scope === "client"
          ? t("tunnels.typeClientRemoteDesc")
          : t("tunnels.typeServerRemoteDesc"),
    },
    {
      value: "dynamic",
      label: t("tunnels.typeDynamic"),
      description:
        scope === "client"
          ? t("tunnels.typeClientDynamicDesc")
          : t("tunnels.typeDynamicDesc"),
    },
  ];

  return (
    <div className="grid gap-2 lg:grid-cols-3">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex items-start gap-2.5 border p-3 text-left transition-colors ${
            mode === option.value
              ? "border-accent-brand bg-accent-brand/5 text-foreground"
              : "border-border bg-muted/20 text-muted-foreground hover:border-border/80 hover:bg-muted/30"
          }`}
        >
          <div
            className={`mt-0.5 size-3.5 shrink-0 rounded-full border-2 ${
              mode === option.value
                ? "border-accent-brand bg-accent-brand"
                : "border-muted-foreground/40"
            }`}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold">{option.label}</span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              {option.description}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
