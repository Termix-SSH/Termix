import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Boxes,
  ChevronLeft,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Textarea } from "@/components/textarea";
import { Checkbox } from "@/components/checkbox";
import { Badge } from "@/components/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/dialog";
import { FOLDER_COLORS } from "@/lib/theme";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import {
  extractSnippetInputs,
  type SnippetInput,
} from "@/lib/snippet-variables";
import {
  listFleets,
  createFleet,
  updateFleet,
  deleteFleet,
  getFleetMembers,
  addFleetMember,
  removeFleetMember,
  runFleetCommand,
  pushFleetFile,
  pullFleetFile,
  getFleetInventory,
  refreshFleetInventory,
  runFleetPackageAction,
  type FleetRow,
  type FleetMemberRow,
  type FleetHostResult,
  type FleetInventoryEntry,
  type FleetPackageAction,
} from "@/api/fleets-api";
import type { SSHHost } from "@/types/index";

function formatUptime(seconds: number | null): string {
  if (seconds === null) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function ResultsList({ results }: { results: FleetHostResult[] }) {
  const { t } = useTranslation();
  if (results.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
      {results.map((r) => (
        <div
          key={r.hostId}
          className="flex flex-col gap-1 border border-border p-2.5"
        >
          <div className="flex items-center gap-2">
            <Server className="size-3 shrink-0 text-muted-foreground" />
            <span className="text-xs font-semibold">{r.hostName}</span>
            <span
              className={`ml-auto text-[10px] px-1.5 py-0.5 ${
                r.success
                  ? "bg-green-500/10 text-green-500"
                  : "bg-destructive/10 text-destructive"
              }`}
            >
              {r.success
                ? t("newUi.sidebar.fleets.resultSuccess")
                : t("newUi.sidebar.fleets.resultFailed")}
            </span>
          </div>
          {(r.output || r.error) && (
            <pre className="text-xs bg-muted/30 p-2 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground max-h-40">
              {r.error ? r.error : r.output}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function FleetFormDialog({
  open,
  onClose,
  fleet,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  fleet: FleetRow | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(FOLDER_COLORS[0]);
  const [tagRulesText, setTagRulesText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(fleet?.name ?? "");
    setDescription(fleet?.description ?? "");
    setColor(fleet?.color ?? FOLDER_COLORS[0]);
    setTagRulesText((fleet?.tagRules ?? []).join(", "));
  }, [open, fleet]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t("newUi.sidebar.fleets.nameRequired"));
      return;
    }
    const tagRules = tagRulesText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      if (fleet) {
        await updateFleet(fleet.id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          tagRules,
        });
        toast.success(t("newUi.sidebar.fleets.fleetUpdated"));
      } else {
        await createFleet({
          name: name.trim(),
          description: description.trim() || null,
          color,
          tagRules,
        });
        toast.success(t("newUi.sidebar.fleets.fleetCreated"));
      }
      onSaved();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {fleet
              ? t("newUi.sidebar.fleets.editFleetTitle")
              : t("newUi.sidebar.fleets.createFleetTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("newUi.sidebar.fleets.createFleetDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.fleets.nameLabel")}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("newUi.sidebar.fleets.namePlaceholder")}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.fleets.descriptionLabel")}
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("newUi.sidebar.fleets.descriptionPlaceholder")}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.fleets.colorLabel")}
            </label>
            <div className="flex gap-1.5">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-6 transition-all ${
                    color === c
                      ? "ring-2 ring-offset-2 ring-offset-background ring-white/50"
                      : "opacity-75 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">
              {t("newUi.sidebar.fleets.tagRulesLabel")}
            </label>
            <Input
              value={tagRulesText}
              onChange={(e) => setTagRulesText(e.target.value)}
              placeholder={t("newUi.sidebar.fleets.tagRulesPlaceholder")}
            />
            <span className="text-[11px] text-muted-foreground">
              {t("newUi.sidebar.fleets.tagRulesHint")}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="size-3.5 mr-2 animate-spin" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberPickerDialog({
  open,
  onClose,
  fleetId,
  allHosts,
  memberIds,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  fleetId: number;
  allHosts: SSHHost[];
  memberIds: Set<number>;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const visibleHosts = useMemo(
    () =>
      allHosts.filter((h) =>
        h.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [allHosts, search],
  );

  async function toggleHost(host: SSHHost, isMember: boolean) {
    setBusyId(host.id);
    try {
      if (isMember) {
        await removeFleetMember(fleetId, host.id);
      } else {
        await addFleetMember(fleetId, host.id);
      }
      onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.memberUpdateFailed"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[80dvh]">
        <DialogHeader>
          <DialogTitle>
            {t("newUi.sidebar.fleets.manageMembersTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("newUi.sidebar.fleets.manageMembersDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-7 h-8 text-xs"
            placeholder={t("newUi.sidebar.fleets.searchHosts")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1">
          {visibleHosts.map((host) => {
            const isMember = memberIds.has(host.id);
            return (
              <label
                key={host.id}
                className="flex items-center gap-2 text-xs cursor-pointer py-1"
              >
                <Checkbox
                  checked={isMember}
                  disabled={busyId === host.id}
                  onCheckedChange={() => toggleHost(host, isMember)}
                />
                <span className="truncate flex-1">{host.name}</span>
                <span className="text-muted-foreground text-[11px]">
                  {host.ip}
                </span>
              </label>
            );
          })}
          {visibleHosts.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4">
              {t("newUi.sidebar.fleets.noHostsFound")}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunCommandTab({ fleetId }: { fleetId: number }) {
  const { t } = useTranslation();
  const [command, setCommand] = useState("");
  const [inputs, setInputs] = useState<SnippetInput[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<FleetHostResult[] | null>(null);

  useEffect(() => {
    setInputs(extractSnippetInputs(command));
  }, [command]);

  async function handleRun() {
    if (!command.trim()) {
      toast.error(t("newUi.sidebar.fleets.commandRequired"));
      return;
    }
    setRunning(true);
    setResults(null);
    try {
      const { results: r } = await runFleetCommand(
        fleetId,
        command,
        inputs.length > 0 ? inputValues : undefined,
      );
      setResults(r);
      const failed = r.filter((x) => !x.success).length;
      if (failed === 0) {
        toast.success(t("newUi.sidebar.fleets.commandSucceeded"));
      } else {
        toast.warning(
          t("newUi.sidebar.fleets.commandPartialFailure", {
            failed,
            total: r.length,
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.commandFailed"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder={t("newUi.sidebar.fleets.commandPlaceholder")}
        rows={4}
        className="font-mono text-xs"
      />
      {inputs.length > 0 && (
        <div className="flex flex-col gap-2 border border-border p-2.5">
          <span className="text-xs text-muted-foreground">
            {t("newUi.sidebar.fleets.commandInputsLabel")}
          </span>
          {inputs.map((input) => (
            <div key={input.key} className="flex flex-col gap-1">
              <label className="text-xs">{input.label}</label>
              <Input
                value={inputValues[input.key] ?? ""}
                onChange={(e) =>
                  setInputValues((prev) => ({
                    ...prev,
                    [input.key]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>
      )}
      <Button onClick={handleRun} disabled={running} className="self-start">
        {running ? (
          <Loader2 className="size-3.5 mr-2 animate-spin" />
        ) : (
          <Play className="size-3.5 mr-2" />
        )}
        {t("newUi.sidebar.fleets.runOnFleet")}
      </Button>
      {results && <ResultsList results={results} />}
    </div>
  );
}

function TransferTab({ fleetId }: { fleetId: number }) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<"push" | "pull">("push");
  const [remotePath, setRemotePath] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<FleetHostResult[] | null>(null);

  async function handleTransfer() {
    if (!remotePath.trim()) {
      toast.error(t("newUi.sidebar.fleets.remotePathRequired"));
      return;
    }
    if (direction === "push" && !file) {
      toast.error(t("newUi.sidebar.fleets.fileRequired"));
      return;
    }

    setBusy(true);
    setResults(null);
    try {
      if (direction === "push" && file) {
        const { results: r } = await pushFleetFile(fleetId, file, remotePath);
        setResults(r);
      } else {
        const {
          results: r,
          blob,
          fileName,
        } = await pullFleetFile(fleetId, remotePath);
        setResults(r);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      toast.success(t("newUi.sidebar.fleets.transferComplete"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.transferFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={direction === "push" ? "default" : "outline"}
          onClick={() => setDirection("push")}
        >
          <Upload className="size-3.5 mr-1.5" />
          {t("newUi.sidebar.fleets.push")}
        </Button>
        <Button
          size="sm"
          variant={direction === "pull" ? "default" : "outline"}
          onClick={() => setDirection("pull")}
        >
          <Download className="size-3.5 mr-1.5" />
          {t("newUi.sidebar.fleets.pull")}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {t("newUi.sidebar.fleets.remotePathLabel")}
        </label>
        <Input
          value={remotePath}
          onChange={(e) => setRemotePath(e.target.value)}
          placeholder="/etc/hosts"
          className="font-mono text-xs"
        />
      </div>

      {direction === "push" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            {t("newUi.sidebar.fleets.fileLabel")}
          </label>
          <Input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      )}

      <span className="text-[11px] text-muted-foreground">
        {direction === "push"
          ? t("newUi.sidebar.fleets.pushHint")
          : t("newUi.sidebar.fleets.pullHint")}
      </span>

      <Button onClick={handleTransfer} disabled={busy} className="self-start">
        {busy && <Loader2 className="size-3.5 mr-2 animate-spin" />}
        {direction === "push"
          ? t("newUi.sidebar.fleets.push")
          : t("newUi.sidebar.fleets.pull")}
      </Button>

      {results && <ResultsList results={results} />}
    </div>
  );
}

function InventoryTab({ fleetId }: { fleetId: number }) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<FleetInventoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFleetInventory(fleetId);
      setEntries(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.inventoryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [fleetId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const { results } = await refreshFleetInventory(fleetId);
      const failed = results.filter((r) => !r.success).length;
      if (failed > 0) {
        toast.warning(
          t("newUi.sidebar.fleets.commandPartialFailure", {
            failed,
            total: results.length,
          }),
        );
      } else {
        toast.success(t("newUi.sidebar.fleets.inventoryRefreshed"));
      }
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.inventoryRefreshFailed"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        onClick={handleRefresh}
        disabled={refreshing}
        size="sm"
        className="self-start"
      >
        {refreshing ? (
          <Loader2 className="size-3.5 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5 mr-2" />
        )}
        {t("newUi.sidebar.fleets.refreshInventory")}
      </Button>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => (
            <div
              key={entry.hostId}
              className="flex flex-col gap-1 border border-border p-2.5"
            >
              <div className="flex items-center gap-2">
                <Server className="size-3 shrink-0 text-muted-foreground" />
                <span className="text-xs font-semibold">{entry.hostName}</span>
              </div>
              {entry.inventory ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground pl-5">
                  <span>
                    {t("newUi.sidebar.fleets.inventoryOs")}:{" "}
                    {entry.inventory.osPrettyName ?? "-"}
                  </span>
                  <span>
                    {t("newUi.sidebar.fleets.inventoryKernel")}:{" "}
                    {entry.inventory.kernel ?? "-"}
                  </span>
                  <span>
                    {t("newUi.sidebar.fleets.inventoryArch")}:{" "}
                    {entry.inventory.architecture ?? "-"}
                  </span>
                  <span>
                    {t("newUi.sidebar.fleets.inventoryUptime")}:{" "}
                    {formatUptime(entry.inventory.uptimeSeconds)}
                  </span>
                  <span>
                    {t("newUi.sidebar.fleets.inventoryPackageManager")}:{" "}
                    {entry.inventory.packageManager ?? "-"}
                  </span>
                  <span>
                    {t("newUi.sidebar.fleets.inventoryCollectedAt")}:{" "}
                    {new Date(entry.inventory.collectedAt).toLocaleString()}
                  </span>
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground pl-5">
                  {t("newUi.sidebar.fleets.inventoryNoData")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PackagesTab({ fleetId }: { fleetId: number }) {
  const { t } = useTranslation();
  const [action, setAction] = useState<FleetPackageAction>("install");
  const [packageName, setPackageName] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<FleetHostResult[] | null>(null);

  async function handleRun() {
    if (action !== "upgrade-all" && !packageName.trim()) {
      toast.error(t("newUi.sidebar.fleets.packageNameRequired"));
      return;
    }
    setRunning(true);
    setResults(null);
    try {
      const { results: r } = await runFleetPackageAction(
        fleetId,
        action,
        action === "upgrade-all" ? undefined : packageName.trim(),
      );
      setResults(r);
      const failed = r.filter((x) => !x.success).length;
      if (failed === 0) {
        toast.success(t("newUi.sidebar.fleets.commandSucceeded"));
      } else {
        toast.warning(
          t("newUi.sidebar.fleets.commandPartialFailure", {
            failed,
            total: r.length,
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.commandFailed"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">
          {t("newUi.sidebar.fleets.packageActionLabel")}
        </label>
        <select
          className="px-2 py-1.5 text-xs bg-background border border-border text-foreground outline-none"
          value={action}
          onChange={(e) => setAction(e.target.value as FleetPackageAction)}
        >
          <option value="install">
            {t("newUi.sidebar.fleets.packageInstall")}
          </option>
          <option value="remove">
            {t("newUi.sidebar.fleets.packageRemove")}
          </option>
          <option value="upgrade-all">
            {t("newUi.sidebar.fleets.packageUpgradeAll")}
          </option>
        </select>
      </div>

      {action !== "upgrade-all" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            {t("newUi.sidebar.fleets.packageNameLabel")}
          </label>
          <Input
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            placeholder="curl"
            className="font-mono text-xs"
          />
        </div>
      )}

      <span className="text-[11px] text-muted-foreground">
        {t("newUi.sidebar.fleets.packageHint")}
      </span>

      <Button onClick={handleRun} disabled={running} className="self-start">
        {running ? (
          <Loader2 className="size-3.5 mr-2 animate-spin" />
        ) : (
          <Package className="size-3.5 mr-2" />
        )}
        {t("newUi.sidebar.fleets.runOnFleet")}
      </Button>

      {results && <ResultsList results={results} />}
    </div>
  );
}

type FleetActionView = "run" | "transfer" | "inventory" | "packages";

function FleetDetail({
  fleet,
  allHosts,
  onBack,
  onFleetChanged,
  onOpenFleetInventory,
}: {
  fleet: FleetRow;
  allHosts: SSHHost[];
  onBack: () => void;
  onFleetChanged: () => void;
  onOpenFleetInventory?: (fleetId: number) => void;
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<FleetMemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionView, setActionView] = useState<FleetActionView>("run");

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const data = await getFleetMembers(fleet.id);
      setMembers(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.membersLoadFailed"));
    } finally {
      setLoadingMembers(false);
    }
  }, [fleet.id, t]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  function handleMembersChanged() {
    loadMembers();
    onFleetChanged();
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="size-4" />
        </Button>
        <span
          className="size-2.5 shrink-0"
          style={{ backgroundColor: fleet.color ?? "#6b7280" }}
        />
        <span className="text-sm font-semibold truncate">{fleet.name}</span>
        <Badge variant="secondary" className="ml-1">
          {t("newUi.sidebar.fleets.memberCount", { count: members.length })}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => setPickerOpen(true)}
        >
          <Settings2 className="size-3.5 mr-1.5" />
          {t("newUi.sidebar.fleets.manageMembers")}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loadingMembers ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            {t("newUi.sidebar.fleets.noMembers")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <select
                className="flex-1 px-2 py-1.5 text-xs bg-background border border-border text-foreground outline-none"
                value={actionView}
                onChange={(e) =>
                  setActionView(e.target.value as FleetActionView)
                }
              >
                <option value="run">{t("newUi.sidebar.fleets.tabRun")}</option>
                <option value="transfer">
                  {t("newUi.sidebar.fleets.tabTransfer")}
                </option>
                <option value="inventory">
                  {t("newUi.sidebar.fleets.tabInventory")}
                </option>
                <option value="packages">
                  {t("newUi.sidebar.fleets.tabPackages")}
                </option>
              </select>
              {actionView === "inventory" && onOpenFleetInventory && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenFleetInventory(fleet.id)}
                  title={t("newUi.sidebar.fleets.openInventoryTab")}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              )}
            </div>

            {actionView === "run" && <RunCommandTab fleetId={fleet.id} />}
            {actionView === "transfer" && <TransferTab fleetId={fleet.id} />}
            {actionView === "inventory" && <InventoryTab fleetId={fleet.id} />}
            {actionView === "packages" && <PackagesTab fleetId={fleet.id} />}
          </div>
        )}
      </div>

      <MemberPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        fleetId={fleet.id}
        allHosts={allHosts}
        memberIds={memberIds}
        onChanged={handleMembersChanged}
      />
    </div>
  );
}

export function FleetsPanel({
  active,
  onOpenFleetInventory,
}: {
  active?: boolean;
  onOpenFleetInventory?: (fleetId: number) => void;
}) {
  const { t } = useTranslation();
  const [fleets, setFleets] = useState<FleetRow[]>([]);
  const [allHosts, setAllHosts] = useState<SSHHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedFleet, setSelectedFleet] = useState<FleetRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingFleet, setEditingFleet] = useState<FleetRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FleetRow | null>(null);
  const hasLoadedRef = useRef(false);

  const loadFleets = useCallback(async () => {
    try {
      const data = await listFleets();
      setFleets(data);
      setSelectedFleet((prev) =>
        prev ? (data.find((f) => f.id === prev.id) ?? null) : null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    if (!active || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    setLoading(true);
    Promise.all([listFleets(), getSSHHosts({ includeStatus: false })])
      .then(([fleetData, hosts]) => {
        setFleets(fleetData);
        setAllHosts(hosts as unknown as SSHHost[]);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        toast.error(message || t("newUi.sidebar.fleets.loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [active, hasLoadedRef, t]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteFleet(deleteTarget.id);
      toast.success(t("newUi.sidebar.fleets.fleetDeleted"));
      if (selectedFleet?.id === deleteTarget.id) setSelectedFleet(null);
      setDeleteTarget(null);
      loadFleets();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || t("newUi.sidebar.fleets.deleteFailed"));
    }
  }

  const visibleFleets = fleets.filter((f) =>
    f.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (selectedFleet) {
    return (
      <FleetDetail
        fleet={selectedFleet}
        allHosts={allHosts}
        onBack={() => setSelectedFleet(null)}
        onFleetChanged={loadFleets}
        onOpenFleetInventory={onOpenFleetInventory}
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 p-3 border-b border-border shrink-0">
        <Boxes className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">
          {t("newUi.sidebar.fleets.title")}
        </span>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => {
            setEditingFleet(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-3.5 mr-1.5" />
          {t("newUi.sidebar.fleets.createFleet")}
        </Button>
      </div>

      <div className="p-3 pb-0 shrink-0">
        <div className="relative">
          <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-7 h-8 text-xs"
            placeholder={t("newUi.sidebar.fleets.searchFleets")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : visibleFleets.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            {t("newUi.sidebar.fleets.noFleets")}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visibleFleets.map((fleet) => (
              <div
                key={fleet.id}
                className="flex items-center gap-2 border border-border p-2.5 cursor-pointer hover:bg-muted/40 group"
                onClick={() => setSelectedFleet(fleet)}
              >
                <span
                  className="size-2.5 shrink-0"
                  style={{ backgroundColor: fleet.color ?? "#6b7280" }}
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-semibold truncate">
                    {fleet.name}
                  </span>
                  {fleet.description && (
                    <span className="text-[11px] text-muted-foreground truncate">
                      {fleet.description}
                    </span>
                  )}
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {t("newUi.sidebar.fleets.memberCount", {
                    count: fleet.memberCount,
                  })}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingFleet(fleet);
                    setFormOpen(true);
                  }}
                >
                  <Settings2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(fleet);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <FleetFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        fleet={editingFleet}
        onSaved={loadFleets}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("newUi.sidebar.fleets.deleteFleetTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("newUi.sidebar.fleets.deleteFleetDescription", {
                name: deleteTarget?.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <X className="size-3.5 mr-2" />
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
