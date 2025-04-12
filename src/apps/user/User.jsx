import { useRef, forwardRef, useImperativeHandle, useEffect } from "react";
import io from "socket.io-client";
import PropTypes from "prop-types";

const SOCKET_URL = window.location.hostname === "localhost"
    ? "http://localhost:8081/database.io"
    : "/database.io";

const socket = io(SOCKET_URL, {
    path: "/database.io/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: false,
});

export const User = forwardRef(({ onLoginSuccess, onCreateSuccess, onDeleteSuccess, onFailure }, ref) => {
    const socketRef = useRef(socket);
    const currentUser = useRef(null);

    useEffect(() => {
        socketRef.current.connect();
        return () => socketRef.current.disconnect();
    }, []);

    useEffect(() => {
        const verifySession = async () => {
            const storedSession = localStorage.getItem("sessionToken");
            if (!storedSession || storedSession === "undefined") return;

            try {
                const response = await new Promise((resolve) => {
                    socketRef.current.emit("verifySession", { sessionToken: storedSession }, resolve);
                });

                if (response?.success) {
                    currentUser.current = {
                        id: response.user.id,
                        username: response.user.username,
                        sessionToken: storedSession,
                        isAdmin: response.user.isAdmin || false,
                    };
                    onLoginSuccess(response.user);
                } else {
                    localStorage.removeItem("sessionToken");
                    onFailure("Session expired");
                }
            } catch (error) {
                onFailure(error.message);
            }
        };

        verifySession();
    }, []);

    const createUser = async (userConfig) => {
        try {
            const accountCreationStatus = await checkAccountCreationStatus();
            if (!accountCreationStatus.allowed && !accountCreationStatus.isFirstUser) {
                throw new Error("Account creation has been disabled by an administrator");
            }

            const response = await new Promise((resolve) => {
                const isFirstUser = accountCreationStatus.isFirstUser;
                socketRef.current.emit("createUser", { ...userConfig, isAdmin: isFirstUser }, resolve);
            });

            if (response?.user?.sessionToken) {
                currentUser.current = {
                    id: response.user.id,
                    username: response.user.username,
                    sessionToken: response.user.sessionToken,
                    isAdmin: response.user.isAdmin || false,
                };
                localStorage.setItem("sessionToken", response.user.sessionToken);
                onCreateSuccess(response.user);
            } else {
                throw new Error(response?.error || "User creation failed");
            }
        } catch (error) {
            onFailure(error.message);
        }
    };

    const loginUser = async ({ username, password, sessionToken }) => {
        try {
            const response = await new Promise((resolve) => {
                const credentials = sessionToken ? { sessionToken } : { username, password };
                socketRef.current.emit("loginUser", credentials, resolve);
            });

            if (response?.success) {
                currentUser.current = {
                    id: response.user.id,
                    username: response.user.username,
                    sessionToken: response.user.sessionToken,
                    isAdmin: response.user.isAdmin || false,
                };
                localStorage.setItem("sessionToken", response.user.sessionToken);
                onLoginSuccess(response.user);
            } else {
                throw new Error(response?.error || "Login failed");
            }
        } catch (error) {
            onFailure(error.message);
        }
    };

    const loginAsGuest = async () => {
        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("loginAsGuest", resolve);
            });

            if (response?.success) {
                currentUser.current = {
                    id: response.user.id,
                    username: response.user.username,
                    sessionToken: response.user.sessionToken,
                    isAdmin: false,
                };
                localStorage.setItem("sessionToken", response.user.sessionToken);
                onLoginSuccess(response.user);
            } else {
                throw new Error(response?.error || "Guest login failed");
            }
        } catch (error) {
            onFailure(error.message);
        }
    }

    const logoutUser = () => {
        localStorage.removeItem("sessionToken");
        currentUser.current = null;
        onLoginSuccess(null);
    };

    const deleteUser = async () => {
        if (!currentUser.current) return onFailure("No user logged in");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("deleteUser", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                }, resolve);
            });

            if (response?.success) {
                logoutUser();
                onDeleteSuccess(response);
            } else {
                throw new Error(response?.error || "User deletion failed");
            }
        } catch (error) {
            onFailure(error.message);
        }
    };

    const checkAccountCreationStatus = async () => {
        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("checkAccountCreationStatus", resolve);
            });
            
            return {
                allowed: response?.allowed !== false,
                isFirstUser: response?.isFirstUser || false
            };
        } catch (error) {
            return { allowed: true, isFirstUser: false };
        }
    };

    const toggleAccountCreation = async (enabled) => {
        if (!currentUser.current?.isAdmin) return onFailure("Not authorized");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("toggleAccountCreation", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    enabled
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to update account creation settings");
            }
            
            return response.enabled;
        } catch (error) {
            onFailure(error.message);
            return null;
        }
    };

    const addAdminUser = async (username) => {
        if (!currentUser.current?.isAdmin) return onFailure("Not authorized");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("addAdminUser", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    targetUsername: username
                }, resolve);
            });

            if (!response?.success) {
                const errorMsg = response?.error || "Failed to add admin user";
                throw new Error(errorMsg);
            }
            
            return true;
        } catch (error) {
            onFailure(error.message);
            return false;
        }
    };

    const getAllAdmins = async () => {
        if (!currentUser.current?.isAdmin) return [];

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("getAllAdmins", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                }, resolve);
            });

            if (response?.success) {
                return response.admins || [];
            } else {
                throw new Error(response?.error || "Failed to fetch admins");
            }
        } catch (error) {
            onFailure(error.message);
            return [];
        }
    };

    const saveHost = async (hostConfig) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            if (!hostConfig || !hostConfig.hostConfig) {
                return onFailure("Invalid host configuration");
            }

            if (!hostConfig.hostConfig.ip || !hostConfig.hostConfig.user) {
                return onFailure("Host must have IP and username");
            }

            if (!hostConfig.hostConfig.name || hostConfig.hostConfig.name.trim() === '') {
                hostConfig.hostConfig.name = hostConfig.hostConfig.ip;
            }

            const existingHosts = await getAllHosts();

            const duplicateNameHost = existingHosts.find(host => 
                host && host.config && host.config.name && 
                typeof host.config.name === 'string' &&
                typeof hostConfig.hostConfig.name === 'string' &&
                host.config.name.toLowerCase() === hostConfig.hostConfig.name.toLowerCase()
            );
            
            if (duplicateNameHost) {
                return onFailure("A host with this name already exists. Please choose a different name.");
            }

            if (!hostConfig.hostConfig.terminalConfig) {
                hostConfig.hostConfig.terminalConfig = {
                    theme: 'dark',
                    cursorStyle: 'block',
                    fontFamily: 'ubuntuMono',
                    fontSize: 14,
                    fontWeight: 'normal',
                    lineHeight: 1,
                    letterSpacing: 0,
                    cursorBlink: true,
                    sshAlgorithm: 'default'
                };
            }

            const response = await new Promise((resolve) => {
                socketRef.current.emit("saveHostConfig", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    hostConfig: hostConfig.hostConfig
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to save host");
            }
        } catch (error) {
            onFailure(error.message);
        }
    };

    const getAllHosts = async () => {
        if (!currentUser.current) return [];

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("getHosts", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                }, resolve);
            });

            if (response?.success && Array.isArray(response.hosts)) {
                return response.hosts.map(host => {
                    if (!host) return null;

                    return {
                        ...host,
                        config: host.config ? {
                            name: host.config.name || host.name || '',
                            folder: host.config.folder || host.folder || '',
                            ip: host.config.ip || host.ip || '',
                            user: host.config.user || host.user || '',
                            port: host.config.port || host.port || '22',
                            password: host.config.password || host.password || '',
                            sshKey: host.config.sshKey || host.sshKey || '',
                            keyType: host.config.keyType || host.keyType || '',
                            isPinned: host.isPinned || false,
                            tags: host.config.tags || host.tags || [],
                            terminalConfig: host.config.terminalConfig || {
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
                        } : {
                            name: host.name || '',
                            folder: host.folder || '',
                            ip: host.ip || '',
                            user: host.user || '',
                            port: host.port || '22',
                            password: host.password || '',
                            sshKey: host.sshKey || '',
                            keyType: host.keyType || '',
                            isPinned: host.isPinned || false,
                            tags: host.tags || [],
                            terminalConfig: host.terminalConfig || {
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
                        }
                    };
                }).filter(host => host && host.config && host.config.ip && host.config.user);
            } else {
                return [];
            }
        } catch (error) {
            onFailure(error.message);
            return [];
        }
    };

    const deleteHost = async ({ hostId }) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("deleteHost", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    hostId: hostId,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to delete host");
            }
        } catch (error) {
            onFailure(error.message);
        }
    };

    const editHost = async ({ oldHostConfig, newHostConfig }) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            if (!oldHostConfig || !newHostConfig) {
                return onFailure("Invalid host configuration");
            }

            if (!newHostConfig.ip || !newHostConfig.user) {
                return onFailure("Host must have IP and username");
            }

            if (!oldHostConfig._id && !oldHostConfig.id) {
                return onFailure("Cannot identify host to edit: missing ID");
            }

            const hostId = oldHostConfig._id || oldHostConfig.id;
            oldHostConfig._id = hostId;
            oldHostConfig.id = hostId;
            newHostConfig._id = hostId;
            newHostConfig.id = hostId;

            if (!newHostConfig.name || newHostConfig.name.trim() === '') {
                newHostConfig.name = newHostConfig.ip;
            }

            const isNameUnchanged = 
                oldHostConfig.name && 
                newHostConfig.name && 
                oldHostConfig.name.toLowerCase() === newHostConfig.name.toLowerCase();

            if (!isNameUnchanged) {
                const existingHosts = await getAllHosts();

                const duplicateNameHost = existingHosts.find(host => 
                    host && 
                    host.config && 
                    host.config.name && 
                    typeof host.config.name === 'string' &&
                    typeof newHostConfig.name === 'string' &&
                    host.config.name.toLowerCase() === newHostConfig.name.toLowerCase() &&
                    host._id !== hostId
                );
                
                if (duplicateNameHost) {
                    return onFailure(`Host with name "${newHostConfig.name}" already exists. Please choose a different name.`);
                }
            }

            // Handle authentication method and storage
            if (!newHostConfig.storePassword) {
                // If not storing password, clear credentials
                newHostConfig.password = '';
                newHostConfig.sshKey = '';
                newHostConfig.keyType = '';
            }

            if (!newHostConfig.terminalConfig) {
                newHostConfig.terminalConfig = {
                    theme: 'dark',
                    cursorStyle: 'block',
                    fontFamily: 'ubuntuMono',
                    fontSize: 14,
                    fontWeight: 'normal',
                    lineHeight: 1,
                    letterSpacing: 0,
                    cursorBlink: true,
                    sshAlgorithm: 'default'
                };
            }

            const response = await new Promise((resolve) => {
                socketRef.current.emit("editHost", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    oldHostConfig,
                    newHostConfig,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to edit host");
            }
            
            return response;
        } catch (error) {
            onFailure(error.message);
            return { success: false, error: error.message };
        }
    };

    const shareHost = async (hostId, targetUsername) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("shareHost", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    hostId,
                    targetUsername,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to share host");
            }
        } catch (error) {
            onFailure(error.message);
        }
    };

    const removeShare = async (hostId) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("removeShare", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    hostId,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to remove share");
            }
        } catch (error) {
            onFailure(error.message);
        }
    };

    const saveSnippet = async (snippet) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("saveSnippet", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    snippet
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to save snippet");
            }
            
            return true;
        } catch (error) {
            onFailure(error.message);
            return false;
        }
    };

    const getAllSnippets = async () => {
        if (!currentUser.current) return [];

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("getSnippets", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                }, resolve);
            });

            if (response?.success) {
                return response.snippets.map(snippet => ({
                    ...snippet,
                    isPinned: snippet.isPinned || false,
                    tags: snippet.tags || []
                }));
            } else {
                throw new Error(response?.error || "Failed to fetch snippets");
            }
        } catch (error) {
            onFailure(error.message);
            return [];
        }
    };

    const deleteSnippet = async ({ snippetId }) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("deleteSnippet", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    snippetId,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to delete snippet");
            }
            
            return true;
        } catch (error) {
            onFailure(error.message);
            return false;
        }
    };

    const editSnippet = async ({ oldSnippet, newSnippet }) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("editSnippet", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    oldSnippet,
                    newSnippet,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to edit snippet");
            }
            
            return true;
        } catch (error) {
            onFailure(error.message);
            return false;
        }
    };

    const shareSnippet = async (snippetId, targetUsername) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("shareSnippet", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    snippetId,
                    targetUsername,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to share snippet");
            }
            
            return true;
        } catch (error) {
            onFailure(error.message);
            return false;
        }
    };

    const removeSnippetShare = async (snippetId) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const response = await new Promise((resolve) => {
                socketRef.current.emit("removeSnippetShare", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    snippetId,
                }, resolve);
            });

            if (!response?.success) {
                throw new Error(response?.error || "Failed to remove snippet share");
            }
            
            return true;
        } catch (error) {
            onFailure(error.message);
            return false;
        }
    };

    useImperativeHandle(ref, () => ({
        createUser,
        loginUser,
        loginAsGuest,
        logoutUser,
        deleteUser,
        saveHost,
        getAllHosts,
        deleteHost,
        shareHost,
        editHost,
        removeShare,
        saveSnippet,
        getAllSnippets,
        deleteSnippet,
        editSnippet,
        shareSnippet,
        removeSnippetShare,
        getUser: () => currentUser.current,
        getSocketRef: () => socketRef.current,
        checkAccountCreationStatus,
        toggleAccountCreation,
        addAdminUser,
        getAllAdmins,
        isAdmin: () => currentUser.current?.isAdmin || false,
    }));

    return null;
});

User.displayName = "User";

User.propTypes = {
    onLoginSuccess: PropTypes.func.isRequired,
    onCreateSuccess: PropTypes.func.isRequired,
    onDeleteSuccess: PropTypes.func.isRequired,
    onFailure: PropTypes.func.isRequired,
};