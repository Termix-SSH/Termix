import {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  usePermission,
  useTranslation,
  type PluginHostRecord,
} from "@termix/plugin-sdk/frontend";
import { Badge, Button, Input, Label } from "@termix/plugin-sdk/ui";
import type { MaintenanceStore } from "./maintenance-store";
import type { Recurrence } from "../maintenance";

export function MaintenanceBadge({
  host,
  store,
}: {
  host: PluginHostRecord;
  store: MaintenanceStore;
}) {
  const allowed = usePermission("view");
  const { t } = useTranslation();
  return allowed ? (
    <VisibleBadge host={host} store={store} title={t("maintenance.title")} />
  ) : null;
}
function VisibleBadge({
  host,
  store,
  title,
}: {
  host: PluginHostRecord;
  store: MaintenanceStore;
  title: string;
}) {
  const states = useSyncExternalStore(store.subscribe, store.snapshot);
  const active = states[Number(host.id)]?.active;
  if (!active) return null;
  return (
    <Badge
      variant="outline"
      title={`${active.reasons.join("; ")}\n${new Date(active.estimatedEnd).toLocaleString()}`}
    >
      {title}
    </Badge>
  );
}

export function HostMaintenance({
  host,
  store,
  visible,
}: {
  host: PluginHostRecord;
  store: MaintenanceStore;
  visible: boolean;
}) {
  const canView = usePermission("view");
  const { t } = useTranslation();
  if (!canView) return <p className="p-4">{t("maintenance.denied")}</p>;
  if (!visible) return null;
  return <MaintenanceEditor key={host.id} host={host} store={store} />;
}

function MaintenanceEditor({
  host,
  store,
}: {
  host: PluginHostRecord;
  store: MaintenanceStore;
}) {
  const { t } = useTranslation();
  const canEditPermission = usePermission("edit");
  const states = useSyncExternalStore(store.subscribe, store.snapshot);
  const state = states[Number(host.id)];
  // A shared host shows its owner's maintenance, read only.
  const canEdit = canEditPermission && state?.owned !== false;
  const [mode, setMode] = useState<"start" | "schedule">("start");
  const [reason, setReason] = useState("");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(60);
  const [grace, setGrace] = useState(20);
  const [recurrence, setRecurrence] = useState<Recurrence>("once");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    void store.refresh();
  }, [store]);
  async function mutate(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await store.edit(Number(host.id), input);
      setEnding(false);
    } catch (error) {
      const body = (error as { response?: { data?: { error?: string } } })
        .response?.data?.error;
      setError(
        body ||
          (error instanceof Error ? error.message : t("maintenance.failed")),
      );
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void mutate({
      action: mode,
      reason,
      start: start ? `${start}:00.000Z` : undefined,
      durationMinutes: duration,
      graceMinutes: grace,
      recurrence,
      notifyOverdue: notify,
    });
  }
  const fieldClass = "h-9 border bg-background px-3 text-sm";
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 overflow-auto p-6">
      <div>
        <h2 className="text-lg font-semibold">{t("maintenance.title")}</h2>
        <p className="text-sm font-medium">{host.name || host.ip}</p>
        <p className="text-sm text-muted-foreground">
          {t("maintenance.description")}
        </p>
      </div>
      {store.error() && (
        <p role="alert" className="text-sm text-destructive">
          {t(store.error())}
        </p>
      )}
      {!store.loaded() && <p>{t("maintenance.loading")}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {state?.active && (
        <section className="space-y-3 border p-4">
          <Badge>{t("maintenance.active")}</Badge>
          <p className="break-words">{state.active.reasons.join("; ")}</p>
          <p>
            {t("maintenance.estimated")}:{" "}
            {new Date(state.active.estimatedEnd).toLocaleString()}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("maintenance.noAutoEnd")}
          </p>
          {canEdit &&
            (ending ? (
              <div className="space-y-2">
                <p>{t("maintenance.endConfirm")}</p>
                <Button
                  disabled={busy || !store.loaded() || !!store.error()}
                  onClick={() => void mutate({ action: "end" })}
                >
                  {t("maintenance.confirmEnd")}
                </Button>{" "}
                <Button variant="outline" onClick={() => setEnding(false)}>
                  {t("maintenance.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                disabled={busy || !store.loaded() || !!store.error()}
                onClick={() => setEnding(true)}
              >
                {t("maintenance.end")}
              </Button>
            ))}
        </section>
      )}
      {state?.owned === false && (
        <p className="text-sm text-muted-foreground">
          {t("maintenance.sharedReadOnly")}
        </p>
      )}
      {canEdit && (
        <form onSubmit={submit} className="space-y-4 border p-4">
          <div className="flex flex-wrap gap-3">
            <Label htmlFor="maintenance-mode">{t("maintenance.action")}</Label>
            <select
              id="maintenance-mode"
              className={fieldClass}
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="start">{t("maintenance.startNow")}</option>
              <option value="schedule">{t("maintenance.schedule")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maintenance-reason">
              {t("maintenance.reason")}
            </Label>
            <Input
              id="maintenance-reason"
              required
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {mode === "schedule" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="maintenance-start">
                  {t("maintenance.startUtc")}
                </Label>
                <Input
                  id="maintenance-start"
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maintenance-repeat">
                  {t("maintenance.repeat")}
                </Label>
                <select
                  id="maintenance-repeat"
                  className={`${fieldClass} w-full`}
                  value={recurrence}
                  onChange={(event) =>
                    setRecurrence(event.target.value as Recurrence)
                  }
                >
                  {(["once", "weekly", "monthly"] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`maintenance.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {t("maintenance.utcHelp")}
              </p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maintenance-duration">
                {t("maintenance.duration")}
              </Label>
              <Input
                id="maintenance-duration"
                type="number"
                min={1}
                max={10080}
                required
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maintenance-grace">
                {t("maintenance.grace")}
              </Label>
              <Input
                id="maintenance-grace"
                type="number"
                min={0}
                max={1440}
                required
                value={grace}
                onChange={(event) => setGrace(Number(event.target.value))}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
            />
            {t("maintenance.notify")}
          </label>
          <Button
            type="submit"
            disabled={
              busy ||
              !store.loaded() ||
              !!store.error() ||
              (mode === "start" && !!state?.active)
            }
          >
            {t(
              mode === "start"
                ? "maintenance.startNow"
                : "maintenance.addSchedule",
            )}
          </Button>
        </form>
      )}
      <section className="space-y-3">
        <h3 className="font-medium">{t("maintenance.schedules")}</h3>
        {!state?.plans.length && (
          <p className="text-sm text-muted-foreground">
            {t("maintenance.noSchedules")}
          </p>
        )}
        {state?.plans.map((plan) => (
          <div
            key={plan.id}
            className="flex flex-wrap items-center justify-between gap-3 border p-3"
          >
            <div className="min-w-0 space-y-1">
              <p className="break-words">{plan.reason}</p>
              <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                <span>{t(`maintenance.${plan.recurrence}`)}</span>
                <span>
                  {plan.nextStart
                    ? `${plan.nextStart.replace("T", " ").slice(0, 16)} UTC`
                    : t("maintenance.completed")}
                </span>
                <span>
                  {t("maintenance.minutes", { count: plan.durationMinutes })}
                </span>
              </p>
            </div>
            {canEdit && (
              <Button
                variant="outline"
                disabled={busy || !store.loaded() || !!store.error()}
                onClick={() => void mutate({ action: "remove", id: plan.id })}
              >
                {t("maintenance.remove")}
              </Button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
