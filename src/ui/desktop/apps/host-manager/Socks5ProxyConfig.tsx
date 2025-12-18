import { useTranslation } from "react-i18next";
import { FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form.tsx";
import { Input } from "@/components/ui/input.tsx";
import { PasswordInput } from "@/components/ui/password-input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Plus, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import type { Control, UseFormWatch, UseFormSetValue } from "react-hook-form";
import type { ProxyNode } from "@/types";

interface Socks5ProxyConfigProps {
  control: Control<any>;
  watch: UseFormWatch<any>;
  setValue: UseFormSetValue<any>;
  proxyMode: "single" | "chain";
  onProxyModeChange: (mode: "single" | "chain") => void;
}

export function Socks5ProxyConfig({
  control,
  watch,
  setValue,
  proxyMode,
  onProxyModeChange,
}: Socks5ProxyConfigProps) {
  const { t } = useTranslation();
  const proxyChain = watch("socks5ProxyChain") || [];

  const addProxyNode = () => {
    const currentChain = watch("socks5ProxyChain") || [];
    const newNode: ProxyNode = {
      host: "",
      port: 1080,
      type: 5,
      username: "",
      password: "",
    };
    setValue("socks5ProxyChain", [...currentChain, newNode]);
  };

  const removeProxyNode = (index: number) => {
    const currentChain = watch("socks5ProxyChain") || [];
    const newChain = currentChain.filter((_: any, i: number) => i !== index);
    setValue("socks5ProxyChain", newChain);
  };

  const updateProxyNode = (index: number, field: keyof ProxyNode, value: any) => {
    const currentChain = watch("socks5ProxyChain") || [];
    const newChain = [...currentChain];
    newChain[index] = { ...newChain[index], [field]: value };
    setValue("socks5ProxyChain", newChain);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <FormLabel>{t("hosts.socks5ProxyMode")}</FormLabel>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={proxyMode === "single" ? "default" : "outline"}
            onClick={() => onProxyModeChange("single")}
            className="flex-1"
          >
            {t("hosts.socks5UseSingleProxy")}
          </Button>
          <Button
            type="button"
            variant={proxyMode === "chain" ? "default" : "outline"}
            onClick={() => onProxyModeChange("chain")}
            className="flex-1"
          >
            {t("hosts.socks5UseProxyChain")}
          </Button>
        </div>
      </div>

      {proxyMode === "single" && (
        <div className="space-y-4 p-4 border rounded-lg">
          <FormField
            control={control}
            name="socks5Host"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hosts.socks5Host")}</FormLabel>
                <FormControl>
                  <Input placeholder="proxy.example.com" {...field} />
                </FormControl>
                <FormDescription>
                  {t("hosts.socks5HostDescription")}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="socks5Port"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hosts.socks5Port")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="1080"
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 1080)}
                  />
                </FormControl>
                <FormDescription>
                  {t("hosts.socks5PortDescription")}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="socks5Username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hosts.socks5Username")} ({t("hosts.optional")})</FormLabel>
                <FormControl>
                  <Input placeholder={t("hosts.username")} {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="socks5Password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hosts.socks5Password")} ({t("hosts.optional")})</FormLabel>
                <FormControl>
                  <PasswordInput placeholder={t("hosts.password")} {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      )}

      {proxyMode === "chain" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <FormLabel>{t("hosts.socks5ProxyChain")}</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addProxyNode}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("hosts.addProxyNode")}
            </Button>
          </div>

          {proxyChain.length === 0 && (
            <div className="text-sm text-muted-foreground text-center p-4 border rounded-lg border-dashed">
              {t("hosts.noProxyNodes")}
            </div>
          )}

          {proxyChain.map((node: ProxyNode, index: number) => (
            <div key={index} className="p-4 border rounded-lg space-y-3 relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">
                  {t("hosts.proxyNode")} {index + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeProxyNode(index)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <FormLabel>{t("hosts.socks5Host")}</FormLabel>
                  <Input
                    placeholder="proxy.example.com"
                    value={node.host}
                    onChange={(e) => updateProxyNode(index, "host", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <FormLabel>{t("hosts.socks5Port")}</FormLabel>
                  <Input
                    type="number"
                    placeholder="1080"
                    value={node.port}
                    onChange={(e) => updateProxyNode(index, "port", parseInt(e.target.value) || 1080)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <FormLabel>{t("hosts.proxyType")}</FormLabel>
                <Select
                  value={String(node.type)}
                  onValueChange={(value) => updateProxyNode(index, "type", parseInt(value) as 4 | 5)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">SOCKS4</SelectItem>
                    <SelectItem value="5">SOCKS5</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <FormLabel>{t("hosts.socks5Username")} ({t("hosts.optional")})</FormLabel>
                  <Input
                    placeholder={t("hosts.username")}
                    value={node.username || ""}
                    onChange={(e) => updateProxyNode(index, "username", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <FormLabel>{t("hosts.socks5Password")} ({t("hosts.optional")})</FormLabel>
                  <PasswordInput
                    placeholder={t("hosts.password")}
                    value={node.password || ""}
                    onChange={(e) => updateProxyNode(index, "password", e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
