import PropTypes from "prop-types";
import { useState, useEffect, useRef } from "react";
import { Button } from "@mui/joy";

function HostViewer({ getHosts, connectToHost }) {
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

        // Immediate first fetch
        fetchInitialHosts();

        // Periodic updates
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
            <div className="flex items-center mb-2 w-full">
                <h2 className="text-lg font-bold">Saved Hosts</h2>
            </div>
            <div className="flex-grow overflow-auto">
                {!initialLoadComplete ? (
                    <div className="flex flex-col gap-2 w-full">
                        <div className="flex justify-between items-center bg-neutral-800 p-3 rounded-lg shadow-md border border-neutral-700 animate-pulse">
                            <div>
                                <div className="h-5 bg-gray-600 rounded w-32 mb-2"></div>
                                <div className="h-4 bg-gray-600 rounded w-24"></div>
                            </div>
                            <div className="h-8 w-24 bg-gray-600 rounded"></div>
                        </div>
                    </div>
                ) : hosts.length > 0 ? (
                    <div className="flex flex-col gap-2 w-full">
                        {hosts.map((hostWrapper, index) => {
                            const hostConfig = hostWrapper.hostConfig || {};

                            const formattedHostConfig = {
                                name: hostConfig.name || "Unknown Host Name",
                                ip: hostConfig.ip || "Unknown IP",
                                user: hostConfig.user || "Unknown User",
                                password: hostConfig.password || undefined,
                                rsaKey: hostConfig.rsaKey || undefined,
                                port: hostConfig.port ? String(hostConfig.port) : "22",
                            };

                            const displayName = hostConfig.name ? hostConfig.name : hostConfig.ip;

                            return (
                                <div key={index} className="flex justify-between items-center bg-neutral-800 p-3 rounded-lg shadow-md border border-neutral-700 w-full">
                                    <div>
                                        <p className="font-semibold">{displayName}</p>
                                        <p className="text-sm text-gray-400">
                                            {hostConfig.user ? `${hostConfig.user}@${hostConfig.ip}` : hostConfig.ip}:{hostConfig.port}
                                        </p>
                                    </div>
                                    <Button
                                        onClick={() => {
                                            connectToHost(formattedHostConfig);
                                        }}
                                        sx={{ backgroundColor: "#4CAF50", "&:hover": { backgroundColor: "#45A049" } }}
                                    >
                                        Connect
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-gray-500">Hosts are loading...</p>
                )}
            </div>
        </div>
    );
}

HostViewer.propTypes = {
    getHosts: PropTypes.func.isRequired,
    connectToHost: PropTypes.func.isRequired,
};

export default HostViewer;