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

const EditHostModal = ({ isHidden, hostConfig, setIsEditHostHidden, handleEditHost }) => {
    const [form, setForm] = useState({
        name: hostConfig?.name || '',
        folder: hostConfig?.folder || '',
        ip: hostConfig?.ip || '',
        user: hostConfig?.user || '',
        port: hostConfig?.port || '',
        password: '',
        sshKey: hostConfig?.sshKey || '',
        keyType: hostConfig?.keyType || '',
        authMethod: hostConfig?.authMethod || 'Select Auth',
        storePassword: true,
        rememberHost: true
    });
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
                sshKey: hostConfig.sshKey || '',
                keyType: hostConfig.keyType || '',
                port: hostConfig.port || 22,
                authMethod: hostConfig.password ? 'password' : hostConfig.sshKey ? 'key' : 'Select Auth',
                rememberHost: true,
                storePassword: !!(hostConfig.password || hostConfig.sshKey),
            });
        }
    }, [isHidden, hostConfig]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        const supportedKeyTypes = {
            'id_rsa': 'RSA',
            'id_ed25519': 'ED25519',
            'id_ecdsa': 'ECDSA',
            'id_dsa': 'DSA',
            '.pem': 'PEM',
            '.key': 'KEY',
            '.ppk': 'PPK'
        };

        const isValidKeyFile = Object.keys(supportedKeyTypes).some(ext => 
            file.name.toLowerCase().includes(ext) || file.name.endsWith('.pub')
        );

        if (isValidKeyFile) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const keyContent = evt.target.result;
                let keyType = 'UNKNOWN';

                if (keyContent.includes('BEGIN RSA PRIVATE KEY') || keyContent.includes('BEGIN RSA PUBLIC KEY')) {
                    keyType = 'RSA';
                } else if (keyContent.includes('BEGIN OPENSSH PRIVATE KEY') && keyContent.includes('ssh-ed25519')) {
                    keyType = 'ED25519';
                } else if (keyContent.includes('BEGIN EC PRIVATE KEY') || keyContent.includes('BEGIN EC PUBLIC KEY')) {
                    keyType = 'ECDSA';
                } else if (keyContent.includes('BEGIN DSA PRIVATE KEY')) {
                    keyType = 'DSA';
                }

                setForm((prev) => ({ 
                    ...prev, 
                    sshKey: keyContent,
                    keyType: keyType,
                    authMethod: 'key'
                }));
            };
            reader.readAsText(file);
        } else {
            alert('Please upload a valid SSH key file (RSA, ED25519, ECDSA, DSA, PEM, or PPK format).');
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
            sshKey: checked ? prev.sshKey : "",
            authMethod: checked ? prev.authMethod : "Select Auth"
        }));
    };

    const isFormValid = () => {
        const { ip, user, port, authMethod, password, sshKey } = form;

        if (!ip?.trim() || !user?.trim() || !port) return false;

        const portNum = Number(port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;

        if (form.storePassword) {
            if (authMethod === 'Select Auth') return false;
            if (authMethod === 'password' && !password?.trim()) return false;
            if (authMethod === 'sshKey' && !sshKey?.trim()) return false;
        }

        return true;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (isLoading) return;

        setIsLoading(true);
        try {
            const newConfig = {
                name: form.name || form.ip,
                folder: form.folder,
                ip: form.ip,
                user: form.user,
                port: String(form.port),
            };

            if (form.storePassword) {
                if (form.authMethod === 'password') {
                    newConfig.password = form.password;
                } else if (form.authMethod === 'key') {
                    newConfig.sshKey = form.sshKey;
                    newConfig.keyType = form.keyType;
                }
            }

            await handleEditHost(hostConfig, newConfig);
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
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
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
                        padding: 0,
                        borderRadius: 10,
                        maxWidth: '500px',
                        width: '100%',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        boxSizing: 'border-box',
                        mx: 2,
                    }}
                >
                    <Tabs 
                        value={activeTab} 
                        onChange={(e, val) => setActiveTab(val)}
                        sx={{ 
                            width: '100%',
                            mb: 0,
                            backgroundColor: theme.palette.general.tertiary,
                        }}
                    >
                        <TabList
                            sx={{
                                width: '100%',
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
                            <Tab sx={{ flex: 1 }}>Basic Info</Tab>
                            <Tab sx={{ flex: 1 }}>Connection</Tab>
                            <Tab sx={{ flex: 1 }}>Authentication</Tab>
                        </TabList>

                        <div style={{ padding: '24px', backgroundColor: theme.palette.general.tertiary }}>
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
                                            checked={Boolean(form.storePassword)}
                                            onChange={(e) => handleStorePasswordChange(e.target.checked)}
                                            sx={{
                                                color: theme.palette.text.primary,
                                                '&.Mui-checked': {
                                                    color: theme.palette.text.primary,
                                                },
                                            }}
                                        />
                                    </FormControl>

                                    {form.storePassword && (
                                        <>
                                            <FormControl error={form.storePassword && (!form.authMethod || form.authMethod === 'Select Auth')}>
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
                                                    <Option value="key">SSH Key</Option>
                                                </Select>
                                            </FormControl>

                                            {form.authMethod === 'password' && (
                                                <FormControl error={form.storePassword && !form.password}>
                                                    <FormLabel>Password</FormLabel>
                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                        <Input
                                                            type={showPassword ? 'text' : 'password'}
                                                            value={form.password}
                                                            onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
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

                                            {form.authMethod === 'key' && (
                                                <Stack spacing={2}>
                                                    <FormControl error={form.storePassword && !form.sshKey}>
                                                        <FormLabel>SSH Key</FormLabel>
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
                                                            {form.sshKey ? `Change ${form.keyType || 'SSH'} Key File` : 'Upload SSH Key File'}
                                                            <Input
                                                                type="file"
                                                                onChange={handleFileChange}
                                                                sx={{ display: 'none' }}
                                                            />
                                                        </Button>
                                                        {hostConfig?.sshKey && !form.sshKey && (
                                                            <FormLabel 
                                                                sx={{ 
                                                                    color: theme.palette.text.secondary,
                                                                    fontSize: '0.875rem',
                                                                    mt: 1,
                                                                    display: 'block',
                                                                    textAlign: 'center'
                                                                }}
                                                            >
                                                                Existing {hostConfig.keyType || 'SSH'} key detected. Upload to replace.
                                                            </FormLabel>
                                                        )}
                                                    </FormControl>
                                                </Stack>
                                            )}
                                        </>
                                    )}
                                </Stack>
                            </TabPanel>
                        </div>

                        <Button
                            onClick={handleSubmit}
                            disabled={isLoading || !isFormValid()}
                            sx={{
                                backgroundColor: theme.palette.general.primary,
                                color: theme.palette.text.primary,
                                '&:hover': {
                                    backgroundColor: theme.palette.general.disabled,
                                },
                                '&:disabled': {
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    color: 'rgba(255, 255, 255, 0.3)',
                                },
                                marginTop: 1,
                                width: '100%',
                                height: '40px',
                            }}
                        >
                            {isLoading ? "Saving changes..." : "Save changes"}
                        </Button>
                    </Tabs>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

EditHostModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    hostConfig: PropTypes.object,
    setIsEditHostHidden: PropTypes.func.isRequired,
    handleEditHost: PropTypes.func.isRequired
};

export default EditHostModal;