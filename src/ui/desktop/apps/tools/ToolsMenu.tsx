import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Hammer, Wrench, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ToolsMenuProps {
  onOpenSshTools: () => void;
  onOpenSnippets: () => void;
}

export function ToolsMenu({
  onOpenSshTools,
  onOpenSnippets,
}: ToolsMenuProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-[30px] h-[30px] border-dark-border"
          title={t("nav.tools")}
        >
          <Hammer className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-dark-bg border-dark-border text-white"
      >
        <DropdownMenuItem
          onClick={onOpenSshTools}
          className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
        >
          <Wrench className="h-4 w-4" />
          <span className="flex-1">{t("sshTools.title")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onOpenSnippets}
          className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
        >
          <FileText className="h-4 w-4" />
          <span className="flex-1">{t("snippets.title")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
