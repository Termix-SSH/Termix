import PropTypes from 'prop-types';
import { useState } from 'react';
import { Modal, Button } from "@mui/joy";
import LogoutIcon from "@mui/icons-material/Logout";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import AdminModal from "./AdminModal";
import theme from "../theme";

export default function ProfileModal({
    isHidden,
    getUser,
    handleDeleteUser,
    handleLogoutUser,
    setIsProfileHidden,
    handleAddAdmin,
    handleToggleAccountCreation,
    checkAccountCreationStatus,
    getAllAdmins,
    adminErrorMessage,
    setAdminErrorMessage
}) {
    const [isConfirmDeleteHidden, setIsConfirmDeleteHidden] = useState(true);
    const [isAdminModalHidden, setIsAdminModalHidden] = useState(true);
    const user = getUser();
    const username = user?.username;
    const isAdmin = user?.isAdmin || false;

    return (
        <>
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
                        {isAdmin && (
                            <Button
                                fullWidth
                                onClick={() => setIsAdminModalHidden(false)}
                                startDecorator={<AdminPanelSettingsIcon />}
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
                                Admin Panel
                            </Button>
                        )}

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
                            onClick={() => setIsConfirmDeleteHidden(false)}
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

                        <div className="text-center text-xs text-gray-400">
                            v0.3
                        </div>
                    </div>
                </div>
            </Modal>

            <ConfirmDeleteModal
                isHidden={isConfirmDeleteHidden}
                title="Delete Account"
                message="Are you sure you want to delete your account? This action cannot be undone and will delete all your data."
                itemName={username ? `Account: ${username}` : undefined}
                onConfirm={() => {
                    handleDeleteUser({
                        onSuccess: () => {
                            setIsConfirmDeleteHidden(true);
                            setIsProfileHidden(true);
                        },
                    });
                }}
                onCancel={() => setIsConfirmDeleteHidden(true)}
            />

            {isAdmin && (
                <AdminModal
                    isHidden={isAdminModalHidden}
                    setIsHidden={setIsAdminModalHidden}
                    handleAddAdmin={handleAddAdmin}
                    handleToggleAccountCreation={handleToggleAccountCreation}
                    checkAccountCreationStatus={checkAccountCreationStatus}
                    getAllAdmins={getAllAdmins}
                    adminErrorMessage={adminErrorMessage}
                    setAdminErrorMessage={setAdminErrorMessage}
                />
            )}
        </>
    );
}

ProfileModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    getUser: PropTypes.func.isRequired,
    handleDeleteUser: PropTypes.func.isRequired,
    handleLogoutUser: PropTypes.func.isRequired,
    setIsProfileHidden: PropTypes.func.isRequired,
    handleAddAdmin: PropTypes.func,
    handleToggleAccountCreation: PropTypes.func,
    checkAccountCreationStatus: PropTypes.func,
    getAllAdmins: PropTypes.func,
    adminErrorMessage: PropTypes.string,
    setAdminErrorMessage: PropTypes.func
};