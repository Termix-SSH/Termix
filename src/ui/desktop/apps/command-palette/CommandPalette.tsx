import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  CommandGroup,
  CommandSeparator,
} from "@/components/ui/command.tsx";
import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Calculator,
  Calendar,
  CreditCard,
  Settings,
  Smile,
  User,
} from "lucide-react";
import { CommandEmpty } from "cmdk";
export function CommandPalette({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm",
        !isOpen && "hidden",
      )}
      onClick={() => setIsOpen(false)}
    >
      <Command
        className="w-3/4 max-w-2xl max-h-[60vh] rounded-lg border-2 border-dark-border shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <CommandInput
          ref={inputRef}
          placeholder="Search for hosts or quick actions..."
        />
        <CommandList>
          <CommandGroup heading="Suggestions">
            <CommandItem>
              <Calendar />
              <span>Calendar</span>
            </CommandItem>
            <CommandItem>
              <Smile />
              <span>Search Emoji</span>
            </CommandItem>
            <CommandItem disabled>
              <Calculator />
              <span>Calculator</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Settings">
            <CommandItem>
              <User />
              <span>Profile</span>
              <CommandShortcut>⌘P</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <CreditCard />
              <span>Billing</span>
              <CommandShortcut>⌘B</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <Settings />
              <span>Settings</span>
              <CommandShortcut>⌘S</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}
