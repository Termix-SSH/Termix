import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import { Modal, Button, FormControl, FormLabel, Input, Stack, DialogTitle, DialogContent, ModalDialog, IconButton } from '@mui/joy';
import theme from '/src/theme';
import { useEffect, useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const CreateUserModal = ({ isHidden, form, setForm, handleCreateUser, setIsCreateUserHidden, setIsLoginUserHidden }) => {
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const isFormValid = () => {
        if (!form.username || !form.password || form.password !== confirmPassword) return false;
        return true;
    };

    const handleCreate = async () => {
        setIsLoading(true);
        try {
            await handleCreateUser({
                ...form,
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
            setConfirmPassword('');
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
                    <DialogTitle>Create</DialogTitle>
                    <DialogContent>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (isFormValid() && !isLoading) handleCreate();
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
                                <FormControl>
                                    <FormLabel>Confirm Password</FormLabel>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <Input
                                            disabled={isLoading}
                                            type={showConfirmPassword ? 'text' : 'password'}
                                            value={confirmPassword}
                                            onChange={(event) => setConfirmPassword(event.target.value)}
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
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            sx={{
                                                color: theme.palette.text.primary,
                                                marginLeft: 1,
                                                '&:disabled': {
                                                    opacity: 0.5,
                                                },
                                            }}
                                        >
                                            {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
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
                                    {isLoading ? "Creating user..." : "Create"}
                                </Button>
                                <Button
                                    disabled={isLoading}
                                    onClick={() => {
                                        setForm({ username: '', password: '' });
                                        setConfirmPassword('');
                                        setIsCreateUserHidden(true);
                                        setIsLoginUserHidden(false);
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
                                    Back
                                </Button>
                            </Stack>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

CreateUserModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    handleCreateUser: PropTypes.func.isRequired,
    setIsCreateUserHidden: PropTypes.func.isRequired,
    setIsLoginUserHidden: PropTypes.func.isRequired,
};

export default CreateUserModal;