import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import { Button } from "@mui/joy";

function HostViewer({ getHosts, connectToHost, setIsAddHostHidden, deleteHost, editHost }) {
    const [hosts, setHosts] = useState([]);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;

        async function fetchInitialHosts() {
            try {
                const savedHosts = await getHosts();
                if (isMounted.current) {
                    setHosts(savedHosts || []);
                    setInitialLoadComplete(true);
                }
            } catch (error) {
                console.error("Initial host fetch failed:", error);
                if (isMounted.current) {
                    setHosts([]);
                    setInitialLoadComplete(true);
                }
            }
        }

        fetchInitialHosts();

        const intervalId = setInterval(async () => {
            try {
                const savedHosts = await getHosts();
                if (isMounted.current) {
                    setHosts(savedHosts || []);
                }
            } catch (error) {
                console.error("Periodic host update failed:", error);
            }
        }, 2000);

        return () => {
            isMounted.current = false;
            clearInterval(intervalId);
        };
    }, [getHosts]);

    return (
        <div className="h-full w-full p-4 text-white flex flex-col">
            <div className="flex items-center justify-between mb-2 w-full">
                <h2 className="text-lg font-bold">Hosts</h2>
                <Button
                    className="text-black"
                    onClick={() => setIsAddHostHidden(false)}
                    sx={{
                        backgroundColor: "#6e6e6e",
                        "&:hover": { backgroundColor: "#0f0f0f" }
                    }}
                >
                    Add Host
                </Button>
            </div>
            <div className="flex-grow overflow-auto">
                {hosts.length > 0 ? (
                    <div className="flex flex-col gap-2 w-full">
                        {hosts.map((hostWrapper, index) => {
                            const hostConfig = hostWrapper.hostConfig || {};

                            return (
                                <div key={index} className="flex justify-between items-center bg-neutral-800 p-3 rounded-lg shadow-md border border-neutral-700 w-full">
                                    <div>
                                        <p className="font-semibold">{hostConfig.name || hostConfig.ip}</p>
                                        <p className="text-sm text-gray-400">
                                            {hostConfig.user ? `${hostConfig.user}@${hostConfig.ip}` : hostConfig.ip}:{hostConfig.port}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button
                                            className="text-black"
                                            onClick={() => {
                                                connectToHost(hostConfig);
                                            }}
                                            sx={{
                                                backgroundColor: "#6e6e6e",
                                                "&:hover": { backgroundColor: "#0f0f0f" }
                                            }}
                                        >
                                            Connect
                                        </Button>
                                        <Button
                                            className="text-black"
                                            onClick={() => {
                                                deleteHost(hostConfig);
                                            }}
                                            sx={{
                                                backgroundColor: "#6e6e6e",
                                                "&:hover": { backgroundColor: "#0f0f0f" }
                                            }}
                                        >
                                            Delete
                                        </Button>
                                        <Button
                                            className="text-black"
                                            onClick={() => {
                                                editHost(hostConfig);
                                            }}
                                            sx={{
                                                backgroundColor: "#6e6e6e",
                                                "&:hover": { backgroundColor: "#0f0f0f" }
                                            }}
                                        >
                                            Edit
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-gray-300">Hosts are either loading or do not exist...</p>
                )}
            </div>
        </div>
    );
}

HostViewer.propTypes = {
    getHosts: PropTypes.func.isRequired,
    connectToHost: PropTypes.func.isRequired,
    setIsAddHostHidden: PropTypes.func.isRequired,
    deleteHost: PropTypes.func.isRequired,
    editHost: PropTypes.func.isRequired,
};

export default HostViewer;