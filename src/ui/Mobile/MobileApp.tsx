import React, {useRef, FC} from "react";
import {Terminal} from "@/ui/Mobile/Apps/Terminal/Terminal.tsx";
import {TerminalKeyboard} from "@/ui/Mobile/Apps/Terminal/TerminalKeyboard.tsx";
import {BottomNavbar} from "@/ui/Mobile/Apps/Navigation/BottomNavbar.tsx";
import {LeftSidebar} from "@/ui/Mobile/Apps/Navigation/LeftSidebar.tsx";

export const MobileApp: FC = () => {
    const terminalRef = useRef<any>(null);
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);

    function handleKeyboardInput(input: string) {
        if (!terminalRef.current?.sendInput) return;

        const keyMap: Record<string, string> = {
            "{backspace}": "\x7f",
            "{space}": " ",
            "{tab}": "\t",
            "{enter}": "",
            "{escape}": "\x1b",
            "{arrowUp}": "\x1b[A",
            "{arrowDown}": "\x1b[B",
            "{arrowRight}": "\x1b[C",
            "{arrowLeft}": "\x1b[D",
            "{delete}": "\x1b[3~",
            "{home}": "\x1b[H",
            "{end}": "\x1b[F",
            "{pageUp}": "\x1b[5~",
            "{pageDown}": "\x1b[6~"
        };

        if (input in keyMap) {
            terminalRef.current.sendInput(keyMap[input]);
        } else {
            terminalRef.current.sendInput(input);
        }
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-[#09090b] overflow-y-hidden overflow-x-hidden relative">
            <div className="flex-1 min-h-0">
                <Terminal
                    ref={terminalRef}
                    hostConfig={{
                        ip: "n/a",
                        port: 22,
                        username: "n/a",
                        password: "n/a"
                    }}
                    isVisible={true}
                />
            </div>
            <TerminalKeyboard
                onSendInput={handleKeyboardInput}
            />
            <BottomNavbar
                onSidebarOpenClick={() => setIsSidebarOpen(true)}
            />

            {isSidebarOpen && (
                <div
                    className="absolute inset-0 bg-black/30 backdrop-blur-sm z-10"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            <div className="absolute top-0 left-0 h-full z-20 pointer-events-none">
                <div onClick={(e) => { e.stopPropagation(); }} className="pointer-events-auto">
                    <LeftSidebar
                        isSidebarOpen={isSidebarOpen}
                        setIsSidebarOpen={setIsSidebarOpen}
                    />
                </div>
            </div>
        </div>
    );
}