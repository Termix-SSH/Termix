import {Button} from "@/components/ui/button.tsx";
import {Menu, X, Terminal as TerminalIcon} from "lucide-react";
import {useTabs} from "@/ui/Mobile/Navigation/Tabs/TabContext.tsx";
import {cn} from "@/lib/utils.ts";

interface MenuProps {
    onSidebarOpenClick?: () => void;
}

export function BottomNavbar({onSidebarOpenClick}: MenuProps) {
    const {tabs, currentTab, setCurrentTab, removeTab} = useTabs();

    return (
        <div className="w-full h-[50px] bg-dark-bg items-center p-1">
            <div className="flex gap-2 !mb-0.5">
                <Button className="w-[40px] h-[40px] flex-shrink-0" variant="outline" onClick={onSidebarOpenClick}>
                    <Menu/>
                </Button>
                <div className="flex-1 overflow-x-auto whitespace-nowrap thin-scrollbar">
                    <div className="inline-flex gap-2">
                        {tabs.map(tab => (
                            <div key={tab.id} className="inline-flex rounded-md shadow-sm" role="group">
                                <Button
                                    variant="outline"
                                    className={cn(
                                        "h-10 rounded-r-none !px-3 border-1 border-dark-border",
                                        tab.id === currentTab && '!bg-dark-bg-darkest !text-white'
                                    )}
                                    onClick={() => setCurrentTab(tab.id)}
                                >
                                    <TerminalIcon className="mr-1 h-4 w-4"/>
                                    {tab.title}
                                </Button>
                                <Button
                                    variant="outline"
                                    className="h-10 rounded-l-none !px-2 border-1 border-dark-border"
                                    onClick={() => removeTab(tab.id)}
                                >
                                    <X className="h-4 w-4"/>
                                </Button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
