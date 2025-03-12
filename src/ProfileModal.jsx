import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import {Modal, Button, DialogTitle, DialogContent, ModalDialog, Stack } from '@mui/joy';
import theme from './theme';

const ProfileModal = ({ isHidden, getUser, handleDeleteUser, handleLogoutUser, setIsProfileHidden }) => {
    const handleDelete = () => {
        handleDeleteUser({
            onSuccess: () => {
                window.location.reload();
            }
        });
    };

    const handleLogout = () => {
        handleLogoutUser({
            onSuccess: () => {
                window.location.reload();
            }
        });
    }

    const getUserName = () => {
        const user = getUser();
        return user ? user.username : '';
    }

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsProfileHidden(true)}>
                <ModalDialog
                    layout="center"
                    sx={{
                        backgroundColor: theme.palette.general.tertiary,
                        borderColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                        padding: 3,
                        borderRadius: 10,
                        width: "auto",
                        maxWidth: "90vw",
                        minWidth: "fit-content",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 1,
                    }}
                >
                    <DialogTitle sx={{ marginBottom: 1.5 }}>
                        {getUserName()}
                    </DialogTitle>
                    <DialogContent>
                        <Stack spacing={2} sx={{ width: "100%", maxWidth: "100%", overflow: "hidden", mt: 1.5 }}>
                            <Button
                                onClick={handleDelete}
                                sx={{
                                    backgroundColor: theme.palette.general.primary,
                                    '&:hover': {
                                        backgroundColor: theme.palette.general.disabled,
                                    },
                                }}
                            >
                                Delete User
                            </Button>
                            <Button
                                onClick={handleLogout}
                                sx={{
                                    backgroundColor: theme.palette.general.primary,
                                    '&:hover': {
                                        backgroundColor: theme.palette.general.disabled,
                                    },
                                }}
                            >
                                Logout
                            </Button>
                        </Stack>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

ProfileModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    getUser: PropTypes.func.isRequired,
    handleDeleteUser: PropTypes.func.isRequired,
    handleLogoutUser: PropTypes.func.isRequired,
    setIsProfileHidden: PropTypes.func.isRequired,
};

export default ProfileModal;