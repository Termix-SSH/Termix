import { Button, ButtonGroup } from "@mui/joy";
import PropTypes from "prop-types";

function TabList({ terminals, activeTab, setActiveTab, closeTab, toggleSplit, splitTabIds, theme }) {
    const isSplitScreenActive = splitTabIds.length > 0;

    return (
        <div className="tablist inline-flex items-center h-full px-[0.5rem] overflow-x-auto">
            {terminals.map((terminal, index) => {
                const isActive = terminal.id === activeTab;
                const isSplit = splitTabIds.includes(terminal.id);
                const isSplitButtonDisabled = (isActive && !isSplitScreenActive) || (splitTabIds.length >= 3 && !isSplit);

                return (
                    <div key={terminal.id} className={index < terminals.length - 1 ? "mr-[0.5rem]" : ""}>
                        <ButtonGroup>
                            {/* Set Active Tab Button */}
                            <Button
                                onClick={() => setActiveTab(terminal.id)}
                                disabled={isSplit}
                                sx={{
                                    backgroundColor: isActive ? theme.palette.general.primary : theme.palette.general.disabled,
                                    color: theme.palette.text.primary,
                                    "&:hover": { backgroundColor: theme.palette.general.secondary },
                                    ":disabled": { backgroundColor: theme.palette.general.disabled },
                                    borderTopLeftRadius: "4px",
                                    borderBottomLeftRadius: "4px",
                                    height: "40px",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {terminal.title}
                            </Button>
                            {/* Split Screen Button */}
                            <Button
                                onClick={() => toggleSplit(terminal.id)}
                                disabled={isSplitButtonDisabled || isActive}
                                sx={{
                                    backgroundColor: isSplit ? theme.palette.general.primary : theme.palette.general.tertiary,
                                    color: theme.palette.text.primary,
                                    ":disabled": { backgroundColor: theme.palette.general.disabled },
                                    "&:hover": { backgroundColor: theme.palette.general.secondary },
                                    borderTopRightRadius: "4px",
                                    borderBottomRightRadius: "4px",
                                    height: "40px",
                                    fontSize: "1rem",
                                    cursor: isSplitButtonDisabled ? "not-allowed" : "pointer",
                                }}
                            >
                                /
                            </Button>
                            {/* Close Tab Button */}
                            <Button
                                onClick={() => closeTab(terminal.id)}
                                disabled={(isSplitScreenActive && isActive) || isSplit}
                                sx={{
                                    backgroundColor: theme.palette.general.tertiary,
                                    color: theme.palette.text.primary,
                                    "&:hover": { backgroundColor: theme.palette.general.secondary },
                                    ":disabled": { backgroundColor: theme.palette.general.disabled },
                                    borderTopRightRadius: "4px",
                                    borderBottomRightRadius: "4px",
                                    height: "40px",
                                    fontSize: "1rem",
                                }}
                            >
                                ×
                            </Button>
                        </ButtonGroup>
                    </div>
                );
            })}
        </div>
    );
}

TabList.propTypes = {
    terminals: PropTypes.array.isRequired,
    activeTab: PropTypes.any,
    setActiveTab: PropTypes.func.isRequired,
    closeTab: PropTypes.func.isRequired,
    toggleSplit: PropTypes.func.isRequired,
    splitTabIds: PropTypes.array.isRequired,
    theme: PropTypes.object.isRequired,
};

export default TabList;