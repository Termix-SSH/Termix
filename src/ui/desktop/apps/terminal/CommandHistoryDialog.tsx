import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Search, Clock, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CommandHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: string[];
  onSelectCommand: (command: string) => void;
  onDeleteCommand?: (command: string) => void;
  isLoading?: boolean;
}

export function CommandHistoryDialog({
  open,
  onOpenChange,
  commands,
  onSelectCommand,
  onDeleteCommand,
  isLoading = false,
}: CommandHistoryDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Filter commands based on search query
  const filteredCommands = searchQuery
    ? commands.filter((cmd) =>
        cmd.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : commands;

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setSearchQuery("");
      setSelectedIndex(0);
      // Focus search input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      selectedRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filteredCommands.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : prev
        );
        break;

      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        break;

      case "Enter":
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          onSelectCommand(filteredCommands[selectedIndex]);
          onOpenChange(false);
        }
        break;

      case "Escape":
        e.preventDefault();
        onOpenChange(false);
        break;
    }
  };

  const handleSelect = (command: string) => {
    onSelectCommand(command);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Command History
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search commands... (↑↓ to navigate, Enter to select)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              className="pl-10 pr-10"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                onClick={() => {
                  setSearchQuery("");
                  inputRef.current?.focus();
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <ScrollArea ref={listRef} className="h-[400px] px-6 pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                Loading history...
              </div>
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              {searchQuery ? (
                <>
                  <Search className="h-12 w-12 mb-2 opacity-20" />
                  <p>No commands found matching "{searchQuery}"</p>
                </>
              ) : (
                <>
                  <Clock className="h-12 w-12 mb-2 opacity-20" />
                  <p>No command history yet</p>
                  <p className="text-sm">Execute commands to build your history</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredCommands.map((command, index) => (
                <div
                  key={index}
                  ref={index === selectedIndex ? selectedRef : null}
                  className={cn(
                    "px-4 py-2.5 rounded-md transition-colors group",
                    "font-mono text-sm flex items-center justify-between gap-2",
                    "hover:bg-accent",
                    index === selectedIndex && "bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/50"
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span
                    className="flex-1 cursor-pointer"
                    onClick={() => handleSelect(command)}
                  >
                    {command}
                  </span>
                  {onDeleteCommand && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteCommand(command);
                      }}
                      title="Delete command"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="px-6 py-3 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>
                <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">↑↓</kbd> Navigate
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">Enter</kbd> Select
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">Esc</kbd> Close
              </span>
            </div>
            <span>
              {filteredCommands.length} command{filteredCommands.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
