import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import { Modal, Button, FormControl, FormLabel, Input, Stack, DialogTitle, DialogContent, ModalDialog, IconButton } from '@mui/joy';
import theme from '/src/theme';
import { useEffect, useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const LoginUserModal = ({ isHidden, form, setForm, handleLoginUser, handleGuestLogin, setIsLoginUserHidden, setIsCreateUserHidden }) => {
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const isFormValid = () => {
        if (!form.username || !form.password) return false;
        return true;
    };

    const handleLogin = async () => {
        setIsLoading(true);
        try {
            await handleLoginUser({
                ...form,
                onSuccess: () => setIsLoading(false),
                onFailure: () => setIsLoading(false)
            });
        } catch (error) {
            setIsLoading(false);
        }
    };

    const handleGuest = async () => {
        setIsLoading(true);
        try {
            await handleGuestLogin({
                onSuccess: () => setIsLoading(false),
                onFailure: () => setIsLoading(false)
            });
        } catch (error) {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isHidden) {
            setForm({ username: '', password: '' });
            setIsLoading(false);
        }
    }, [isHidden]);

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => {}}>
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
                    }}
                >
                    <DialogTitle>Login</DialogTitle>
                    <DialogContent>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (isFormValid() && !isLoading) handleLogin();
                            }}
                        >
                            <Stack spacing={2} sx={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}>
                                <FormControl>
                                    <FormLabel>Username</FormLabel>
                                    <Input
                                        disabled={isLoading}
                                        value={form.username}
                                        onChange={(event) => setForm({ ...form, username: event.target.value })}
                                        sx={{
                                            backgroundColor: theme.palette.general.primary,
                                            color: theme.palette.text.primary,
                                            '&:disabled': {
                                                opacity: 0.5,
                                                backgroundColor: theme.palette.general.primary,
                                            },
                                        }}
                                    />
                                </FormControl>
                                <FormControl>
                                    <FormLabel>Password</FormLabel>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <Input
                                            disabled={isLoading}
                                            type={showPassword ? 'text' : 'password'}
                                            value={form.password}
                                            onChange={(event) => setForm({ ...form, password: event.target.value })}
                                            sx={{
                                                backgroundColor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                                flex: 1,
                                                '&:disabled': {
                                                    opacity: 0.5,
                                                    backgroundColor: theme.palette.general.primary,
                                                },
                                            }}
                                        />
                                        <IconButton
                                            disabled={isLoading}
                                            onClick={() => setShowPassword(!showPassword)}
                                            sx={{
                                                color: theme.palette.text.primary,
                                                marginLeft: 1,
                                                '&:disabled': {
                                                    opacity: 0.5,
                                                },
                                            }}
                                        >
                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </div>
                                </FormControl>
                                <Button
                                    type="submit"
                                    disabled={!isFormValid() || isLoading}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        '&:hover': {
                                            backgroundColor: theme.palette.general.disabled,
                                        },
                                        '&:disabled': {
                                            opacity: 0.5,
                                            backgroundColor: theme.palette.general.primary,
                                        },
                                    }}
                                >
                                    {isLoading ? "Logging in..." : "Login"}
                                </Button>
                                <Button
                                    disabled={isLoading}
                                    onClick={() => {
                                        setForm({ username: '', password: '' });
                                        setIsCreateUserHidden(false);
                                        setIsLoginUserHidden(true);
                                    }}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        '&:hover': {
                                            backgroundColor: theme.palette.general.disabled,
                                        },
                                        '&:disabled': {
                                            opacity: 0.5,
                                            backgroundColor: theme.palette.general.primary,
                                        },
                                    }}
                                >
                                    Create User
                                </Button>
                                <Button
                                    disabled={isLoading}
                                    onClick={handleGuest}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        '&:hover': {
                                            backgroundColor: theme.palette.general.disabled,
                                        },
                                        '&:disabled': {
                                            opacity: 0.5,
                                            backgroundColor: theme.palette.general.primary,
                                        },
                                    }}
                                >
                                    {isLoading ? "Logging in as guest..." : "Login as Guest"}
                                </Button>
                            </Stack>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

LoginUserModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    handleLoginUser: PropTypes.func.isRequired,
    handleGuestLogin: PropTypes.func.isRequired,
    setIsLoginUserHidden: PropTypes.func.isRequired,
    setIsCreateUserHidden: PropTypes.func.isRequired,
};

export default LoginUserModal;