import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import { Modal, Button, FormControl, FormLabel, Input, Stack, ModalDialog, IconButton, Tabs, TabList, Tab, TabPanel } from '@mui/joy';
import theme from '/src/theme';
import { useEffect, useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const AuthModal = ({ isHidden, form, setForm, handleLoginUser, handleGuestLogin, handleCreateUser, setIsLoginUserHidden }) => {
    const [showPassword, setShowPassword] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [activeTab, setActiveTab] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    const isLoginFormValid = () => {
        return form.username?.trim() && form.password?.trim();
    };

    const isCreateFormValid = () => {
        return form.username?.trim() && form.password?.trim() && confirmPassword?.trim() && form.password === confirmPassword;
    };

    const handleLogin = () => {
        if (!isLoginFormValid()) {
            alert("Please fill out all fields");
            return;
        }
        
        setIsLoading(true);
        handleLoginUser({
            username: form.username.trim(),
            password: form.password.trim(),
            onSuccess: () => {
                setIsLoading(false);
                setIsLoginUserHidden(true);
            },
            onFailure: (error) => {
                setIsLoading(false);
                alert(error);
            }
        });
    };

    const handleCreate = () => {
        if (!isCreateFormValid()) {
            alert("Please fill out all fields and ensure passwords match");
            return;
        }
        
        setIsLoading(true);
        handleCreateUser({
            username: form.username.trim(),
            password: form.password.trim(),
            onSuccess: () => {
                setIsLoading(false);
                setIsLoginUserHidden(true);
            },
            onFailure: (error) => {
                setIsLoading(false);
                alert(error);
            }
        });
    };

    useEffect(() => {
        if (isHidden) {
            setForm({ username: '', password: '' });
            setConfirmPassword('');
            setIsLoading(false);
            setActiveTab(0);
        }
    }, [isHidden]);

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsLoginUserHidden(true)}>
                <ModalDialog layout="center" sx={{ backgroundColor: theme.palette.general.tertiary }}>
                    <Tabs value={activeTab} onChange={(e, val) => setActiveTab(val)}>
                        <TabList>
                            <Tab>Login</Tab>
                            <Tab>Create Account</Tab>
                        </TabList>

                        <div style={{ padding: '24px', backgroundColor: theme.palette.general.tertiary }}>
                            <TabPanel value={0}>
                                <Stack spacing={2}>
                                    <FormControl>
                                        <FormLabel>Username</FormLabel>
                                        <Input
                                            value={form.username}
                                            onChange={(event) => setForm({ ...form, username: event.target.value })}
                                            disabled={isLoading}
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel>Password</FormLabel>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <Input
                                                type={showPassword ? 'text' : 'password'}
                                                value={form.password}
                                                onChange={(event) => setForm({ ...form, password: event.target.value })}
                                                disabled={isLoading}
                                            />
                                            <IconButton onClick={() => setShowPassword(!showPassword)}>
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </div>
                                    </FormControl>
                                    <Button onClick={handleLogin} disabled={!isLoginFormValid() || isLoading}>
                                        {isLoading ? "Logging in..." : "Login"}
                                    </Button>
                                    <Button onClick={handleGuestLogin} disabled={isLoading}>
                                        {isLoading ? "Logging in as guest..." : "Login as Guest"}
                                    </Button>
                                </Stack>
                            </TabPanel>

                            <TabPanel value={1}>
                                <Stack spacing={2}>
                                    <FormControl>
                                        <FormLabel>Username</FormLabel>
                                        <Input
                                            value={form.username}
                                            onChange={(event) => setForm({ ...form, username: event.target.value })}
                                            disabled={isLoading}
                                        />
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel>Password</FormLabel>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <Input
                                                type={showPassword ? 'text' : 'password'}
                                                value={form.password}
                                                onChange={(event) => setForm({ ...form, password: event.target.value })}
                                                disabled={isLoading}
                                            />
                                            <IconButton onClick={() => setShowPassword(!showPassword)}>
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </div>
                                    </FormControl>
                                    <FormControl>
                                        <FormLabel>Confirm Password</FormLabel>
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={confirmPassword}
                                            onChange={(event) => setConfirmPassword(event.target.value)}
                                            disabled={isLoading}
                                        />
                                    </FormControl>
                                    <Button onClick={handleCreate} disabled={!isCreateFormValid() || isLoading}>
                                        {isLoading ? "Creating account..." : "Create Account"}
                                    </Button>
                                </Stack>
                            </TabPanel>
                        </div>
                    </Tabs>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

AuthModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    handleLoginUser: PropTypes.func.isRequired,
    handleGuestLogin: PropTypes.func.isRequired,
    handleCreateUser: PropTypes.func.isRequired,
    setIsLoginUserHidden: PropTypes.func.isRequired,
};

export default AuthModal;