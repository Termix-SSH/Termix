import React from "react";
import { FileManagerModern } from "@/ui/Desktop/Apps/File Manager/FileManagerModern.tsx";
import type { SSHHost } from "../../../types/index.js";

export function FileManager({
  initialHost = null,
  onClose,
}: {
  onSelectView?: (view: string) => void;
  embedded?: boolean;
  initialHost?: SSHHost | null;
  onClose?: () => void;
}): React.ReactElement {
  return (
    <FileManagerModern
      initialHost={initialHost}
      onClose={onClose}
    />
  );
}