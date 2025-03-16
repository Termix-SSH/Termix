import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import { Modal, Button, FormControl, FormLabel, Input, Stack, DialogTitle, DialogContent, ModalDialog, IconButton } from '@mui/joy';
import theme from '/src/theme';
import { useEffect, useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const LoginUserModal = ({ isHidden, form, setForm, handleLoginUser, handleGuestLogin, setIsLoginUserHidden, setIsCreateUserHidden }) => {
    const [showPassword, setShowPassword] = useState(false);

    const isFormValid = () => {
        if (!form.username || !form.password) return false;
        return true;
    };

    const handleLogin = () => {
        handleLoginUser({
            ...form,
        });
    };

    useEffect(() => {
        if (isHidden) {
            setForm({ username: '', password: '' });
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
                                if (isFormValid()) handleLogin();
                            }}
                        >
                            <Stack spacing={2} sx={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}>
                                <FormControl>
                                    <FormLabel>Username</FormLabel>
                                    <Input
                                        value={form.username}
                                        onChange={(event) => setForm({ ...form, username: event.target.value })}
                                        sx={{
                                            backgroundColor: theme.palette.general.primary,
                                            color: theme.palette.text.primary,
                                        }}
                                    />
                                </FormControl>
                                <FormControl>
                                    <FormLabel>Password</FormLabel>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={form.password}
                                            onChange={(event) => setForm({ ...form, password: event.target.value })}
                                            sx={{
                                                backgroundColor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                                flex: 1,
                                            }}
                                        />
                                        <IconButton
                                            onClick={() => setShowPassword(!showPassword)}
                                            sx={{
                                                color: theme.palette.text.primary,
                                                marginLeft: 1,
                                            }}
                                        >
                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </div>
                                </FormControl>
                                <Button
                                    type="submit"
                                    disabled={!isFormValid()}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        '&:hover': {
                                            backgroundColor: theme.palette.general.disabled,
                                        },
                                    }}
                                >
                                    Login
                                </Button>
                                <Button
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
                                    }}
                                >
                                    Create User
                                </Button>
                                <Button
                                    onClick={handleGuestLogin}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        '&:hover': {
                                            backgroundColor: theme.palette.general.disabled,
                                        },
                                    }}
                                >
                                    Login as Guest
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