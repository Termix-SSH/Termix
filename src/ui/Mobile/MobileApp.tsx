import {useRef, FC} from "react";
import {Terminal} from "@/ui/Mobile/Apps/Terminal/Terminal.tsx";
import {TerminalKeyboard} from "@/ui/Mobile/Apps/Terminal/TerminalKeyboard.tsx";

export const MobileApp: FC = () => {
    const terminalRef = useRef<any>(null);

    function handleKeyboardInput(input: string) {
        if (!terminalRef.current?.sendInput) return;

        const keyMap: Record<string, string> = {
            "{backspace}": "\x7f",
            "{space}": " ",
            "{tab}": "\t",
            "{enter}": "\r",
            "{escape}": "\x1b",
            "{arrowUp}": "\x1b[A",
            "{arrowDown}": "\x1b[B",
            "{arrowRight}": "\x1b[C",
            "{arrowLeft}": "\x1b[D",
            "{delete}": "\x1b[3~",
            "{home}": "\x1b[H",
            "{end}": "\x1b[F",
            "{pageUp}": "\x1b[5~",
            "{pageDown}": "\x1b[6~",
        };

        if (input in keyMap) {
            terminalRef.current.sendInput(keyMap[input]);
        } else {
            terminalRef.current.sendInput(input);
        }
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-[#09090b] overflow-y-hidden overflow-x-hidden">
            <div className="flex-1 min-h-0">
                <Terminal
                    ref={terminalRef}
                    hostConfig={{
                        ip: "192.210.197.55",
                        port: 22,
                        username: "bugattiguy527",
                        password: "bugatti$123"
                    }}
                    isVisible={true}
                />
            </div>
            <TerminalKeyboard
                onSendInput={handleKeyboardInput}
            />
            <div className="w-full h-[80px] bg-[#18181BFF]">

            </div>
        </div>
    )
}
