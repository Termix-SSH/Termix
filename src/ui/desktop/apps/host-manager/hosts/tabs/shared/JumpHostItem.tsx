import React from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command.tsx";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { JumpHostItemProps } from "./tab-types";

export function JumpHostItem({
  jumpHost,
  index,
  hosts,
  editingHost,
  onUpdate,
  onRemove,
  t,
}: JumpHostItemProps) {
  const [open, setOpen] = React.useState(false);
  const selectedHost = hosts.find((h) => h.id === jumpHost.hostId);

  return (
    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-sm font-medium text-muted-foreground">
          {index + 1}.
        </span>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild className="flex-1">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
            >
              {selectedHost
                ? `${selectedHost.name || `${selectedHost.username}@${selectedHost.ip}`}`
                : t("hosts.selectServer")}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0"
            style={{ width: "var(--radix-popover-trigger-width)" }}
          >
            <Command>
              <CommandInput placeholder={t("hosts.searchServers")} />
              <CommandEmpty>{t("hosts.noServerFound")}</CommandEmpty>
              <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                {hosts
                  .filter((h) => !editingHost || h.id !== editingHost.id)
                  .map((host) => (
                    <CommandItem
                      key={host.id}
                      value={`${host.name} ${host.ip} ${host.username} ${host.id}`}
                      onSelect={() => {
                        onUpdate(host.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          jumpHost.hostId === host.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {host.name || `${host.username}@${host.ip}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {host.username}@{host.ip}:{host.port}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
              </CommandGroup>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="ml-2"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
