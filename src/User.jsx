import { useRef, forwardRef, useImperativeHandle } from "react";
import io from "socket.io-client";
import PropTypes from "prop-types";

let socket = null;

if (socket === null) {
    socket = io(
        window.location.hostname === "localhost"
            ? "http://localhost:8082"
            : "/",
        {
            path: "/socket.io",
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

    const getUser = () => {
        return currentUser.current;
    }

    useImperativeHandle(ref, () => ({
        createUser,
        loginUser,
        logoutUser,
        deleteUser,
        getUser,
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