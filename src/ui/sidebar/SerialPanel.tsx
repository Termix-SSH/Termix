import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Usb, TriangleAlert } from "lucide-react";
import { Input } from "@/components/input";
import { isElectron } from "@/lib/electron";
import type { SerialConfig } from "@/types/ui-types";

const BAUD_RATES = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800,
  921600,
];

interface SerialPanelProps {
  onConnect: (config: SerialConfig) => void;
}

// In Chrome/Edge the Web Serial API shows its own native port picker on requestPort(),
// so getPorts() only returns previously-granted ports. We never need the user to type
// a path — the browser handles selection at connect time.
const useWebSerial = !isElectron() && "serial" in navigator;
const serialUnsupported = !isElectron() && !("serial" in navigator);

export function SerialPanel({ onConnect }: SerialPanelProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState("");
  const [baudRate, setBaudRate] = useState(115200);
  const [dataBits, setDataBits] = useState<5 | 6 | 7 | 8>(8);
  const [stopBits, setStopBits] = useState<1 | 2>(1);
  const [parity, setParity] = useState<"none" | "even" | "odd">("none");
  // Electron only: ports discovered from the backend
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(false);

  const buildWsUrl = () => {
    const isDev =
      process.env.NODE_ENV === "development" &&
      (window.location.port === "3000" ||
        window.location.port === "5173" ||
        window.location.port === "");

    if (
      isDev ||
      (isElectron() &&
        !(window as { configuredServerUrl?: string }).configuredServerUrl)
    ) {
      const token = localStorage.getItem("jwt");
      const base = "ws://127.0.0.1:30011";
      return token ? `${base}?token=${encodeURIComponent(token)}` : base;
    }
    const configuredUrl = (window as { configuredServerUrl?: string })
      .configuredServerUrl;
    if (!configuredUrl) return null;
    const wsProtocol = configuredUrl.startsWith("https://")
      ? "wss://"
      : "ws://";
    const wsHost = configuredUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const token = localStorage.getItem("jwt");
    const base = `${wsProtocol}${wsHost}/serial/websocket/`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  };

  const refreshPorts = useCallback(() => {
    if (!isElectron()) return;
    setLoadingPorts(true);
    const url = buildWsUrl();
    if (!url) {
      setLoadingPorts(false);
      return;
    }

    const ws = new WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify({ type: "list_ports" }));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          data?: { path: string }[];
        };
        if (msg.type === "ports_list" && Array.isArray(msg.data)) {
          const paths = msg.data.map((p) => p.path);
          setAvailablePorts(paths);
          if (!path && paths.length > 0) setPath(paths[0]);
        }
      } catch {
        // ignore
      } finally {
        ws.close();
        setLoadingPorts(false);
      }
    };
    ws.onerror = () => setLoadingPorts(false);
  }, [path]);

  useEffect(() => {
    if (isElectron()) refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = () => {
    // For Web Serial, path is irrelevant — the browser picker handles it.
    // We pass an empty string; Serial.tsx calls requestPort() itself.
    if (useWebSerial) {
      onConnect({ path: "", baudRate, dataBits, stopBits, parity });
      return;
    }
    const finalPath = path.trim();
    if (!finalPath) return;
    onConnect({ path: finalPath, baudRate, dataBits, stopBits, parity });
  };

  // ── Not supported (Firefox, Safari, etc.) ─────────────────────────────

  if (serialUnsupported) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-2 rounded border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-center gap-2">
              <TriangleAlert className="size-3.5 text-destructive shrink-0" />
              <span className="text-xs font-semibold text-destructive">
                {t("serial.notSupportedTitle")}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("serial.notSupported")}
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("serial.hideHint")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Web Serial (Chrome / Edge) ─────────────────────────────────────────

  if (useWebSerial) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("serial.browserPickerHint")}
          </p>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("serial.baudRateLabel")}
            </label>
            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              {BAUD_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("serial.dataBitsLabel")}
              </label>
              <select
                value={dataBits}
                onChange={(e) =>
                  setDataBits(Number(e.target.value) as 5 | 6 | 7 | 8)
                }
                className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                {([5, 6, 7, 8] as const).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("serial.stopBitsLabel")}
              </label>
              <select
                value={stopBits}
                onChange={(e) => setStopBits(Number(e.target.value) as 1 | 2)}
                className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("serial.parityLabel")}
              </label>
              <select
                value={parity}
                onChange={(e) =>
                  setParity(e.target.value as "none" | "even" | "odd")
                }
                className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="none">{t("serial.parityNone")}</option>
                <option value="even">{t("serial.parityEven")}</option>
                <option value="odd">{t("serial.parityOdd")}</option>
              </select>
            </div>
          </div>

          <button
            onClick={connect}
            className="flex items-center justify-center gap-1.5 h-7 w-full border border-accent-brand/40 bg-accent-brand/10 text-accent-brand text-xs font-semibold hover:bg-accent-brand/20 transition-colors mt-1"
          >
            <Usb className="size-3.5" />
            {t("serial.connect")}
          </button>
        </div>
      </div>
    );
  }

  // ── Electron (backend serialport) ─────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("serial.portLabel")}
            </label>
            <button
              onClick={refreshPorts}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={t("serial.refreshPorts")}
            >
              <RefreshCw
                className={`size-3 ${loadingPorts ? "animate-spin" : ""}`}
              />
            </button>
          </div>
          {availablePorts.length > 0 && (
            <select
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">{t("serial.portPlaceholder")}</option>
              {availablePorts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <Input
            placeholder={t("serial.portPlaceholder")}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") connect();
            }}
            className="h-7 text-xs font-mono"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t("serial.baudRateLabel")}
          </label>
          <select
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            {BAUD_RATES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("serial.dataBitsLabel")}
            </label>
            <select
              value={dataBits}
              onChange={(e) =>
                setDataBits(Number(e.target.value) as 5 | 6 | 7 | 8)
              }
              className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              {([5, 6, 7, 8] as const).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("serial.stopBitsLabel")}
            </label>
            <select
              value={stopBits}
              onChange={(e) => setStopBits(Number(e.target.value) as 1 | 2)}
              className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("serial.parityLabel")}
            </label>
            <select
              value={parity}
              onChange={(e) =>
                setParity(e.target.value as "none" | "even" | "odd")
              }
              className="flex h-7 w-full border border-border bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="none">{t("serial.parityNone")}</option>
              <option value="even">{t("serial.parityEven")}</option>
              <option value="odd">{t("serial.parityOdd")}</option>
            </select>
          </div>
        </div>

        <button
          onClick={connect}
          disabled={!path.trim()}
          className="flex items-center justify-center gap-1.5 h-7 w-full border border-accent-brand/40 bg-accent-brand/10 text-accent-brand text-xs font-semibold hover:bg-accent-brand/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-1"
        >
          <Usb className="size-3.5" />
          {t("serial.connect")}
        </button>
      </div>
    </div>
  );
}
