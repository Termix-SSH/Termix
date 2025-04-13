import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import {
    Modal,
    Button,
    FormControl,
    FormLabel,
    Input,
    Stack,
    DialogContent,
    ModalDialog,
    IconButton,
    Tabs,
    TabList,
    Tab,
    TabPanel
} from '@mui/joy';
import theme from '/src/theme';
import { useEffect, useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import eventBus from '/src/other/eventBus';

const AuthModal = ({
                       isHidden,
                       form,
                       setForm,
                       handleLoginUser,
                       handleCreateUser,
                       handleGuestLogin,
                       setIsAuthModalHidden
                   }) => {
    const [activeTab, setActiveTab] = useState(0);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const loginErrorHandler = () => setIsLoading(false);
        eventBus.on('failedLoginUser', loginErrorHandler);
        return () => eventBus.off('failedLoginUser', loginErrorHandler);
    }, []);

    const resetForm = () => {
        setForm({ username: '', password: '' });
        setShowPassword(false);
        setShowConfirmPassword(false);
        setIsLoading(false);
    };

    const handleLogin = async () => {
        setIsLoading(true);
        try {
            await handleLoginUser({
                ...form,
                onSuccess: () => {
                    setIsLoading(false);
                    setIsAuthModalHidden(true);
                },
                onFailure: () => setIsLoading(false),
            });
        } catch (error) {
            setIsLoading(false);
        }
    };

    const handleCreate = async () => {
        setIsLoading(true);
        try {
            await handleCreateUser({
                ...form,
                onSuccess: () => {
                    setIsLoading(false);
                    setActiveTab(0);
                    setIsAuthModalHidden(true);
                },
                onFailure: () => setIsLoading(false),
            });
        } catch (error) {
            setIsLoading(false);
        }
    };

    const handleGuest = async () => {
        setIsLoading(true);
        try {
            await handleGuestLogin({
                onSuccess: () => {
                    setIsLoading(false);
                    setIsAuthModalHidden(true);
                },
                onFailure: () => setIsLoading(false)
            });
        } catch (error) {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isHidden) resetForm();
    }, [isHidden]);

    const isLoginValid = !!form.username && !!form.password;
    const isCreateValid = isLoginValid && form.password === form.confirmPassword;

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsAuthModalHidden(true)}>
                <ModalDialog
                    layout="center"
                    variant="outlined"
                    sx={{
                        backgroundColor: theme.palette.general.tertiary,
                        borderColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                        padding: 0,
                        borderRadius: 10,
                        maxWidth: '400px',
                        width: '100%',
                        overflow: 'hidden',
                    }}
                >
                    <Tabs
                        value={activeTab}
                        onChange={(e, val) => setActiveTab(val)}
                        sx={{
                            width: '100%',
                            backgroundColor: theme.palette.general.tertiary,
                        }}
                    >
                        <TabList
                            sx={{
                                gap: 0,
                                borderTopLeftRadius: 10,
                                borderTopRightRadius: 10,
                                backgroundColor: theme.palette.general.primary,
                                '& button': {
                                    flex: 1,
                                    bgcolor: 'transparent',
                                    color: theme.palette.text.secondary,
                                    '&:hover': {
                                        bgcolor: theme.palette.general.disabled,
                                    },
                                    '&.Mui-selected': {
                                        bgcolor: theme.palette.general.tertiary,
                                        color: theme.palette.text.primary,
                                        '&:hover': {
                                            bgcolor: theme.palette.general.tertiary,
                                        },
                                    },
                                },
                            }}
                        >
                            <Tab sx={{ flex: 1 }}>Login</Tab>
                            <Tab sx={{ flex: 1 }}>Create</Tab>
                        </TabList>

                        <DialogContent sx={{ padding: 3, backgroundColor: theme.palette.general.tertiary }}>
                            <TabPanel value={0} sx={{ p: 0 }}>
                                <Stack spacing={2} component="form" onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
                                    <FormControl>
                                        <FormLabel>Username</FormLabel>
                                        <Input
                                            disabled={isLoading}
                                            value={form.username}
                                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                                            sx={inputStyle}
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel>Password</FormLabel>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <Input
                                                disabled={isLoading}
                                                type={showPassword ? 'text' : 'password'}
                                                value={form.password}
                                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                                sx={{ ...inputStyle, flex: 1 }}
                                            />
                                            <IconButton
                                                disabled={isLoading}
                                                onClick={() => setShowPassword(!showPassword)}
                                                sx={iconButtonStyle}
                                            >
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </div>
                                    </FormControl>
                                    <Button
                                        type="submit"
                                        disabled={!isLoginValid || isLoading}
                                        sx={buttonStyle}
                                    >
                                        {isLoading ? "Logging in..." : "Login"}
                                    </Button>
                                    <Button
                                        disabled={isLoading}
                                        onClick={handleGuest}
                                        sx={buttonStyle}
                                    >
                                        {isLoading ? "Logging in..." : "Continue as Guest"}
                                    </Button>
                                </Stack>
                            </TabPanel>

                            <TabPanel value={1} sx={{ p: 0 }}>
                                <Stack spacing={2} component="form" onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
                                    <FormControl>
                                        <FormLabel>Username</FormLabel>
                                        <Input
                                            disabled={isLoading}
                                            value={form.username}
                                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                                            sx={inputStyle}
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel>Password</FormLabel>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <Input
                                                disabled={isLoading}
                                                type={showPassword ? 'text' : 'password'}
                                                value={form.password}
                                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                                sx={{ ...inputStyle, flex: 1 }}
                                            />
                                            <IconButton
                                                disabled={isLoading}
                                                onClick={() => setShowPassword(!showPassword)}
                                                sx={iconButtonStyle}
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
                                                value={form.confirmPassword || ''}
                                                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                                                sx={{ ...inputStyle, flex: 1 }}
                                            />
                                            <IconButton
                                                disabled={isLoading}
                                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                sx={iconButtonStyle}
                                            >
                                                {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </div>
                                    </FormControl>
                                    <Button
                                        type="submit"
                                        disabled={!isCreateValid || isLoading}
                                        sx={buttonStyle}
                                    >
                                        {isLoading ? "Creating..." : "Create Account"}
                                    </Button>
                                </Stack>
                            </TabPanel>
                        </DialogContent>
                    </Tabs>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

const inputStyle = {
    backgroundColor: theme.palette.general.primary,
    color: theme.palette.text.primary,
    '&:disabled': {
        opacity: 0.5,
        backgroundColor: theme.palette.general.primary,
    },
};

const iconButtonStyle = {
    color: theme.palette.text.primary,
    marginLeft: 1,
    '&:disabled': { opacity: 0.5 },
};

const buttonStyle = {
    backgroundColor: theme.palette.general.primary,
    '&:hover': { backgroundColor: theme.palette.general.disabled },
    '&:disabled': {
        opacity: 0.5,
        backgroundColor: theme.palette.general.primary,
    },
};

AuthModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    handleLoginUser: PropTypes.func.isRequired,
    handleCreateUser: PropTypes.func.isRequired,
    handleGuestLogin: PropTypes.func.isRequired,
    setIsAuthModalHidden: PropTypes.func.isRequired,
};

export default AuthModal;