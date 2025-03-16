import PropTypes from 'prop-types';
import { Modal, Button } from "@mui/joy";
import LogoutIcon from "@mui/icons-material/Logout";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import theme from "../theme";

export default function ProfileModal({
    isHidden,
    handleDeleteUser,
    handleLogoutUser,
    setIsProfileHidden,
}) {
    return (
        <Modal
            open={!isHidden}
            onClose={() => setIsProfileHidden(true)}
            sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <div style={{
                backgroundColor: theme.palette.general.tertiary,
                borderColor: theme.palette.general.secondary,
                borderWidth: "1px",
                borderStyle: "solid",
                borderRadius: "0.5rem",
                width: "400px",
                overflow: "hidden",
            }}>
                <div className="p-4 flex flex-col gap-4">
                    <Button
                        fullWidth
                        onClick={handleLogoutUser}
                        startDecorator={<LogoutIcon />}
                        sx={{
                            backgroundColor: theme.palette.general.tertiary,
                            color: "white",
                            "&:hover": {
                                backgroundColor: theme.palette.general.secondary,
                            },
                            height: "40px",
                            border: `1px solid ${theme.palette.general.secondary}`,
                        }}
                    >
                        Logout
                    </Button>

                    <Button
                        fullWidth
                        color="danger"
                        onClick={() => {
                            if (window.confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
                                handleDeleteUser({
                                    onSuccess: () => setIsProfileHidden(true),
                                    onFailure: (error) => console.error(error),
                                });
                            }
                        }}
                        startDecorator={<DeleteForeverIcon />}
                        sx={{
                            backgroundColor: "#c53030",
                            color: "white",
                            "&:hover": {
                                backgroundColor: "#9b2c2c",
                            },
                            height: "40px",
                            border: "1px solid #9b2c2c",
                        }}
                    >
                        Delete Account
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

ProfileModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    getUser: PropTypes.func.isRequired,
    handleDeleteUser: PropTypes.func.isRequired,
    handleLogoutUser: PropTypes.func.isRequired,
    setIsProfileHidden: PropTypes.func.isRequired,
};