import { useState, useEffect, useRef } from "react";
import { NewTerminal } from "./apps/hosts/ssh/SSHTerminal.jsx";
import { User } from "./apps/user/User.jsx";
import AddHostModal from "./modals/AddHostModal.jsx";
import AuthModal from "./modals/AuthModal.jsx";
import { Button } from "@mui/joy";
import { CssVarsProvider } from "@mui/joy";
import theme from "./theme";
import TabList from "./ui/TabList.jsx";
import Launchpad from "./apps/Launchpad.jsx";
import { Debounce } from './other/Utils.jsx';
import TermixIcon from "./images/termix_icon.png";
import RocketIcon from './images/launchpad_rocket.png';
import ProfileIcon from './images/profile_icon.png';
import ProfileModal from "./modals/ProfileModal.jsx";
import ErrorModal from "./modals/ErrorModal.jsx";
import InfoModal from "./modals/InfoModal.jsx";
import EditHostModal from "./modals/EditHostModal.jsx";
import NoAuthenticationModal from "./modals/NoAuthenticationModal.jsx";
import eventBus from "./other/eventBus.jsx";
import { preloadAllFonts } from './utils/fontLoader';

function App() {
    const [isAddHostHidden, setIsAddHostHidden] = useState(true);
    const [isAuthModalHidden, setIsAuthModalHidden] = useState(true);
    const [isProfileHidden, setIsProfileHidden] = useState(true);
    const [isErrorHidden, setIsErrorHidden] = useState(true);
    const [isInfoHidden, setIsInfoHidden] = useState(true);
    const [infoMessage, setInfoMessage] = useState('');
    const [infoTitle, setInfoTitle] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [terminals, setTerminals] = useState([]);
    const userRef = useRef(null);
    const [activeTab, setActiveTab] = useState(null);
    const [nextId, setNextId] = useState(1);
    const [addHostForm, setAddHostForm] = useState({
        name: "",
        folder: "",
        ip: "",
        user: "",
        password: "",
        sshKey: "",
        port: 22,
        authMethod: "Select Auth",
        rememberHost: true,
        storePassword: true,
        connectionType: "ssh",
        rdpDomain: "",
        rdpWindowsAuthentication: true,
        rdpConsole: false,
        vncScaling: "100%",
        vncQuality: "High"
    });
    const [editHostForm, setEditHostForm] = useState({
        name: "",
        folder: "",
        ip: "",
        user: "",
        password: "",
        sshKey: "",
        port: 22,
        authMethod: "Select Auth",
        rememberHost: true,
        storePassword: true,
    });
    const [isNoAuthHidden, setIsNoAuthHidden] = useState(true);
    const [authForm, setAuthForm] = useState({
        username: '',
        password: '',
        confirmPassword: ''
    });
    const [noAuthenticationForm, setNoAuthenticationForm] = useState({
        authMethod: 'Select Auth',
        password: '',
        sshKey: '',
        keyType: '',
    })
    const [isLaunchpadOpen, setIsLaunchpadOpen] = useState(false);
    const [splitTabIds, setSplitTabIds] = useState([]);
    const [isEditHostHidden, setIsEditHostHidden] = useState(true);
    const [isConfirmDeleteHidden, setIsConfirmDeleteHidden] = useState(true);
    const [currentHostConfig, setCurrentHostConfig] = useState(null);
    const [isLoggingIn, setIsLoggingIn] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [isHostViewerMenuOpen, setIsHostViewerMenuOpen] = useState(null);
    const [isSnippetViewerMenuOpen, setIsSnippetViewerMenuOpen] = useState(null);
    const [hosts, setHosts] = useState([]);
    const [databaseChecked, setDatabaseChecked] = useState(false);

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
        const checkDatabase = async () => {
            if (!databaseChecked && userRef.current) {
                try {
                    const status = await userRef.current.checkAccountCreationStatus();

                    if (status.isFirstUser) {
                        setInfoTitle("Welcome to Termix");
                        setInfoMessage("It appears you're using Termix for the first time or after a database update. Your data has been wiped, you will need to create a new user.");
                        setIsInfoHidden(false);
                    }
                    
                    setDatabaseChecked(true);
                } catch (error) {}
            }
        };
        
        checkDatabase();
    }, [databaseChecked, userRef.current]);

    useEffect(() => {
        const sessionToken = localStorage.getItem('sessionToken');
        let isComponentMounted = true;
        let isLoginInProgress = false;

        if (userRef.current?.getUser()) {
            setIsLoggingIn(false);
            setIsAuthModalHidden(true);
            return;
        }

        if (!sessionToken) {
            setIsLoggingIn(false);
            setIsAuthModalHidden(false);
            return;
        }

        setIsLoggingIn(true);
        let loginAttempts = 0;
        const maxAttempts = 50;
        let attemptLoginInterval;

        const loginTimeout = setTimeout(() => {
            if (isComponentMounted) {
                clearInterval(attemptLoginInterval);
                if (!userRef.current?.getUser()) {
                    localStorage.removeItem('sessionToken');
                    setIsAuthModalHidden(false);
                    setIsLoggingIn(false);
                    setErrorMessage('Login timed out. Please try again.');
                    setIsErrorHidden(false);
                }
            }
        }, 10000);

        const attemptLogin = () => {
            if (!isComponentMounted || isLoginInProgress) return;

            if (loginAttempts >= maxAttempts || userRef.current?.getUser()) {
                clearTimeout(loginTimeout);
                clearInterval(attemptLoginInterval);

                if (!userRef.current?.getUser()) {
                    localStorage.removeItem('sessionToken');
                    setIsAuthModalHidden(false);
                    setIsLoggingIn(false);
                    setErrorMessage('Login timed out. Please try again.');
                    setIsErrorHidden(false);
                }
                return;
            }

            if (userRef.current) {
                isLoginInProgress = true;
                userRef.current.loginUser({
                    sessionToken,
                    onSuccess: () => {
                        if (isComponentMounted) {
                            clearTimeout(loginTimeout);
                            clearInterval(attemptLoginInterval);
                            setIsAuthModalHidden(true);
                            setIsLoggingIn(false);
                            setIsErrorHidden(true);
                        }
                        isLoginInProgress = false;
                    },
                    onFailure: (error) => {
                        if (isComponentMounted) {
                            if (!userRef.current?.getUser()) {
                                clearTimeout(loginTimeout);
                                clearInterval(attemptLoginInterval);
                                localStorage.removeItem('sessionToken');
                                setErrorMessage(`Auto-login failed: ${error}`);
                                setIsErrorHidden(false);
                                setIsAuthModalHidden(false);
                                setIsLoggingIn(false);
                            }
                        }
                        isLoginInProgress = false;
                    },
                });
            }
            loginAttempts++;
        };

        attemptLoginInterval = setInterval(attemptLogin, 100);
        attemptLogin();

        return () => {
            isComponentMounted = false;
            clearTimeout(loginTimeout);
            clearInterval(attemptLoginInterval);
        };
    }, []);

    useEffect(() => {
        const fetchHosts = async () => {
            if (userRef.current?.getUser()) {
                const fetchedHosts = await userRef.current.getAllHosts();
                setHosts(fetchedHosts);
            }
        };
        fetchHosts();
    }, [userRef.current?.getUser()]);

    const handleAddAdmin = async (username) => {
        if (!userRef.current?.isAdmin()) {
            setErrorMessage("You do not have permission to perform this action.");
            setIsErrorHidden(false);
            return false;
        }
        
        try {
            const result = await userRef.current.addAdminUser(username);
            if (!result) {
                throw new Error("Failed to add admin user");
            }
            return true;
        } catch (error) {
            setErrorMessage(`Failed to add admin: ${error.message}`);
            setIsErrorHidden(false);
            return false;
        }
    };

    const handleToggleAccountCreation = async (enabled) => {
        if (!userRef.current?.isAdmin()) {
            setErrorMessage("You do not have permission to perform this action.");
            setIsErrorHidden(false);
            return null;
        }
        
        try {
            const result = await userRef.current.toggleAccountCreation(enabled);
            return result;
        } catch (error) {
            setErrorMessage(`Failed to toggle account creation: ${error.message}`);
            setIsErrorHidden(false);
            return null;
        }
    };

    const checkAccountCreationStatus = async () => {
        if (!userRef.current) return { allowed: true, isFirstUser: false };
        
        try {
            return await userRef.current.checkAccountCreationStatus();
        } catch (error) {
            return { allowed: true, isFirstUser: false };
        }
    };

    const getAllAdmins = async () => {
        if (!userRef.current?.isAdmin()) return [];
        
        try {
            return await userRef.current.getAllAdmins();
        } catch (error) {
            return [];
        }
    };

    const handleAddHost = () => {
        if (addHostForm.ip && addHostForm.port) {
            if (addHostForm.connectionType === 'ssh' && !addHostForm.user) {
                setErrorMessage("Please fill out all required fields (IP, User, Port).");
                setIsErrorHidden(false);
                return;
            }

            if (!addHostForm.rememberHost) {
                connectToHost();
                setIsAddHostHidden(true);
                return;
            }

            if (addHostForm.connectionType === 'ssh') {
                if (addHostForm.authMethod === 'Select Auth') {
                    setErrorMessage("Please select an authentication method.");
                    setIsErrorHidden(false);
                    return;
                }
                if (addHostForm.authMethod === 'password' && !addHostForm.password) {
                    setIsNoAuthHidden(false);
                    return;
                }
                if (addHostForm.authMethod === 'sshKey' && !addHostForm.sshKey) {
                    setIsNoAuthHidden(false);
                    return;
                }
            }
            else if (!addHostForm.password) {
                setIsNoAuthHidden(false);
                return;
            }

            try {
                connectToHost();
                if (!addHostForm.storePassword) {
                    addHostForm.password = '';
                }
                handleSaveHost();
                setIsAddHostHidden(true);
            } catch (error) {
                setErrorMessage(error.message || "Failed to add host");
                setIsErrorHidden(false);
            }
        } else {
            setErrorMessage("Please fill out all required fields.");
            setIsErrorHidden(false);
        }
    };

    const connectToHost = () => {
        if (!addHostForm.ip || !addHostForm.user) {
            return;
        }

        let baseTitle = addHostForm.name || addHostForm.ip;
        let newTitle = baseTitle;

        const existingTitles = terminals.filter(terminal => 
            terminal.title === baseTitle || terminal.title.startsWith(`${baseTitle} (`)
        );

        if (existingTitles.length > 0) {
            newTitle = `${baseTitle} (${existingTitles.length})`;
        }

        const nextId = Math.floor(Math.random() * 10000);
        const hostConfig = {
            name: addHostForm.name,
            folder: addHostForm.folder,
            ip: addHostForm.ip,
            user: addHostForm.user,
            port: String(addHostForm.port),
            password: addHostForm.rememberHost && addHostForm.authMethod === 'password' ? addHostForm.password : undefined,
            sshKey: addHostForm.rememberHost && addHostForm.authMethod === 'sshKey' ? addHostForm.sshKey : undefined,
            terminalConfig: addHostForm.terminalConfig || {
                theme: 'dark',
                cursorStyle: 'block',
                fontFamily: 'ubuntuMono',
                fontSize: 14,
                fontWeight: 'normal',
                lineHeight: 1,
                letterSpacing: 0,
                cursorBlink: true,
                sshAlgorithm: 'default'
            }
        };

        const newTerminal = {
            id: nextId,
            title: newTitle,
            hostConfig,
            terminalRef: null,
        };
        setTerminals([...terminals, newTerminal]);
        setActiveTab(nextId);
        setNextId(nextId + 1);
        setIsAddHostHidden(true);
        setAddHostForm({ name: "", folder: "", ip: "", user: "", password: "", sshKey: "", port: 22, authMethod: "Select Auth", rememberHost: true, storePassword: true, connectionType: "ssh", rdpDomain: "", rdpWindowsAuthentication: true, rdpConsole: false, vncScaling: "100%", vncQuality: "High" });
    }

    const handleAuthSubmit = (form) => {
        try {
            setIsNoAuthHidden(true);

            setTimeout(() => {
                const updatedTerminals = terminals.map((terminal) => {
                    if (terminal.id === activeTab) {
                        return {
                            ...terminal,
                            hostConfig: {
                                ...terminal.hostConfig,
                                password: form.authMethod === 'password' ? form.password : undefined,
                                sshKey: form.authMethod === 'sshKey' ? form.sshKey : undefined
                            }
                        };
                    }
                    return terminal;
                });
                
                setTerminals(updatedTerminals);

                setNoAuthenticationForm({
                    authMethod: 'Select Auth',
                    password: '',
                    sshKey: '',
                    keyType: '',
                });
            }, 100);
        } catch (error) {
            setErrorMessage("Failed to authenticate: " + (error.message || "Unknown error"));
            setIsErrorHidden(false);
        }
    };

    const connectToHostWithConfig = (hostConfig) => {
        if (!hostConfig || typeof hostConfig !== 'object') {
            return;
        }

        if (!hostConfig.ip || !hostConfig.user) {
            return;
        }

        let baseTitle = hostConfig.name || hostConfig.ip;
        let newTitle = baseTitle;

        const existingTitles = terminals.filter(terminal => 
            terminal.title === baseTitle || terminal.title.startsWith(`${baseTitle} (`)
        );

        if (existingTitles.length > 0) {
            newTitle = `${baseTitle} (${existingTitles.length})`;
        }

        const cleanHostConfig = {
            name: hostConfig.name || '',
            folder: hostConfig.folder || '',
            ip: hostConfig.ip.trim(),
            user: hostConfig.user.trim(),
            port: hostConfig.port || '22',
            password: hostConfig.password?.trim(),
            sshKey: hostConfig.sshKey?.trim(),
            terminalConfig: hostConfig.terminalConfig || {
                theme: 'dark',
                cursorStyle: 'block',
                fontFamily: 'ubuntuMono',
                fontSize: 14,
                fontWeight: 'normal',
                lineHeight: 1,
                letterSpacing: 0,
                cursorBlink: true,
                sshAlgorithm: 'default'
            }
        };

        const newTerminal = {
            id: nextId,
            title: newTitle,
            hostConfig: cleanHostConfig,
            terminalRef: null,
        };
        setTerminals([...terminals, newTerminal]);
        setActiveTab(nextId);
        setNextId(nextId + 1);
        setIsLaunchpadOpen(false);
    }

    const handleSaveHost = async () => {
        try {
            await userRef.current.saveHost({
                hostConfig: {
                    name: addHostForm.name,
                    folder: addHostForm.folder,
                    ip: addHostForm.ip,
                    user: addHostForm.user,
                    port: addHostForm.port,
                    password: addHostForm.storePassword ? addHostForm.password : "",
                    sshKey: addHostForm.storePassword ? addHostForm.sshKey : "",
                    keyType: addHostForm.keyType,
                    isPinned: addHostForm.isPinned,
                    tags: addHostForm.tags || [],
                    terminalConfig: addHostForm.terminalConfig
                }
            });
            setIsAddHostHidden(true);
            return true;
        } catch (err) {
            setErrorMessage(err.toString());
            setIsErrorHidden(false);
            return false;
        }
    };

    const handleLoginUser = ({ username, password, sessionToken, onSuccess, onFailure }) => {
        if (userRef.current) {
            if (sessionToken) {
                userRef.current.loginUser({
                    sessionToken,
                    onSuccess: () => {
                        setIsAuthModalHidden(true);
                        setIsLoggingIn(false);
                        if (onSuccess) onSuccess();
                    },
                    onFailure: (error) => {
                        localStorage.removeItem('sessionToken');
                        setIsAuthModalHidden(false);
                        setIsLoggingIn(false);
                        if (onFailure) onFailure(error);
                    },
                });
            } else {
                userRef.current.loginUser({
                    username,
                    password,
                    onSuccess: () => {
                        setIsAuthModalHidden(true);
                        setIsLoggingIn(false);
                        if (onSuccess) onSuccess();
                    },
                    onFailure: (error) => {
                        setIsAuthModalHidden(false);
                        setIsLoggingIn(false);
                        if (onFailure) onFailure(error);
                    },
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
    };

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
        }
    };

    const handleEditHost = async (oldConfig, newConfig = null) => {
        try {
            if (!oldConfig) {
                return false;
            }

            if (!newConfig) {
                updateEditHostForm(oldConfig);
                setIsEditHostHidden(false);
                return true;
            }

            if (!newConfig.tags && oldConfig.tags) {
                newConfig.tags = oldConfig.tags;
            }

            if (!oldConfig._id && newConfig._id) {
                oldConfig._id = newConfig._id;
            }

            await new Promise(resolve => setTimeout(resolve, 300));

            setIsEditing(true);

            await userRef.current.editHost({
                oldHostConfig: oldConfig,
                newHostConfig: newConfig
            });

            await new Promise(resolve => setTimeout(resolve, 1000));

            setIsEditHostHidden(true);

            await new Promise(resolve => setTimeout(resolve, 2000));

            setIsEditing(false);

            return true;
        } catch (err) {
            setErrorMessage(err.toString());
            setIsErrorHidden(false);
            setIsEditing(false);
            return false;
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

    const getTerminalBackgroundColor = (hostConfig) => {
        const terminalThemeMap = {
            'dark': '#1e1e1e',
            'light': '#ffffff',
            'red': '#550000',
            'green': '#0B3B0B',
            'blue': '#001B33',
            'purple': '#2D1B4E',
            'orange': '#421F04',
            'cyan': '#003833',
            'yellow': '#3B3B00',
            'pink': '#3B001B'
        };

        const themeName = hostConfig?.terminalConfig?.theme || 'dark';

        return terminalThemeMap[themeName] || terminalThemeMap.dark;
    };

    useEffect(() => {
        preloadAllFonts();
    }, []);

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

                        {/* Action Buttons */}
                        <div className="flex gap-4">
                            {/* Launchpad Button */}
                            <Button
                                disabled={isLoggingIn || !userRef.current?.getUser()}
                                onClick={() => setIsLaunchpadOpen(true)}
                                sx={{
                                    backgroundColor: theme.palette.general.tertiary,
                                    "&:hover": { backgroundColor: theme.palette.general.secondary },
                                    flexShrink: 0,
                                    height: "52px",
                                    width: "52px",
                                    padding: 0,
                                    opacity: (!userRef.current?.getUser() || isLoggingIn) ? 0.3 : 1,
                                    cursor: (!userRef.current?.getUser() || isLoggingIn) ? 'not-allowed' : 'pointer',
                                    "&:disabled": {
                                        opacity: 0.3,
                                        backgroundColor: theme.palette.general.tertiary,
                                    }
                                }}
                            >
                                <img src={RocketIcon} alt="Launchpad" style={{ width: "70%", height: "70%", objectFit: "contain" }} />
                            </Button>

                            {/* Add Host Button */}
                            <Button
                                disabled={isLoggingIn || !userRef.current?.getUser()}
                                onClick={() => setIsAddHostHidden(false)}
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
                                    opacity: (!userRef.current?.getUser() || isLoggingIn) ? 0.3 : 1,
                                    cursor: (!userRef.current?.getUser() || isLoggingIn) ? 'not-allowed' : 'pointer',
                                    "&:disabled": {
                                        opacity: 0.3,
                                        backgroundColor: theme.palette.general.tertiary,
                                    },
                                    fontSize: "4rem",
                                    fontWeight: "600",
                                    lineHeight: "0",
                                    paddingBottom: "8px",
                                }}
                            >
                                +
                            </Button>

                            {/* Profile Button */}
                            <Button
                                disabled={isLoggingIn}
                                onClick={() => userRef.current?.getUser() ? setIsProfileHidden(false) : setIsAuthModalHidden(false)}
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
                                    opacity: isLoggingIn ? 0.3 : 1,
                                    cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                                    "&:disabled": {
                                        opacity: 0.3,
                                        backgroundColor: theme.palette.general.tertiary,
                                    }
                                }}
                            >
                                <img
                                    src={ProfileIcon}
                                    alt="Profile"
                                    style={{ width: "70%", height: "70%", objectFit: "contain" }}
                                />
                            </Button>
                        </div>
                    </div>

                    {/* Terminal Views */}
                    {userRef.current?.getUser() ? (
                        <div className={`relative p-4 terminal-container ${getLayoutStyle()}`}>
                            {terminals.map((terminal) => (
                                <div
                                    key={terminal.id}
                                    className={`rounded-lg overflow-hidden shadow-xl ${
                                        splitTabIds.includes(terminal.id) || activeTab === terminal.id ? "block" : "hidden"
                                    } flex-1`}
                                    style={{
                                        order: splitTabIds.includes(terminal.id)
                                            ? splitTabIds.indexOf(terminal.id)
                                            : 0,
                                        backgroundColor: getTerminalBackgroundColor(terminal.hostConfig)
                                    }}
                                >
                                    <NewTerminal
                                        key={terminal.id}
                                        hostConfig={terminal.hostConfig}
                                        isVisible={activeTab === terminal.id || splitTabIds.includes(terminal.id)}
                                        setIsNoAuthHidden={setIsNoAuthHidden}
                                        setErrorMessage={setErrorMessage}
                                        setIsErrorHidden={setIsErrorHidden}
                                        title={terminal.title}
                                        showTitle={splitTabIds.length > 0}
                                        ref={(ref) => {
                                            terminal.terminalRef = ref;
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full w-full">
                            <div className="text-center text-neutral-400">
                                <h2 className="text-2xl font-bold mb-4">Welcome to Termix</h2>
                                <p>{isLoggingIn ? "Checking login status..." : "Please login to start managing your SSH connections"}</p>
                            </div>
                        </div>
                    )}

                    <NoAuthenticationModal
                        isHidden={isNoAuthHidden}
                        form={noAuthenticationForm}
                        setForm={setNoAuthenticationForm}
                        setIsNoAuthHidden={setIsNoAuthHidden}
                        handleAuthSubmit={handleAuthSubmit}
                    />

                    {/* Modals */}
                    {userRef.current?.getUser() && (
                        <>
                            <AddHostModal
                                isHidden={isAddHostHidden}
                                form={addHostForm}
                                setForm={setAddHostForm}
                                handleAddHost={handleAddHost}
                                setIsAddHostHidden={setIsAddHostHidden}
                                hosts={hosts}
                            />
                            <EditHostModal
                                isHidden={isEditHostHidden}
                                form={editHostForm}
                                setForm={setEditHostForm}
                                handleEditHost={handleEditHost}
                                setIsEditHostHidden={setIsEditHostHidden}
                                hostConfig={currentHostConfig}
                            />
                            <ProfileModal
                                isHidden={isProfileHidden}
                                getUser={getUser}
                                handleDeleteUser={handleDeleteUser}
                                handleLogoutUser={handleLogoutUser}
                                setIsProfileHidden={setIsProfileHidden}
                                handleAddAdmin={handleAddAdmin}
                                handleToggleAccountCreation={handleToggleAccountCreation}
                                checkAccountCreationStatus={checkAccountCreationStatus}
                                getAllAdmins={getAllAdmins}
                            />
                            {isLaunchpadOpen && (
                                <Launchpad
                                    onClose={() => setIsLaunchpadOpen(false)}
                                    getHosts={getHosts}
                                    getSnippets={() => userRef.current?.getAllSnippets()}
                                    connectToHost={connectToHostWithConfig}
                                    isAddHostHidden={isAddHostHidden}
                                    setIsAddHostHidden={setIsAddHostHidden}
                                    isEditHostHidden={isEditHostHidden}
                                    isErrorHidden={isErrorHidden}
                                    isConfirmDeleteHidden={isConfirmDeleteHidden}
                                    setIsConfirmDeleteHidden={setIsConfirmDeleteHidden}
                                    deleteHost={deleteHost}
                                    editHost={handleEditHost}
                                    shareHost={(hostId, username) => userRef.current?.shareHost(hostId, username)}
                                    userRef={userRef}
                                    isHostViewerMenuOpen={isHostViewerMenuOpen}
                                    setIsHostViewerMenuOpen={setIsHostViewerMenuOpen}
                                    isSnippetViewerMenuOpen={isSnippetViewerMenuOpen}
                                    setIsSnippetViewerMenuOpen={setIsSnippetViewerMenuOpen}
                                    terminals={terminals}
                                    activeTab={activeTab}
                                />
                            )}
                        </>
                    )}

                    <ErrorModal
                        isHidden={isErrorHidden}
                        errorMessage={errorMessage}
                        setIsErrorHidden={setIsErrorHidden}
                    />

                    <InfoModal
                        isHidden={isInfoHidden}
                        infoMessage={infoMessage}
                        title={infoTitle}
                        setIsInfoHidden={setIsInfoHidden}
                    />

                    <AuthModal
                        isHidden={isAuthModalHidden}
                        form={authForm}
                        setForm={setAuthForm}
                        handleLoginUser={handleLoginUser}
                        handleCreateUser={handleCreateUser}
                        handleGuestLogin={handleGuestLogin}
                        setIsAuthModalHidden={setIsAuthModalHidden}
                        checkAccountCreationStatus={checkAccountCreationStatus}
                    />

                    {/* User component */}
                    <User
                        ref={userRef}
                        onLoginSuccess={() => {
                            setIsAuthModalHidden(true);
                            setIsLoggingIn(false);
                            setIsErrorHidden(true);
                        }}
                        onCreateSuccess={() => {
                            setIsAuthModalHidden(true);
                            handleLoginUser({
                                username: authForm.username,
                                password: authForm.password,
                                onSuccess: () => {
                                    setIsAuthModalHidden(true);
                                    setIsLoggingIn(false);
                                    setIsErrorHidden(true);
                                },
                                onFailure: (error) => {
                                    setErrorMessage(`Login failed: ${error}`);
                                    setIsErrorHidden(false);
                                }
                            });
                        }}
                        onDeleteSuccess={() => {
                            setIsProfileHidden(true);
                            window.location.reload();
                        }}
                        onFailure={(error) => {
                            setErrorMessage(`Action failed: ${error}`);
                            setIsErrorHidden(false);
                            setIsLoggingIn(false);
                            eventBus.emit('failedLoginUser');
                        }}
                    />
                </div>
            </div>
        </CssVarsProvider>
    );
}

export default App;