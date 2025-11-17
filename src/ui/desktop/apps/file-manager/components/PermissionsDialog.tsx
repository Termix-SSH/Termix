import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { Shield } from "lucide-react";

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-dark-bg border-2 border-dark-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            {t("fileManager.changePermissions")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("fileManager.changePermissionsDesc")}:{" "}
            <span className="font-mono text-foreground">{file.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-gray-400">
                {t("fileManager.currentPermissions")}
              </Label>
              <p className="font-mono text-lg mt-1">
                {file.permissions || "644"}
              </p>
            </div>
            <div>
              <Label className="text-gray-400">
                {t("fileManager.newPermissions")}
              </Label>
              <p className="font-mono text-lg mt-1">{octal}</p>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-base font-semibold text-foreground">
              {t("fileManager.owner")} {file.owner && `(${file.owner})`}
            </Label>
            <div className="flex gap-6 ml-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="owner-read"
                  checked={ownerRead}
                  onCheckedChange={(checked) => setOwnerRead(checked === true)}
                />
                <label htmlFor="owner-read" className="text-sm cursor-pointer">
                  {t("fileManager.read")}
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="owner-write"
                  checked={ownerWrite}
                  onCheckedChange={(checked) => setOwnerWrite(checked === true)}
                />
                <label htmlFor="owner-write" className="text-sm cursor-pointer">
                  {t("fileManager.write")}
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="owner-execute"
                  checked={ownerExecute}
                  onCheckedChange={(checked) =>
                    setOwnerExecute(checked === true)
                  }
                />
                <label
                  htmlFor="owner-execute"
                  className="text-sm cursor-pointer"
                >
                  {t("fileManager.execute")}
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-base font-semibold text-foreground">
              {t("fileManager.group")} {file.group && `(${file.group})`}
            </Label>
            <div className="flex gap-6 ml-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="group-read"
                  checked={groupRead}
                  onCheckedChange={(checked) => setGroupRead(checked === true)}
                />
                <label htmlFor="group-read" className="text-sm cursor-pointer">
                  {t("fileManager.read")}
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="group-write"
                  checked={groupWrite}
                  onCheckedChange={(checked) => setGroupWrite(checked === true)}
                />
                <label htmlFor="group-write" className="text-sm cursor-pointer">
                  {t("fileManager.write")}
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="group-execute"
                  checked={groupExecute}
                  onCheckedChange={(checked) =>
                    setGroupExecute(checked === true)
                  }
                />
                <label
                  htmlFor="group-execute"
                  className="text-sm cursor-pointer"
                >
                  {t("fileManager.execute")}
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="text-base font-semibold text-foreground">
              {t("fileManager.others")}
            </Label>
            <div className="flex gap-6 ml-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="other-read"
                  checked={otherRead}
                  onCheckedChange={(checked) => setOtherRead(checked === true)}
                />
                <label htmlFor="other-read" className="text-sm cursor-pointer">
                  {t("fileManager.read")}
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="other-write"
                  checked={otherWrite}
                  onCheckedChange={(checked) => setOtherWrite(checked === true)}
                />
                <label htmlFor="other-write" className="text-sm cursor-pointer">
                  {t("fileManager.write")}
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="other-execute"
                  checked={otherExecute}
                  onCheckedChange={(checked) =>
                    setOtherExecute(checked === true)
                  }
                />
                <label
                  htmlFor="other-execute"
                  className="text-sm cursor-pointer"
                >
                  {t("fileManager.execute")}
                </label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
