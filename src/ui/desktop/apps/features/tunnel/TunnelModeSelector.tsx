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
    <div className="grid gap-3 lg:grid-cols-3">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex items-start gap-3 rounded-md border bg-card p-3 cursor-pointer"
        >
          <input
            type="radio"
            value={option.value}
            checked={mode === option.value}
            onChange={() => onChange(option.value)}
            className="mt-0.5 w-4 h-4 text-primary border-input focus:ring-ring"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">
              {option.description}
            </span>
          </div>
        </label>
      ))}
    </div>
  );
}
