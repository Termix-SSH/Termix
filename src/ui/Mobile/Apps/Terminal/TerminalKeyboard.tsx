import React, {useState} from "react";
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

    const onKeyPress = async (button: string) => {
        if (button === "{shift}") {
            setLayoutName("shift");
            return;
        }
        if (button === "{unshift}") {
            setLayoutName("default");
            return;
        }
        if (button === "{more}") {
            setLayoutName("more");
            return;
        }
        if (button === "{less}") {
            setLayoutName("default");
            return;
        }
        if (button === "{hide}") {
            setLayoutName("hide");
            return;
        }
        if (button === "{unhide}") {
            setLayoutName("default");
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

        if (button === "{paste}") {
            if (navigator.clipboard?.readText) {
                try {
                    const text = await navigator.clipboard.readText();
                    if (text) {
                        onSendInput(text);
                    }
                } catch (err) {

                }
            }
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
                if (charCode >= 64 && charCode <= 95) {
                    input = String.fromCharCode(charCode - 64);
                }
            }
        }

        if (isAlt) {
            input = `\x1b${input}`;
        }

        navigator.vibrate(20)
        onSendInput(input);
    };

    const buttonTheme = [
        {
            class: "hg-space-big",
            buttons: "{space}",
        },
        {
            class: "hg-space-medium",
            buttons: "{enter} {backspace}",
        },
        {
            class: "hg-space-small",
            buttons: "{hide} {less} {more}",
        }
    ];

    if (isCtrl) {
        buttonTheme.push({class: "key-active", buttons: "{ctrl}"});
    }
    if (isAlt) {
        buttonTheme.push({class: "key-active", buttons: "{alt}"});
    }

    return (
        <div className="">
            <Keyboard
                layout={{
                    default: [
                        "{esc} {tab} {ctrl} {alt} {arrowLeft} {arrowRight} {arrowUp} {arrowDown}",
                        "q w e r t y u i o p",
                        "a s d f g h j k l",
                        "{shift} z x c v b n m {backspace}",
                        "{hide} {more} {space} {enter}",
                    ],
                    shift: [
                        "{esc} {tab} {ctrl} {alt} {arrowLeft} {arrowRight} {arrowUp} {arrowDown}",
                        "Q W E R T Y U I O P",
                        "A S D F G H J K L",
                        "{unshift} Z X C V B N M {backspace}",
                        "{hide} {more} {space} {enter}",
                    ],
                    more: [
                        "{esc} {tab} {ctrl} {alt} {end} {home} {pgUp} {pgDn}",
                        "1 2 3 4 5 6 7 8 9 0",
                        "! @ # $ % ^ & * ( ) _ +",
                        "[ ] { } | \\ ; : ' \" , . / < >",
                        "F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 F11 F12",
                        "{arrowLeft} {arrowRight} {arrowUp} {arrowDown} {paste} {backspace}",
                        "{hide} {less} {space} {enter}",
                    ],
                    hide: [
                        "{unhide}"
                    ]
                }}
                layoutName={layoutName}
                onKeyPress={onKeyPress}
                display={{
                    "{shift}": "up",
                    "{unshift}": "dn",
                    "{backspace}": "back",
                    "{more}": "more",
                    "{less}": "less",
                    "{space}": "space",
                    "{enter}": "enter",
                    "{arrowLeft}": "←",
                    "{arrowRight}": "→",
                    "{arrowUp}": "↑",
                    "{arrowDown}": "↓",
                    "{hide}": "hide",
                    "{unhide}": "unhide",
                    "{esc}": "esc",
                    "{tab}": "tab",
                    "{ctrl}": "ctrl",
                    "{alt}": "alt",
                    "{paste}": "paste",
                    "{end}": "end",
                    "{home}": "home",
                    "{pgUp}": "pgUp",
                    "{pgDn}": "pgDn",
                }}
                theme={"hg-theme-default dark-theme"}
                useTouchEvents={true}
                buttonTheme={buttonTheme}
            />
        </div>
    );
}
