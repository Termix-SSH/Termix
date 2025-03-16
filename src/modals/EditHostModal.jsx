import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { CssVarsProvider } from '@mui/joy/styles';
import {
    Modal,
    Button,
    FormControl,
    FormLabel,
    Input,
    Stack,
    DialogTitle,
    DialogContent,
    ModalDialog,
    Select,
    Option,
    IconButton,
    Checkbox,
    Tabs,
    TabList,
    Tab,
    TabPanel
} from '@mui/joy';
import theme from '/src/theme';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const EditHostModal = ({ isHidden, form, setForm, handleEditHost, setIsEditHostHidden, hostConfig }) => {
    const [showPassword, setShowPassword] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!isHidden && hostConfig) {
            setForm({
                name: hostConfig.name || '',
                folder: hostConfig.folder || '',
                ip: hostConfig.ip || '',
                user: hostConfig.user || '',
                password: hostConfig.password || '',
                rsaKey: hostConfig.rsaKey || '',
                port: hostConfig.port || 22,
                authMethod: hostConfig.password ? 'password' : hostConfig.rsaKey ? 'rsaKey' : 'Select Auth',
                rememberHost: true,
                storePassword: true,
            });
        }
    }, [isHidden, hostConfig]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file.name.endsWith('.rsa') || file.name.endsWith('.key') || file.name.endsWith('.pem') || file.name.endsWith('.der') || file.name.endsWith('.p8') || file.name.endsWith('.ssh') || file.name.endsWith('.pub')) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                setForm((prev) => ({ ...prev, rsaKey: evt.target.result }));
            };
            reader.readAsText(file);
        } else {
            alert('Please upload a valid RSA private key file.');
        }
    };

    const handleAuthChange = (newMethod) => {
        setForm((prev) => ({
            ...prev,
            authMethod: newMethod
        }));
    };

    const handleStorePasswordChange = (checked) => {
        setForm((prev) => ({
            ...prev,
            storePassword: Boolean(checked),
            password: checked ? prev.password : "",
            rsaKey: checked ? prev.rsaKey : "",
            authMethod: checked ? prev.authMethod : "Select Auth"
        }));
    };

    const isFormValid = () => {
        const { ip, user, port, authMethod, password, rsaKey, storePassword } = form;
        if (!ip?.trim() || !user?.trim() || !port) return false;
        const portNum = Number(port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;

        if (Boolean(storePassword) && authMethod === 'password' && !password?.trim()) return false;
        if (Boolean(storePassword) && authMethod === 'rsaKey' && !rsaKey && !hostConfig?.rsaKey) return false;
        if (Boolean(storePassword) && authMethod === 'Select Auth') return false;

        return true;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (isLoading) return;
        
        setIsLoading(true);
        try {
            await handleEditHost(hostConfig, {
                name: form.name || form.ip,
                folder: form.folder,
                ip: form.ip,
                user: form.user,
                password: form.authMethod === 'password' ? form.password : undefined,
                rsaKey: form.authMethod === 'rsaKey' ? form.rsaKey : undefined,
                port: String(form.port),
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <CssVarsProvider theme={theme}>
            <Modal 
                open={!isHidden} 
                onClose={() => !isLoading && setIsEditHostHidden(true)}
                sx={{
                    position: 'fixed',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(5px)',
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                }}
            >
                <ModalDialog
                    layout="center"
                    variant="outlined"
                    sx={{
                        backgroundColor: theme.palette.general.tertiary,
                        borderColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                        padding: 3,
                        borderRadius: 10,
                        maxWidth: '500px',
                        width: '100%',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        boxSizing: 'border-box',
                        mx: 2,
                    }}
                >
                    <DialogTitle sx={{ mb: 2 }}>Edit Host</DialogTitle>
                    <DialogContent>
                        <form onSubmit={handleSubmit}>
                            <Tabs 
                                value={activeTab} 
                                onChange={(e, val) => setActiveTab(val)}
                                sx={{ 
                                    backgroundColor: theme.palette.general.disabled,
                                    borderRadius: '8px',
                                    padding: '8px',
                                    marginBottom: '16px',
                                    width: '100%',
                                }}
                            >
                                <TabList
                                    sx={{
                                        width: '100%',
                                        gap: 0,
                                        mb: 2,
                                        '& button': {
                                            flex: 1,
                                            bgcolor: 'transparent',
                                            color: theme.palette.text.secondary,
                                            '&:hover': {
                                                bgcolor: 'rgba(255, 255, 255, 0.1)',
                                            },
                                            '&.Mui-selected': {
                                                bgcolor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                                '&:hover': {
                                                    bgcolor: theme.palette.general.primary,
                                                },
                                            },
                                        },
                                    }}
                                >
                                    <Tab>Basic Info</Tab>
                                    <Tab>Connection</Tab>
                                    <Tab>Authentication</Tab>
                                </TabList>

                                <TabPanel value={0}>
                                    <Stack spacing={2}>
                                        <FormControl>
                                            <FormLabel>Host Name</FormLabel>
                                            <Input
                                                value={form.name}
                                                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary
                                                }}
                                            />
                                        </FormControl>

                                        <FormControl>
                                            <FormLabel>Folder</FormLabel>
                                            <Input
                                                value={form.folder}
                                                onChange={(e) => setForm((prev) => ({ ...prev, folder: e.target.value }))}
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary
                                                }}
                                            />
                                        </FormControl>
                                    </Stack>
                                </TabPanel>

                                <TabPanel value={1}>
                                    <Stack spacing={2}>
                                        <FormControl error={!form.ip}>
                                            <FormLabel>Host IP</FormLabel>
                                            <Input
                                                value={form.ip}
                                                onChange={(e) => setForm((prev) => ({ ...prev, ip: e.target.value }))}
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary
                                                }}
                                            />
                                        </FormControl>

                                        <FormControl error={form.port < 1 || form.port > 65535}>
                                            <FormLabel>Host Port</FormLabel>
                                            <Input
                                                type="number"
                                                value={form.port}
                                                onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))}
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary
                                                }}
                                            />
                                        </FormControl>

                                        <FormControl error={!form.user}>
                                            <FormLabel>Host User</FormLabel>
                                            <Input
                                                value={form.user}
                                                onChange={(e) => setForm((prev) => ({ ...prev, user: e.target.value }))}
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary
                                                }}
                                            />
                                        </FormControl>
                                    </Stack>
                                </TabPanel>

                                <TabPanel value={2}>
                                    <Stack spacing={2}>
                                        <FormControl>
                                            <FormLabel>Store Password</FormLabel>
                                            <Checkbox
                                                checked={form.storePassword}
                                                onChange={(e) => handleStorePasswordChange(e.target.checked)}
                                                sx={{
                                                    color: theme.palette.text.primary,
                                                    '&.Mui-checked': {
                                                        color: theme.palette.text.primary
                                                    }
                                                }}
                                            />
                                        </FormControl>

                                        {form.storePassword && (
                                            <FormControl error={form.authMethod === 'Select Auth'}>
                                                <FormLabel>Authentication Method</FormLabel>
                                                <Select
                                                    value={form.authMethod}
                                                    onChange={(e, val) => handleAuthChange(val)}
                                                    sx={{
                                                        backgroundColor: theme.palette.general.primary,
                                                        color: theme.palette.text.primary,
                                                    }}
                                                >
                                                    <Option value="Select Auth" disabled>Select Auth</Option>
                                                    <Option value="password">Password</Option>
                                                    <Option value="rsaKey">Public Key</Option>
                                                </Select>
                                            </FormControl>
                                        )}

                                        {form.authMethod === 'password' && form.storePassword && (
                                            <FormControl error={!form.password}>
                                                <FormLabel>Password</FormLabel>
                                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                                    <Input
                                                        type={showPassword ? 'text' : 'password'}
                                                        value={form.password}
                                                        onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                                                        sx={{
                                                            backgroundColor: theme.palette.general.primary,
                                                            color: theme.palette.text.primary,
                                                            flex: 1
                                                        }}
                                                    />
                                                    <IconButton
                                                        onClick={() => setShowPassword(!showPassword)}
                                                        sx={{
                                                            color: theme.palette.text.primary,
                                                            marginLeft: 1
                                                        }}
                                                    >
                                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                                    </IconButton>
                                                </div>
                                            </FormControl>
                                        )}

                                        {form.authMethod === 'rsaKey' && form.storePassword && (
                                            <FormControl error={!form.rsaKey && !hostConfig?.rsaKey}>
                                                <FormLabel>Public Key</FormLabel>
                                                <Button
                                                    component="label"
                                                    sx={{
                                                        backgroundColor: theme.palette.general.primary,
                                                        color: theme.palette.text.primary,
                                                        width: '100%',
                                                        display: 'flex',
                                                        justifyContent: 'center',
                                                        alignItems: 'center',
                                                        height: '40px',
                                                        '&:hover': {
                                                            backgroundColor: theme.palette.general.disabled,
                                                        },
                                                    }}
                                                >
                                                    {form.rsaKey ? 'Change Public Key File' : 'Upload Public Key File'}
                                                    <Input
                                                        type="file"
                                                        onChange={handleFileChange}
                                                        sx={{ display: 'none' }}
                                                    />
                                                </Button>
                                                {hostConfig?.rsaKey && !form.rsaKey && (
                                                    <FormLabel 
                                                        sx={{ 
                                                            color: theme.palette.text.secondary,
                                                            fontSize: '0.875rem',
                                                            mt: 1,
                                                            display: 'block',
                                                            textAlign: 'center'
                                                        }}
                                                    >
                                                        Existing key detected. Upload to replace.
                                                    </FormLabel>
                                                )}
                                            </FormControl>
                                        )}
                                    </Stack>
                                </TabPanel>
                            </Tabs>

                            <Button
                                type="submit"
                                disabled={!isFormValid() || isLoading}
                                sx={{
                                    backgroundColor: theme.palette.general.primary,
                                    color: theme.palette.text.primary,
                                    '&:hover': {
                                        backgroundColor: theme.palette.general.disabled
                                    },
                                    '&:disabled': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                        color: 'rgba(255, 255, 255, 0.3)',
                                    },
                                    marginTop: 3,
                                    width: '100%',
                                    height: '40px',
                                }}
                            >
                                {isLoading ? "Saving..." : "Save Changes"}
                            </Button>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

EditHostModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    handleEditHost: PropTypes.func.isRequired,
    setIsEditHostHidden: PropTypes.func.isRequired,
    hostConfig: PropTypes.object
};

export default EditHostModal;