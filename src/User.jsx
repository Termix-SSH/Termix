import { useRef, forwardRef, useImperativeHandle } from "react";
import io from "socket.io-client";
import PropTypes from "prop-types";

let socket;

if (!socket) {
    socket = io(
        window.location.hostname === "localhost"
            ? "http://localhost:8082/database.io"
            : "/database.io",
        {
            path: "/database.io/socket.io",
            transports: ["websocket", "polling"],
        }
    );
}

export const User = forwardRef(({ onLoginSuccess, onCreateSuccess, onDeleteSuccess, onFailure }, ref) => {
    const socketRef = useRef(socket);
    const currentUser = useRef(null);

    const createUser = (userConfig) => {
        if (socketRef.current) {
            socketRef.current.emit("createUser", {
                username: userConfig.username,
                password: userConfig.password,
            });

            socketRef.current.once("userCreated", (data) => {
                currentUser.current = {
                    id: data.user._id,
                    username: data.user.username,
                    sessionToken: data.user.sessionToken,
                };
                localStorage.setItem('sessionToken', data.user.sessionToken);
                onCreateSuccess(data);
            });

            socketRef.current.once("error", (error) => {
                console.error(error);
                const errorMsg = (error && typeof error === 'object' && error !== null)
                    ? error.error || error.message || 'An error occurred'
                    : String(error);
                onFailure(errorMsg);
            });
        }
    };

    const loginUser = (userConfig) => {
        if (socketRef.current) {
            setTimeout(() => {
                socketRef.current.emit("loginUser", {
                    username: userConfig.username,
                    password: userConfig.password,
                    sessionToken: userConfig.sessionToken,
                });

                socketRef.current.once("userFound", (data) => {
                    currentUser.current = {
                        id: data._id,
                        username: data.username,
                        sessionToken: data.sessionToken,
                    };
                    localStorage.setItem('sessionToken', data.sessionToken);
                    onLoginSuccess(data);
                });

                socketRef.current.once("error", (error) => {
                    console.error(error);
                    const errorMsg = (error && typeof error === 'object' && error !== null)
                        ? error.error || error.message || 'An error occurred'
                        : String(error);
                    onFailure(errorMsg);
                });
            }, 500);
        }
    };

    const logoutUser = () => {
        localStorage.removeItem('sessionToken');
        currentUser.current = null;
    };

    const deleteUser = () => {
        if (currentUser.current?.id && socketRef.current) {
            socketRef.current.emit("deleteUser", {
                userId: currentUser.current.id,
            });

            socketRef.current.once("userDeleted", (data) => {
                onDeleteSuccess(data);
                currentUser.current = null;
                localStorage.removeItem('sessionToken');
            });

            socketRef.current.once("error", (error) => {
                console.error(error);
                const errorMsg = (error && typeof error === 'object' && error !== null)
                    ? error.error || error.message || 'An error occurred'
                    : String(error);
                onFailure(errorMsg);
            });
        } else {
            onFailure("No user is currently logged in.");
        }
    };

    const saveHost = (hostConfig) => {
        if (currentUser.current?.id && socketRef.current) {
            socketRef.current.emit("saveHostConfig", {
                userId: currentUser.current.id,
                hostConfig: hostConfig,
            });

            socketRef.current.once("error", (error) => {
                onFailure(error);
            });
        } else {
            onFailure("No user is currently logged in.");
        }
    }

    const getUser = () => {
        return currentUser.current;
    }

    const getAllHosts = () => {
        return new Promise((resolve, reject) => {
            if (currentUser.current?.id && socketRef.current) {
                socketRef.current.emit("getHosts", {
                    userId: currentUser.current.id,
                });

                socketRef.current.once("hostsFound", (data) => {
                    if (data && Array.isArray(data)) {
                        resolve(data);
                    } else {
                        reject("Invalid data received.");
                    }
                });

                socketRef.current.once("error", (error) => {
                    console.error(error);
                    const errorMsg = (error && typeof error === 'object' && error !== null)
                        ? error.error || error.message || 'An error occurred'
                        : String(error);
                    reject(errorMsg);
                });
            } else {
                reject("No user is currently logged in.");
            }
        });
    };

    const deleteHost = (hostConfig) => {
        if (currentUser.current?.id && socketRef.current) {
            socketRef.current.emit("deleteHost", {
                userId: currentUser.current.id,
                hostConfig: hostConfig,
            });

            socketRef.current.once("error", (error) => {
                onFailure(error);
            });
        } else {
            onFailure("No user is currently logged in.");
        }
    }

    const editExistingHost = ({ userId, oldHostConfig, newHostConfig }) => {
        if (currentUser.current?.id && socketRef.current) {
            socketRef.current.emit("editHost", {
                userId: userId,
                oldHostConfig: oldHostConfig,
                newHostConfig: newHostConfig,
            });

            socketRef.current.once("error", (error) => {
                onFailure(error);
            });
        } else {
            onFailure("No user is currently logged in.");
        }
    };

    const createFolder = (folderName) => {
        if (currentUser.current?.id && socketRef.current) {
            socketRef.current.emit("createFolder", {
                userId: currentUser.current.id,
                folderName: folderName,
            });

            socketRef.current.once("error", (error) => {
                onFailure(error);
            });
        } else {
            onFailure("No user is currently logged in.");
        }
    }

    const moveHostToFolder = (folderName, hostConfig) => {
        if (currentUser.current?.id && socketRef.current) {
            socketRef.current.emit("moveHostToFolder", {
                userId: currentUser.current.id,
                folderName: folderName,
                hostConfig: hostConfig,
            });

            socketRef.current.once("error", (error) => {
                onFailure(error);
            });
        } else {
            onFailure("No user is currently logged in.");
        }
    }

    useImperativeHandle(ref, () => ({
        createUser,
        loginUser,
        logoutUser,
        deleteUser,
        saveHost,
        getUser,
        getAllHosts,
        deleteHost,
        editExistingHost,
        createFolder,
        moveHostToFolder,
    }));

    return <div></div>;
});

User.displayName = "User";

User.propTypes = {
    onLoginSuccess: PropTypes.func.isRequired,
    onCreateSuccess: PropTypes.func.isRequired,
    onDeleteSuccess: PropTypes.func.isRequired,
    onFailure: PropTypes.func.isRequired,
};