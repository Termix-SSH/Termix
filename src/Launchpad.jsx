import PropTypes from 'prop-types';
import { useEffect, useRef } from 'react';
import { CssVarsProvider } from '@mui/joy/styles';
import theme from './theme';

// Apps
import HostViewer from './Apps/HostViewer';

function Launchpad({ onClose, getHosts, connectToHost }) {
    const launchpadRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (launchpadRef.current && !launchpadRef.current.contains(event.target)) {
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [onClose]);

    return (
        <CssVarsProvider theme={theme}>
            <div
                style={{
                    position: "fixed",
                    top: "0",
                    left: "0",
                    width: "100%",
                    height: "100%",
                    backgroundColor: "rgba(0, 0, 0, 0.2)",
                    zIndex: 1000,
                    backdropFilter: "blur(5px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <div
                    ref={launchpadRef}
                    style={{
                        width: "75%",
                        height: "75%",
                        backgroundColor: theme.palette.general.tertiary,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "8px",
                        boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)",
                        border: `1px solid ${theme.palette.general.secondary}`,
                        color: theme.palette.text.primary,
                        padding: 3,
                    }}
                >
                    <HostViewer getHosts={getHosts} connectToHost={connectToHost} />
                </div>
            </div>
        </CssVarsProvider>
    );
}

Launchpad.propTypes = {
    onClose: PropTypes.func.isRequired,
    connectToHost: PropTypes.func.isRequired,
    getHosts: PropTypes.func.isRequired,
};

export default Launchpad;