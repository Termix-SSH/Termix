import { useRef, forwardRef, useImperativeHandle, useEffect } from "react";
import io from "socket.io-client";
import PropTypes from "prop-types";

const SOCKET_URL = window.location.hostname === "localhost"
    ? "http://localhost:8082/database.io"
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
            const response = await new Promise((resolve) => {
                socketRef.current.emit("createUser", userConfig, resolve);
            });

            if (response?.user?.sessionToken) {
                currentUser.current = {
                    id: response.user.id,
                    username: response.user.username,
                    sessionToken: response.user.sessionToken,
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

    const saveHost = async (hostConfig) => {
        if (!currentUser.current) return onFailure("Not authenticated");

        try {
            const existingHosts = await getAllHosts();

            const duplicateNameHost = existingHosts.find(host => 
                host.config.name && 
                host.config.name.toLowerCase() === hostConfig.hostConfig.name.toLowerCase()
            );
            
            if (duplicateNameHost) {
                return onFailure("A host with this name already exists. Please choose a different name.");
            }

            if (!hostConfig.hostConfig.name) {
                const duplicateIpHost = existingHosts.find(host => 
                    host.config.ip.toLowerCase() === hostConfig.hostConfig.ip.toLowerCase()
                );
                
                if (duplicateIpHost) {
                    return onFailure("A host with this IP already exists. Please provide a unique name.");
                }
            }

            // Ensure terminal configuration is included
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
                    sshAlgorithm: 'default',
                    useNerdFont: true
                };
            } else {
                // Ensure useNerdFont is set to true
                hostConfig.hostConfig.terminalConfig.useNerdFont = true;
            }

            const response = await new Promise((resolve) => {
                socketRef.current.emit("saveHostConfig", {
                    userId: currentUser.current.id,
                    sessionToken: currentUser.current.sessionToken,
                    ...hostConfig
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

            if (response?.success) {
                return response.hosts.map(host => ({
                    ...host,
                    config: host.config ? {
                        name: host.config.name || '',
                        folder: host.config.folder || '',
                        ip: host.config.ip || '',
                        user: host.config.user || '',
                        port: host.config.port || '22',
                        password: host.config.password || '',
                        sshKey: host.config.sshKey || '',
                        keyType: host.config.keyType || '',
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
                            sshAlgorithm: 'default',
                            useNerdFont: true
                        }
                    } : {}
                })).filter(host => host.config && host.config.ip && host.config.user);
            } else {
                throw new Error(response?.error || "Failed to fetch hosts");
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
            const existingHosts = await getAllHosts();

            const duplicateNameHost = existingHosts.find(host => 
                host.config.name && 
                host.config.name.toLowerCase() === newHostConfig.name.toLowerCase() &&
                host.config.ip.toLowerCase() !== oldHostConfig.ip.toLowerCase()
            );
            
            if (duplicateNameHost) {
                return onFailure("A host with this name already exists. Please choose a different name.");
            }

            // Ensure terminal configuration is included
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
                    sshAlgorithm: 'default',
                    useNerdFont: true
                };
            } else {
                // Ensure useNerdFont is set to true
                newHostConfig.terminalConfig.useNerdFont = true;
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
        } catch (error) {
            onFailure(error.message);
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

    // Snippet management functions
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