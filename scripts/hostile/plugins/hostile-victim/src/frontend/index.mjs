// An action, a component and a tab the hostile frame tries to misuse.
import { createElement } from "react";

function Panel() {
  return createElement(
    "div",
    {
      "data-hostile": "victim-panel",
      style: { width: "100%", height: "100%" },
    },
    "victim panel",
  );
}

export function activate(app) {
  app.registerAction("hostile-victim.secret", async () => {
    const response = await app.api.get("/marker");
    return response.data.marker;
  });
  app.registerComponent("hostile-victim.panel", Panel);
  app.registerTab(
    "hostile-victim",
    () => createElement("div", { "data-hostile": "victim" }, "victim"),
    { titleKey: "tab.title", singleton: true, hostless: true },
  );
}
