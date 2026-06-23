import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/dialog.tsx";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

interface FileItem {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
  permissions?: string;
  owner?: string;
  group?: string;
}

interface PermissionsDialogProps {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (file: FileItem, permissions: string) => Promise<void>;
}

const parsePermissions = (
  perms: string,
): { owner: number; group: number; other: number } => {
  if (!perms) {
    return { owner: 0, group: 0, other: 0 };
  }

  if (/^\d{3,4}$/.test(perms)) {
    const numStr = perms.slice(-3);
    return {
      owner: parseInt(numStr[0] || "0", 10),
      group: parseInt(numStr[1] || "0", 10),
      other: parseInt(numStr[2] || "0", 10),
    };
  }
  const cleanPerms = perms.replace(/^-/, "").substring(0, 9);

  const calcBits = (str: string): number => {
    let value = 0;
    if (str[0] === "r") value += 4;
    if (str[1] === "w") value += 2;
    if (str[2] === "x") value += 1;
    return value;
  };

  return {
    owner: calcBits(cleanPerms.substring(0, 3)),
    group: calcBits(cleanPerms.substring(3, 6)),
    other: calcBits(cleanPerms.substring(6, 9)),
  };
};

const toNumeric = (owner: number, group: number, other: number): string => {
  return `${owner}${group}${other}`;
};

export function PermissionsDialog({
  file,
  open,
  onOpenChange,
  onSave,
}: PermissionsDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const initialPerms = parsePermissions(file?.permissions || "644");
  const [ownerRead, setOwnerRead] = useState((initialPerms.owner & 4) !== 0);
  const [ownerWrite, setOwnerWrite] = useState((initialPerms.owner & 2) !== 0);
  const [ownerExecute, setOwnerExecute] = useState(
    (initialPerms.owner & 1) !== 0,
  );

  const [groupRead, setGroupRead] = useState((initialPerms.group & 4) !== 0);
  const [groupWrite, setGroupWrite] = useState((initialPerms.group & 2) !== 0);
  const [groupExecute, setGroupExecute] = useState(
    (initialPerms.group & 1) !== 0,
  );

  const [otherRead, setOtherRead] = useState((initialPerms.other & 4) !== 0);
  const [otherWrite, setOtherWrite] = useState((initialPerms.other & 2) !== 0);
  const [otherExecute, setOtherExecute] = useState(
    (initialPerms.other & 1) !== 0,
  );

  useEffect(() => {
    if (file) {
      const perms = parsePermissions(file.permissions || "644");
      setOwnerRead((perms.owner & 4) !== 0);
      setOwnerWrite((perms.owner & 2) !== 0);
      setOwnerExecute((perms.owner & 1) !== 0);
      setGroupRead((perms.group & 4) !== 0);
      setGroupWrite((perms.group & 2) !== 0);
      setGroupExecute((perms.group & 1) !== 0);
      setOtherRead((perms.other & 4) !== 0);
      setOtherWrite((perms.other & 2) !== 0);
      setOtherExecute((perms.other & 1) !== 0);
    }
  }, [file]);

  const calculateOctal = (): string => {
    const owner =
      (ownerRead ? 4 : 0) + (ownerWrite ? 2 : 0) + (ownerExecute ? 1 : 0);
    const group =
      (groupRead ? 4 : 0) + (groupWrite ? 2 : 0) + (groupExecute ? 1 : 0);
    const other =
      (otherRead ? 4 : 0) + (otherWrite ? 2 : 0) + (otherExecute ? 1 : 0);
    return toNumeric(owner, group, other);
  };

  const handleSave = async () => {
    if (!file) return;

    setLoading(true);
    try {
      const permissions = calculateOctal();
      await onSave(file, permissions);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update permissions:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!file) return null;

  const octal = calculateOctal();

  const rows = [
    {
      label: `${t("fileManager.owner")}${file.owner ? ` (${file.owner})` : ""}`,
      read: ownerRead,
      setRead: setOwnerRead,
      write: ownerWrite,
      setWrite: setOwnerWrite,
      execute: ownerExecute,
      setExecute: setOwnerExecute,
    },
    {
      label: `${t("fileManager.group")}${file.group ? ` (${file.group})` : ""}`,
      read: groupRead,
      setRead: setGroupRead,
      write: groupWrite,
      setWrite: setGroupWrite,
      execute: groupExecute,
      setExecute: setGroupExecute,
    },
    {
      label: t("fileManager.others"),
      read: otherRead,
      setRead: setOtherRead,
      write: otherWrite,
      setWrite: setOtherWrite,
      execute: otherExecute,
      setExecute: setOtherExecute,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg rounded-none border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Lock className="size-4 text-accent-brand" />
            {t("fileManager.changePermissions")}
          </DialogTitle>
          <DialogDescription className="text-[10px] font-bold tracking-tight text-muted-foreground font-mono break-all">
            {file.path}
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 flex flex-col gap-4">
          <div className="border border-border overflow-hidden">
            <div className="grid grid-cols-[1fr_64px_64px_64px] bg-muted/50 border-b border-border">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground" />
              {[
                t("fileManager.read"),
                t("fileManager.write"),
                t("fileManager.execute"),
              ].map((h) => (
                <div
                  key={h}
                  className="py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground text-center border-l border-border"
                >
                  {h}
                </div>
              ))}
            </div>
            {rows.map((row, i) => (
              <div
                key={i}
                className={`grid grid-cols-[1fr_64px_64px_64px] ${i < rows.length - 1 ? "border-b border-border" : ""}`}
              >
                <div className="px-3 py-3 text-xs font-semibold">
                  {row.label}
                </div>
                {[
                  { val: row.read, set: row.setRead },
                  { val: row.write, set: row.setWrite },
                  { val: row.execute, set: row.setExecute },
                ].map((perm, j) => (
                  <div
                    key={j}
                    className="flex items-center justify-center border-l border-border py-3"
                  >
                    <input
                      type="checkbox"
                      checked={perm.val}
                      onChange={(e) => perm.set(e.target.checked)}
                      className="accent-[var(--accent-brand)] size-4 cursor-pointer"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground shrink-0">
              {t("fileManager.octal")}
            </span>
            <Input
              value={octal}
              readOnly
              className="w-20 rounded-none bg-muted/50 border-border text-xs font-mono text-center h-8"
            />
            <span className="text-[10px] text-muted-foreground font-mono">
              {t("fileManager.currentPermissions")}: {file.permissions || "—"}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={loading}
            className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 rounded-none text-[10px] font-bold uppercase tracking-widest"
          >
            {loading ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
