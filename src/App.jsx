import { useState, useEffect, useRef } from "react";
import { NewTerminal } from "./apps/ssh/Terminal.jsx";
import { User } from "./apps/user/User.jsx";
import AddHostModal from "./modals/AddHostModal.jsx";
import LoginUserModal from "./modals/LoginUserModal.jsx";
import { Button } from "@mui/joy";
import { CssVarsProvider } from "@mui/joy";
import theme from "./theme";
import TabList from "./ui/TabList.jsx";
import Launchpad from "./apps/Launchpad.jsx";
import { Debounce } from './other/Utils.jsx';
import TermixIcon from "./images/termix_icon.png";
import RocketIcon from './images/launchpad_rocket.png';
import ProfileIcon from './images/profile_icon.png';
import CreateUserModal from "./modals/CreateUserModal.jsx";
import ProfileModal from "./modals/ProfileModal.jsx";
import ErrorModal from "./modals/ErrorModal.jsx";
import EditHostModal from "./modals/EditHostModal.jsx";
import NoAuthenticationModal from "./modals/NoAuthenticationModal.jsx";

function App() {
    const [isAddHostHidden, setIsAddHostHidden] = useState(true);
    const [isLoginUserHidden, setIsLoginUserHidden] = useState(true);
    const [isCreateUserHidden, setIsCreateUserHidden] = useState(true);
    const [isProfileHidden, setIsProfileHidden] = useState(true);
    const [isErrorHidden, setIsErrorHidden] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [terminals, setTerminals] = useState([]);
    const userRef = useRef(null);
    const [activeTab, setActiveTab] = useState(null);
    const [nextId, setNextId] = useState(1);
    const [addHostForm, setAddHostForm] = useState({
        name: "",
        ip: "",
        user: "",
        password: "",
        port: 22,
        authMethod: "Select Auth",
        rememberHost: false,
        storePassword: true,
    });
    const [editHostForm, setEditHostForm] = useState({
        name: "",
        ip: "",
        user: "",
        password: "",
        port: 22,
        authMethod: "Select Auth",
        rememberHost: true,
        storePassword: true,
    });
    const [isNoAuthHidden, setIsNoAuthHidden] = useState(true);
    const [authForm, setAuthForm] = useState({
        password: "",
        rsaKey: "",
    });
    const [loginUserForm, setLoginUserForm] = useState({
        username: "",
        password: "",
    });
    const [createUserForm, setCreateUserForm] = useState({
        username: "",
        password: "",
    });
    const [isLaunchpadOpen, setIsLaunchpadOpen] = useState(false);
    const [splitTabIds, setSplitTabIds] = useState([]);
    const [isEditHostHidden, setIsEditHostHidden] = useState(true);
    const [currentHostConfig, setCurrentHostConfig] = useState(null);

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

    useEffect(() => {
        const sessionToken = localStorage.getItem('sessionToken');
        if (sessionToken) {
            setTimeout(() => {
                handleLoginUser({
                    sessionToken,
                    onSuccess: () => {
                        setIsLoginUserHidden(true);
                    },
                    onFailure: (error) => {
                        setErrorMessage(`Auto-login failed: ${error}`);
                        setIsErrorHidden(false);
                        setIsLoginUserHidden(false);
                    },
                });
            }, 500);
        } else {
            setIsLoginUserHidden(false);
        }
    }, []);

    const handleAddHost = () => {
        if (addHostForm.ip && addHostForm.user && addHostForm.port && addHostForm.authMethod !== 'Select Auth') {
            if (addHostForm.authMethod === 'password' && !addHostForm.password) {
                setIsNoAuthHidden(false);
            } else if (addHostForm.authMethod === 'rsaKey' && !addHostForm.rsaKey) {
                setIsNoAuthHidden(false);
            } else {
                connectToHost();
                if (addHostForm.rememberHost) {
                    if (!addHostForm.storePassword) {
                        addHostForm.password = '';
                    }
                    handleSaveHost();
                }
            }
        } else {
            alert("Please fill out all fields.");
        }
    };

    const connectToHost = () => {
        const newTerminal = {
            id: nextId,
            title: addHostForm.name || addHostForm.ip,
            hostConfig: {
                ip: addHostForm.ip,
                user: addHostForm.user,
                password: addHostForm.authMethod === 'password' ? addHostForm.password : undefined,
                rsaKey: addHostForm.authMethod === 'rsaKey' ? addHostForm.rsaKey : undefined,
                port: String(addHostForm.port),
            },
            terminalRef: null,
        };
        setTerminals([...terminals, newTerminal]);
        setActiveTab(nextId);
        setNextId(nextId + 1);
        setIsAddHostHidden(true);
        setAddHostForm({ name: "", ip: "", user: "", password: "", rsaKey: "", port: 22, authMethod: "Select Auth" });
    }

    const handleAuthSubmit = (form) => {
        const updatedTerminals = terminals.map((terminal) => {
            if (terminal.id === activeTab) {
                return {
                    ...terminal,
                    hostConfig: {
                        ...terminal.hostConfig,
                        password: form.password,
                        rsaKey: form.rsaKey
                    }
                };
            }
            return terminal;
        });
        setTerminals(updatedTerminals);
        setIsNoAuthHidden(true);
    };

    const connectToHostWithConfig = (hostConfig) => {
        const newTerminal = {
            id: nextId,
            title: hostConfig.name || hostConfig.ip,
            hostConfig: hostConfig,
            terminalRef: null,
        };
        setTerminals([...terminals, newTerminal]);
        setActiveTab(nextId);
        setNextId(nextId + 1);
        setIsLaunchpadOpen(false);
    }

    const handleSaveHost = () => {
        let hostConfig = {
            name: addHostForm.name || addHostForm.ip,
            ip: addHostForm.ip,
            user: addHostForm.user,
            password: addHostForm.authMethod === 'password' ? addHostForm.password : undefined,
            rsaKey: addHostForm.authMethod === 'rsaKey' ? addHostForm.rsaKey : undefined,
            port: String(addHostForm.port),
        }
        if (userRef.current) {
            userRef.current.saveHost({
                hostConfig,
            });
        }
    }

    const handleLoginUser = ({ username, password, sessionToken, onSuccess, onFailure }) => {
        if (userRef.current) {
            if (sessionToken) {
                userRef.current.loginUser({
                    sessionToken,
                    onSuccess,
                    onFailure,
                });
            } else {
                userRef.current.loginUser({
                    username,
                    password,
                    onSuccess,
                    onFailure,
                });
            }
        }
    };

    const handleGuestLogin = () => {
        if (userRef.current) {
            userRef.current.loginAsGuest();
        }
    }

    const handleCreateUser = ({ username, password, onSuccess, onFailure }) => {
        if (userRef.current) {
            userRef.current.createUser({
                username,
                password,
                onSuccess,
                onFailure,
            });
        }
    }

    const handleDeleteUser = ({ onSuccess, onFailure }) => {
        if (userRef.current) {
            userRef.current.deleteUser({
                onSuccess,
                onFailure,
            });
        }
    };

    const handleLogoutUser = () => {
        if (userRef.current) {
            userRef.current.logoutUser();
            window.location.reload();
        }
    };

    const getUser = () => {
        if (userRef.current) {
            return userRef.current.getUser();
        }
    }

    const getHosts = () => {
        if (userRef.current) {
            return userRef.current.getAllHosts();
        }
    }

    const deleteHost = (hostConfig) => {
        if (userRef.current) {
            userRef.current.deleteHost({
                hostId: hostConfig._id,
            });
        }
    };

    const updateEditHostForm = (hostConfig) => {
        if (hostConfig) {
            setCurrentHostConfig(hostConfig);
            setIsEditHostHidden(false);
        } else {
            console.error("hostConfig is null");
        }
    };

    const handleEditHost = async () => {
        try {
            // Only clear the password if switching to RSA or storePassword is false
            if (editHostForm.authMethod === 'rsaKey') {
                editHostForm.password = '';
            } else if (!editHostForm.storePassword) {
                editHostForm.password = '';
            }

            await userRef.current.editHost({
                oldHostConfig: currentHostConfig,
                newHostConfig: editHostForm,
            });

            // Refresh the updated config
            const refreshedHosts = await userRef.current.getAllHosts();
            const updated = refreshedHosts.find(
                (h) => h.config.ip === editHostForm.ip && h.config.user === editHostForm.user
            );
            if (updated) {
                setCurrentHostConfig(updated.config);
            }
            setIsEditHostHidden(true);
        } catch (error) {
            alert('Edit failed: ' + error);
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

                        {/* Profile Button */}
                        <Button
                            onClick={() => setIsProfileHidden(false)}
                            sx={{
                                backgroundColor: theme.palette.general.tertiary,
                                "&:hover": { backgroundColor: theme.palette.general.secondary },
                                flexShrink: 0,
                                height: "52px",
                                width: "52px",
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                padding: 0,
                            }}
                        >
                            <img
                                src={ProfileIcon}
                                alt="Profile"
                                style={{ width: "70%", height: "70%", objectFit: "contain" }}
                            />
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
                                        ? splitTabIds.indexOf(terminal.id)
                                        : 0,
                                }}
                            >
                                <NewTerminal
                                    key={terminal.id}
                                    hostConfig={terminal.hostConfig}
                                    isVisible={activeTab === terminal.id || splitTabIds.includes(terminal.id)}
                                    setIsNoAuthHidden={setIsNoAuthHidden}
                                    ref={(ref) => {
                                        terminal.terminalRef = ref;
                                    }}
                                />
                            </div>
                        ))}
                        <NoAuthenticationModal
                            isHidden={isNoAuthHidden}
                            form={authForm}
                            setForm={setAuthForm}
                            setIsNoAuthHidden={setIsNoAuthHidden}
                            handleAuthSubmit={handleAuthSubmit}
                        />
                    </div>
                </div>

                {/* Modals */}
                <AddHostModal
                    isHidden={isAddHostHidden}
                    form={addHostForm}
                    setForm={setAddHostForm}
                    handleAddHost={handleAddHost}
                    setIsAddHostHidden={setIsAddHostHidden}
                />
                <EditHostModal
                    isHidden={isEditHostHidden}
                    form={editHostForm}
                    setForm={setEditHostForm}
                    handleEditHost={handleEditHost}
                    setIsEditHostHidden={setIsEditHostHidden}
                    hostConfig={currentHostConfig}
                />
                <CreateUserModal
                    isHidden={isCreateUserHidden}
                    form={createUserForm}
                    setForm={setCreateUserForm}
                    handleCreateUser={handleCreateUser}
                    setIsCreateUserHidden={setIsCreateUserHidden}
                    setIsLoginUserHidden={setIsLoginUserHidden}
                />
                <ProfileModal
                    isHidden={isProfileHidden}
                    getUser={getUser}
                    handleDeleteUser={handleDeleteUser}
                    handleLogoutUser={handleLogoutUser}
                    setIsProfileHidden={setIsProfileHidden}
                />
                <ErrorModal
                    isHidden={isErrorHidden}
                    errorMessage={errorMessage}
                    setIsErrorHidden={setIsErrorHidden}
                />
                {isLaunchpadOpen && (
                    <Launchpad
                        onClose={() => setIsLaunchpadOpen(false)}
                        getHosts={getHosts}
                        connectToHost={connectToHostWithConfig}
                        isAddHostHidden={isAddHostHidden}
                        setIsAddHostHidden={setIsAddHostHidden}
                        isEditHostHidden={isEditHostHidden}
                        isErrorHidden={isErrorHidden}
                        deleteHost={deleteHost}
                        editHost={updateEditHostForm}
                    />
                )}

                <LoginUserModal
                    isHidden={isLoginUserHidden}
                    form={loginUserForm}
                    setForm={setLoginUserForm}
                    handleLoginUser={handleLoginUser}
                    handleGuestLogin={handleGuestLogin}
                    setIsLoginUserHidden={setIsLoginUserHidden}
                    setIsCreateUserHidden={setIsCreateUserHidden}
                />

                {/* User component */}
                <User
                    ref={userRef}
                    onLoginSuccess={() => setIsLoginUserHidden(true)}
                    onCreateSuccess={() => {
                        setIsCreateUserHidden(true);
                        handleLoginUser({ username: createUserForm.username, password: createUserForm.password })}
                    }
                    onDeleteSuccess={() => {
                        setIsProfileHidden(true);
                        window.location.reload();
                    }}
                    onFailure={(error) => {
                        setErrorMessage(`Action failed: ${error}`);
                        setIsErrorHidden(false);
                    }}
                />
            </div>
        </CssVarsProvider>
    );
}

export default App;