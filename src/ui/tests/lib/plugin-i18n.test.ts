import { describe, expect, it } from "vitest";
import i18next from "i18next";
import { pluginDescription, pluginName } from "@/lib/plugin-i18n";

async function zhCN() {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: "zh-CN",
    fallbackLng: "en",
    fallbackNS: "translation",
    resources: {
      "zh-CN": {
        translation: { common: { save: "保存" } },
        "host-metrics": {
          plugin: { name: "主机指标", description: "查看主机负载" },
        },
        "no-description": { plugin: { name: "无描述" } },
      },
    },
  });
  return i18n.t;
}

describe("pluginName", () => {
  it("reads the name from the plugin's own namespace", async () => {
    const t = await zhCN();
    expect(pluginName(t, { id: "host-metrics", name: "Host Metrics" })).toBe(
      "主机指标",
    );
  });

  it("falls back to the manifest name when the plugin has no strings", async () => {
    const t = await zhCN();
    expect(pluginName(t, { id: "not-loaded", name: "Not Loaded" })).toBe(
      "Not Loaded",
    );
  });
});

describe("pluginDescription", () => {
  it("reads the description from the plugin's own namespace", async () => {
    const t = await zhCN();
    expect(
      pluginDescription(t, {
        id: "host-metrics",
        description: "See host load",
      }),
    ).toBe("查看主机负载");
  });

  it("falls back to the manifest description, or nothing", async () => {
    const t = await zhCN();
    expect(
      pluginDescription(t, { id: "no-description", description: "Plain" }),
    ).toBe("Plain");
    expect(pluginDescription(t, { id: "not-loaded" })).toBe("");
  });
});
