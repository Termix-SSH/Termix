import { Button } from "@/components/ui/button";
import { Menu, X, Terminal as TerminalIcon } from "lucide-react";
import { useTabs } from "@/ui/mobile/apps/navigation/tabs/TabContext.tsx";
import { cn } from "@/lib/utils.ts";

interface MenuProps {
  onSidebarOpenClick?: () => void;
}

export function BottomNavbar({ onSidebarOpenClick }: MenuProps) {
  const { tabs, currentTab, setCurrentTab, removeTab } = useTabs();

  return (
    <div className="w-full h-[80px] bg-canvas flex items-center p-2 gap-2">
      <Button
        className="w-[40px] h-[40px] flex-shrink-0"
        variant="outline"
        onClick={onSidebarOpenClick}
      >
        <Menu />
      </Button>
      <div className="flex-1 overflow-x-auto whitespace-nowrap thin-scrollbar">
        <div className="inline-flex gap-2">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="inline-flex rounded-md shadow-sm"
              role="group"
            >
              <Button
                variant="outline"
                className={cn(
                  "h-10 rounded-r-none !px-3 border-1 border-edge",
                  tab.id === currentTab && "!bg-deepest !text-foreground",
                )}
                onClick={() => setCurrentTab(tab.id)}
              >
                <TerminalIcon className="mr-1 h-4 w-4" />
                {tab.title}
              </Button>
              <Button
                variant="outline"
                className="h-10 rounded-l-none !px-2 border-1 border-edge"
                onClick={() => removeTab(tab.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
