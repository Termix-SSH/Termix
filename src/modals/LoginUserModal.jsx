import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import { Modal, Button, FormControl, FormLabel, Input, Stack, DialogTitle, DialogContent, ModalDialog } from '@mui/joy';
import theme from '/src/theme';
import {useEffect} from 'react';

const LoginUserModal = ({ isHidden, form, setForm, handleLoginUser, setIsLoginUserHidden, setIsCreateUserHidden }) => {
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
                                    <Input
                                        type="password"
                                        value={form.password}
                                        onChange={(event) => setForm({ ...form, password: event.target.value })}
                                        sx={{
                                            backgroundColor: theme.palette.general.primary,
                                            color: theme.palette.text.primary,
                                        }}
                                    />
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
    setIsLoginUserHidden: PropTypes.func.isRequired,
    setIsCreateUserHidden: PropTypes.func.isRequired,
};

export default LoginUserModal;