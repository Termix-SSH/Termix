import { useState } from "react";
import { useTranslation, type TermixApp } from "@termix/plugin-sdk/frontend";

function Counter() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {t("title")}: {count}
    </button>
  );
}

export function activate(app: TermixApp): void {
  app.registerPanel("hook-panel", Counter);
}
