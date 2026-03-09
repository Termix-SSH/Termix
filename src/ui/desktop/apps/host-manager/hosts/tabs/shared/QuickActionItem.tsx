import React from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
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
import type { QuickActionItemProps } from "./tab-types";

export function QuickActionItem({
  quickAction,
  index,
  snippets,
  onUpdate,
  onRemove,
  t,
}: QuickActionItemProps) {
  const [open, setOpen] = React.useState(false);
  const selectedSnippet = snippets.find((s) => s.id === quickAction.snippetId);

  return (
    <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/30">
      <div className="flex flex-col gap-2 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {index + 1}.
          </span>
          <Input
            placeholder={t("hosts.quickActionName")}
            value={quickAction.name}
            onChange={(e) => onUpdate(e.target.value, quickAction.snippetId)}
            onBlur={(e) =>
              onUpdate(e.target.value.trim(), quickAction.snippetId)
            }
            className="flex-1"
          />
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild className="w-full">
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
            >
              {selectedSnippet
                ? selectedSnippet.name
                : t("hosts.selectSnippet")}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="p-0"
            style={{ width: "var(--radix-popover-trigger-width)" }}
          >
            <Command>
              <CommandInput placeholder={t("hosts.searchSnippets")} />
              <CommandEmpty>{t("hosts.noSnippetFound")}</CommandEmpty>
              <CommandGroup className="max-h-[300px] overflow-y-auto thin-scrollbar">
                {snippets.map((snippet) => (
                  <CommandItem
                    key={snippet.id}
                    value={`${snippet.name} ${snippet.content} ${snippet.id}`}
                    onSelect={() => {
                      onUpdate(quickAction.name, snippet.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        quickAction.snippetId === snippet.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{snippet.name}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[350px]">
                        {snippet.content}
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
