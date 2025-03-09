import { useState, useEffect } from "react";
import { NewTerminal } from "./Terminal.jsx";
import AddHostModal from "./AddHostModal.jsx";
import { Button } from "@mui/joy";
import { CssVarsProvider } from "@mui/joy";
import theme from "./theme";
import TabList from "./TabList.jsx";
import Launchpad from "./Launchpad.jsx";
import { Debounce } from './Utils';
import TermixIcon from "./images/termix_icon.png";
import RocketIcon from './images/launchpad_rocket.png';

function App() {
    const [isAddHostHidden, setIsAddHostHidden] = useState(true);
    const [terminals, setTerminals] = useState([]);
    const [activeTab, setActiveTab] = useState(null);
    const [nextId, setNextId] = useState(1);
    const [form, setForm] = useState({
        name: "",
        ip: "",
        user: "",
        password: "",
        port: 22,
        authMethod: "Select Auth",
    });
    const [isLaunchpadOpen, setIsLaunchpadOpen] = useState(false);
    const [splitTabIds, setSplitTabIds] = useState([]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.ctrlKey && e.key === "l") {
                e.preventDefault();
                setIsLaunchpadOpen((prev) => !prev);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    useEffect(() => {
        terminals.forEach((terminal) => {
            if (
                (terminal.id === activeTab || splitTabIds.includes(terminal.id)) &&
                terminal.terminalRef?.resizeTerminal
            ) {
                terminal.terminalRef.resizeTerminal();
            }
        });
    }, [splitTabIds, activeTab, terminals]);

    useEffect(() => {
        const handleResize = Debounce(() => {
            terminals.forEach((terminal) => {
                if (
                    (terminal.id === activeTab || splitTabIds.includes(terminal.id)) &&
                    terminal.terminalRef?.resizeTerminal
                ) {
                    terminal.terminalRef.resizeTerminal();
                }
            });
        }, 100);

        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, [splitTabIds, activeTab, terminals]);

    useEffect(() => {
        terminals.forEach((terminal) => {
            if (
                (terminal.id === activeTab || splitTabIds.includes(terminal.id)) &&
                terminal.terminalRef?.resizeTerminal
            ) {
                terminal.terminalRef.resizeTerminal();
            }
        });
    }, [splitTabIds]);

    const handleAddHost = () => {
        if (form.ip && form.user && ((form.authMethod === 'password' && form.password) || (form.authMethod === 'rsaKey' && form.rsaKey)) && form.port) {
            const newTerminal = {
                id: nextId,
                title: form.name || form.ip,
                hostConfig: {
                    ip: form.ip,
                    user: form.user,
                    password: form.authMethod === 'password' ? form.password : undefined,
                    rsaKey: form.authMethod === 'rsaKey' ? form.rsaKey : undefined,
                    port: String(form.port),
                },
                terminalRef: null,
            };
            setTerminals([...terminals, newTerminal]);
            setActiveTab(nextId);
            setNextId(nextId + 1);
            setIsAddHostHidden(true);
            setForm({ name: "", ip: "", user: "", password: "", rsaKey: "", port: 22, authMethod: "Select Auth" });
        } else {
            alert("Please fill out all fields.");
        }
    };

    const closeTab = (id) => {
        const newTerminals = terminals.filter((t) => t.id !== id);
        setTerminals(newTerminals);
        if (activeTab === id) {
            setActiveTab(newTerminals[0]?.id || null);
        }
    };

    const toggleSplit = (id) => {
        if (splitTabIds.includes(id)) {
            setSplitTabIds((prev) => prev.filter((splitId) => splitId !== id));
            return;
        }

        if (splitTabIds.length >= 3) return;

        setSplitTabIds((prev) =>
            prev.includes(id) ? prev.filter((splitId) => splitId !== id) : [...prev, id]
        );
    };

    const handleSetActiveTab = (tabId) => {
        setActiveTab(tabId);
    };

    const getLayoutStyle = () => {
        if (splitTabIds.length === 1) {
            return "grid grid-cols-2 h-full gap-4";
        } else if (splitTabIds.length > 1) {
            return "grid grid-cols-2 grid-rows-2 gap-4 h-full overflow-hidden";
        }
        return "flex flex-col h-full gap-4";
    };

    return (
        <CssVarsProvider theme={theme}>
            <div className="flex h-screen bg-neutral-900 overflow-hidden">
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Topbar */}
                    <div className="bg-neutral-800 text-white p-4 flex items-center justify-between gap-4 min-h-[75px] max-h-[75px] shadow-xl border-b-5 border-neutral-700">
                        <div className="bg-neutral-700 flex justify-center items-center gap-1 p-2 rounded-lg h-[52px]">
                            <img src={TermixIcon} alt="Termix Icon" className="w-[25px] h-[25px] object-contain" />
                            <h2 className="text-lg font-bold">Termix</h2>
                        </div>

                        <div className="flex-1 bg-neutral-700 rounded-lg overflow-hidden h-[52px] flex items-center">
                            <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-neutral-500 scrollbar-track-neutral-700 h-[52px] scrollbar-thumb-rounded-full scrollbar-track-rounded-full scrollbar-h-1">
                                <TabList
                                    terminals={terminals}
                                    activeTab={activeTab}
                                    setActiveTab={handleSetActiveTab}
                                    closeTab={closeTab}
                                    toggleSplit={toggleSplit}
                                    splitTabIds={splitTabIds}
                                    theme={theme}
                                />
                            </div>
                        </div>

                        {/* Launchpad Button */}
                        <Button
                            onClick={() => setIsLaunchpadOpen(true)}
                            sx={{
                                backgroundColor: theme.palette.general.tertiary,
                                "&:hover": { backgroundColor: theme.palette.general.secondary },
                                flexShrink: 0,
                                height: "52px",
                                width: "52px",
                                padding: 0,
                            }}
                        >
                            <img src={RocketIcon} alt="Launchpad" style={{ width: "70%", height: "70", objectFit: "contain" }} />
                        </Button>

                        {/* Add Host Button */}
                        <Button
                            onClick={() => setIsAddHostHidden(false)}
                            sx={{
                                backgroundColor: theme.palette.general.tertiary,
                                "&:hover": { backgroundColor: theme.palette.general.secondary },
                                flexShrink: 0,
                                height: "52px",
                                width: "52px",
                                fontSize: "3.5rem",
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                paddingTop: "2px",
                            }}
                        >
                            +
                        </Button>
                    </div>

                    {/* Terminal Views */}
                    <div className={`relative p-4 terminal-container ${getLayoutStyle()}`}>
                        {terminals.map((terminal) => (
                            <div
                                key={terminal.id}
                                className={`bg-neutral-800 rounded-lg overflow-hidden shadow-xl border-5 border-neutral-700 ${
                                    splitTabIds.includes(terminal.id) || activeTab === terminal.id ? "block" : "hidden"
                                } flex-1`}
                                style={{
                                    order: splitTabIds.includes(terminal.id)
                                        ? splitTabIds.indexOf(terminal.id) + 1
                                        : activeTab === terminal.id
                                            ? 0
                                            : undefined
                                }}
                            >
                                <NewTerminal
                                    key={terminal.id}
                                    hostConfig={terminal.hostConfig}
                                    isVisible={activeTab === terminal.id || splitTabIds.includes(terminal.id)}
                                    ref={(ref) => {
                                        if (ref && !terminal.terminalRef) {
                                            setTerminals((prev) =>
                                                prev.map((t) =>
                                                    t.id === terminal.id ? { ...t, terminalRef: ref } : t
                                                )
                                            );
                                        }
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Modals */}
                <AddHostModal
                    isHidden={isAddHostHidden}
                    form={form}
                    setForm={setForm}
                    handleAddHost={handleAddHost}
                    setIsAddHostHidden={setIsAddHostHidden}
                />
                {isLaunchpadOpen && <Launchpad onClose={() => setIsLaunchpadOpen(false)} />}
            </div>
        </CssVarsProvider>
    );
}

export default App;