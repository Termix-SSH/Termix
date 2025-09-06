import React, {useState, useCallback} from "react";
import Keyboard from "react-simple-keyboard";
import "react-simple-keyboard/build/css/index.css";
import "./kb-dark-theme.css";

interface TerminalKeyboardProps {
    onSendInput: (input: string) => void;
}

export function TerminalKeyboard({onSendInput}: TerminalKeyboardProps) {
    const [layoutName, setLayoutName] = useState("default");
    const [isCtrl, setIsCtrl] = useState(false);
    const [isAlt, setIsAlt] = useState(false);

    const handlePaste = useCallback(async () => {
        if (navigator.clipboard?.readText) {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    onSendInput(text);
                }
            } catch (err) {
                console.error("Failed to read clipboard:", err);
            }
        }
    }, [onSendInput]);

    const onKeyPress = useCallback((button: string) => {
        const layoutMap: { [key: string]: string } = {
            "{shift}": "shift",
            "{unshift}": "default",
            "{symbols}": "symbols",
            "{fn}": "fn",
            "{abc}": "default",
        };

        if (layoutMap[button]) {
            setLayoutName(layoutMap[button]);
            return;
        }

        if (button === "{paste}") {
            handlePaste();
            return;
        }

        if (button === "{ctrl}") {
            setIsCtrl(prev => !prev);
            return;
        }

        if (button === "{alt}") {
            setIsAlt(prev => !prev);
            return;
        }

        let input = button;

        const specialKeyMap: { [key: string]: string } = {
            "{esc}": "\x1b", "{enter}": "\r", "{tab}": "\t", "{backspace}": "\x7f",
            "{arrowUp}": "\x1b[A", "{arrowDown}": "\x1b[B", "{arrowRight}": "\x1b[C", "{arrowLeft}": "\x1b[D",
            "{home}": "\x1b[H", "{end}": "\x1b[F", "{pgUp}": "\x1b[5~", "{pgDn}": "\x1b[6~",
            "F1": "\x1bOP", "F2": "\x1bOQ", "F3": "\x1bOR", "F4": "\x1bOS",
            "F5": "\x1b[15~", "F6": "\x1b[17~", "F7": "\x1b[18~", "F8": "\x1b[19~",
            "F9": "\x1b[20~", "F10": "\x1b[21~", "F11": "\x1b[23~", "F12": "\x1b[24~",
            "{space}": " "
        };

        if (specialKeyMap[input]) {
            input = specialKeyMap[input];
        }

        if (isCtrl) {
            if (input.length === 1) {
                const charCode = input.toUpperCase().charCodeAt(0);
                // @, A-Z, [, \, ], ^, _
                if (charCode >= 64 && charCode <= 95) {
                    input = String.fromCharCode(charCode - 64);
                }
            }
        }

        if (isAlt) {
            input = `\x1b${input}`;
        }

        navigator.vibrate(20);
        onSendInput(input);
    }, [isCtrl, isAlt, onSendInput, handlePaste]);

    const buttonTheme = [
        {
            class: "hg-space-big",
            buttons: "{space}",
        },
        {
            class: "hg-space-medium",
            buttons: "{enter} {backspace}",
        }
    ];

    if (isCtrl) {
        buttonTheme.push({class: "key-active", buttons: "{ctrl}"});
    }
    if (isAlt) {
        buttonTheme.push({class: "key-active", buttons: "{alt}"});
    }

    const layout = {
        default: [
            "q w e r t y u i o p",
            "a s d f g h j k l",
            "{shift} z x c v b n m {backspace}",
            "{symbols} {ctrl} {alt} {space} {enter}",
        ],
        shift: [
            "Q W E R T Y U I O P",
            "A S D F G H J K L",
            "{unshift} Z X C V B N M {backspace}",
            "{symbols} {ctrl} {alt} {space} {enter}",
        ],
        symbols: [
            "1 2 3 4 5 6 7 8 9 0",
            "! @ # $ % ^ & * ( )",
            "- _ = + [ ] { } \\ |",
            "~ ` ' \" ; : , . / < > ?",
            "{abc} {fn} {space} {backspace}",
        ],
        fn: [
            "F1 F2 F3 F4 F5 F6",
            "F7 F8 F9 F10 F11 F12",
            "{esc} {tab} {home} {end}",
            "{pgUp} {pgDn} {arrowUp} {arrowDown}",
            "{abc} {arrowLeft} {arrowRight} {paste} {backspace}",
        ]
    };

    const display = {
        "{shift}": "⇧",
        "{unshift}": "⇧",
        "{backspace}": "⌫",
        "{symbols}": "?123",
        "{abc}": "abc",
        "{fn}": "Fn",
        "{space}": "space",
        "{enter}": "enter",
        "{arrowLeft}": "←",
        "{arrowRight}": "→",
        "{arrowUp}": "↑",
        "{arrowDown}": "↓",
        "{esc}": "esc",
        "{tab}": "tab",
        "{ctrl}": "ctrl",
        "{alt}": "alt",
        "{paste}": "paste",
        "{end}": "end",
        "{home}": "home",
        "{pgUp}": "pgUp",
        "{pgDn}": "pgDn",
    };

    return (
        <div className="">
            <Keyboard
                layout={layout}
                layoutName={layoutName}
                onKeyPress={onKeyPress}
                display={display}
                theme={"hg-theme-default dark-theme"}
                useTouchEvents={true}
                disableButtonHold={true}
                buttonTheme={buttonTheme}
            />
        </div>
    );
}