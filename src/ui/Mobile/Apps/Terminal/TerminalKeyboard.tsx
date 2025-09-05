import React, {useState} from "react";
import Keyboard from "react-simple-keyboard";
import "react-simple-keyboard/build/css/index.css";
import "./kb-dark-theme.css";

interface TerminalKeyboardProps {
    onSendInput: (input: string) => void;
}

export function TerminalKeyboard({onSendInput}: TerminalKeyboardProps) {
    const [layoutName, setLayoutName] = useState("default");

    const onKeyPress = (button: string) => {
        if (button === "{shift}") {
            setLayoutName("shift");
            return;
        }

        if (button === "{unshift}") {
            setLayoutName("default");
            return;
        }

        if (button === "{more}") {
            setLayoutName("more")
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

        onSendInput(button);
    };

    return (
        <div className="">
            <Keyboard
                layout={{
                    default: [
                        "q w e r t y u i o p",
                        "a s d f g h j k l",
                        "{shift} z x c v b n m {backspace}",
                        "{hide} {more} {space} {enter}",
                    ],
                    shift: [
                        "Q W E R T Y U I O P",
                        "A S D F G H J K L",
                        "{unshift} Z X C V B N M {backspace}",
                        "{hide} {more} {space} {enter}",
                    ],
                    more: [
                        "{arrowLeft} {arrowRight} {arrowUp} {arrowDown} {backspace}",
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
                    "{backspace}": "del",
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
                }}
                theme={"hg-theme-default dark-theme"}
                useTouchEvents={true}
                buttonTheme={[
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
                ]}
            />
        </div>
    );
}