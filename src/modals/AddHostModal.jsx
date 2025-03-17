import PropTypes from 'prop-types';
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
    Checkbox,
    IconButton,
    Tabs,
    TabList,
    Tab,
    TabPanel
} from '@mui/joy';
import theme from '/src/theme';
import { useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const AddHostModal = ({ isHidden, form, setForm, handleAddHost, setIsAddHostHidden }) => {
    const [showPassword, setShowPassword] = useState(false);
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [activeTab, setActiveTab] = useState(0);

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
            reader.onload = (event) => {
                const keyContent = event.target.result;
                let keyType = 'UNKNOWN';
                
                // Detect key type from content
                if (keyContent.includes('BEGIN RSA PRIVATE KEY') || keyContent.includes('BEGIN RSA PUBLIC KEY')) {
                    keyType = 'RSA';
                } else if (keyContent.includes('BEGIN OPENSSH PRIVATE KEY') && keyContent.includes('ssh-ed25519')) {
                    keyType = 'ED25519';
                } else if (keyContent.includes('BEGIN EC PRIVATE KEY') || keyContent.includes('BEGIN EC PUBLIC KEY')) {
                    keyType = 'ECDSA';
                } else if (keyContent.includes('BEGIN DSA PRIVATE KEY')) {
                    keyType = 'DSA';
                }

                setForm({ 
                    ...form, 
                    privateKey: keyContent,
                    keyType: keyType,
                    authMethod: 'key'
                });
            };
            reader.readAsText(file);
        } else {
            alert('Please upload a valid SSH key file (RSA, ED25519, ECDSA, DSA, PEM, or PPK format).');
        }
    };

    const handleAuthChange = (newMethod) => {
        setForm((prev) => ({
            ...prev,
            authMethod: newMethod,
            password: "",
            privateKey: "",
            keyType: "",
            passphrase: ""
        }));
    };

    const isFormValid = () => {
        if (!form.ip || !form.user || !form.port) return false;
        const portNum = Number(form.port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;

        if (form.rememberHost) {
            if (form.authMethod === 'Select Auth') return false;
            if (form.authMethod === 'key' && !form.privateKey) return false;
            if (form.authMethod === 'password' && !form.password) return false;
        }

        return true;
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (isFormValid()) {
            if (!form.rememberHost) {
                handleAddHost();
            } else {
                handleAddHost();
            }

            setForm({
                name: '',
                folder: '',
                ip: '',
                user: '',
                password: '',
                privateKey: '',
                keyType: '',
                port: 22,
                authMethod: 'Select Auth',
                rememberHost: false,
                storePassword: true,
            });
            setIsAddHostHidden(true);
        }
    };

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsAddHostHidden(true)}
                   sx={{
                       display: 'flex',
                       justifyContent: 'center',
                       alignItems: 'center',
                   }}
            >
                <ModalDialog
                    layout="center"
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
                    <DialogTitle sx={{ mb: 2 }}>Add Host</DialogTitle>
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
                                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                        </FormControl>
                                        <FormControl>
                                            <FormLabel>Folder</FormLabel>
                                            <Input
                                                value={form.folder || ''}
                                                onChange={(e) => setForm({ ...form, folder: e.target.value })}
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
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
                                                onChange={(e) => setForm({ ...form, ip: e.target.value })}
                                                required
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                        </FormControl>
                                        <FormControl error={!form.user}>
                                            <FormLabel>Host User</FormLabel>
                                            <Input
                                                value={form.user}
                                                onChange={(e) => setForm({ ...form, user: e.target.value })}
                                                required
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                        </FormControl>
                                        <FormControl error={form.port < 1 || form.port > 65535}>
                                            <FormLabel>Host Port</FormLabel>
                                            <Input
                                                type="number"
                                                value={form.port}
                                                onChange={(e) => setForm({ ...form, port: e.target.value })}
                                                min={1}
                                                max={65535}
                                                required
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                        </FormControl>
                                    </Stack>
                                </TabPanel>

                                <TabPanel value={2}>
                                    <Stack spacing={2}>
                                        <FormControl>
                                            <FormLabel>Remember Host</FormLabel>
                                            <Checkbox
                                                checked={form.rememberHost}
                                                onChange={(e) => setForm({ 
                                                    ...form, 
                                                    rememberHost: e.target.checked,

                                                    ...((!e.target.checked) && {
                                                        authMethod: 'Select Auth',
                                                        password: '',
                                                        privateKey: '',
                                                        keyType: '',
                                                        passphrase: '',
                                                        storePassword: true
                                                    })
                                                })}
                                                sx={{
                                                    color: theme.palette.text.primary,
                                                    '&.Mui-checked': {
                                                        color: theme.palette.text.primary,
                                                    },
                                                }}
                                            />
                                        </FormControl>
                                        {form.rememberHost && (
                                            <>
                                                <FormControl>
                                                    <FormLabel>Store Password</FormLabel>
                                                    <Checkbox
                                                        checked={form.storePassword}
                                                        onChange={(e) => setForm({ ...form, storePassword: e.target.checked })}
                                                        sx={{
                                                            color: theme.palette.text.primary,
                                                            '&.Mui-checked': {
                                                                color: theme.palette.text.primary,
                                                            },
                                                        }}
                                                    />
                                                </FormControl>
                                                <FormControl error={!form.authMethod || form.authMethod === 'Select Auth'}>
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
                                                    <FormControl error={!form.password}>
                                                        <FormLabel>Password</FormLabel>
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            <Input
                                                                type={showPassword ? 'text' : 'password'}
                                                                value={form.password}
                                                                onChange={(e) => setForm({ ...form, password: e.target.value })}
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
                                                        <FormControl error={!form.privateKey}>
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
                                                                {form.privateKey ? `Change ${form.keyType || 'SSH'} Key File` : 'Upload SSH Key File'}
                                                                <Input
                                                                    type="file"
                                                                    onChange={handleFileChange}
                                                                    sx={{ display: 'none' }}
                                                                />
                                                            </Button>
                                                        </FormControl>
                                                        {form.privateKey && (
                                                            <FormControl>
                                                                <FormLabel>Key Passphrase (optional)</FormLabel>
                                                                <Input
                                                                    type={showPassphrase ? "text" : "password"}
                                                                    value={form.passphrase || ''}
                                                                    onChange={(e) => setForm(prev => ({ ...prev, passphrase: e.target.value }))}
                                                                    endDecorator={
                                                                        <IconButton onClick={() => setShowPassphrase(!showPassphrase)}>
                                                                            {showPassphrase ? <VisibilityOff /> : <Visibility />}
                                                                        </IconButton>
                                                                    }
                                                                />
                                                            </FormControl>
                                                        )}
                                                    </Stack>
                                                )}
                                            </>
                                        )}
                                    </Stack>
                                </TabPanel>
                            </Tabs>

                            <Button
                                type="submit"
                                disabled={!isFormValid()}
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
                                    marginTop: 3,
                                    width: '100%',
                                    height: '40px',
                                }}
                            >
                                Add Host
                            </Button>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

AddHostModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    form: PropTypes.shape({
        name: PropTypes.string,
        folder: PropTypes.string,
        ip: PropTypes.string.isRequired,
        user: PropTypes.string.isRequired,
        password: PropTypes.string,
        privateKey: PropTypes.string,
        keyType: PropTypes.string,
        port: PropTypes.number.isRequired,
        authMethod: PropTypes.string.isRequired,
        rememberHost: PropTypes.bool,
        storePassword: PropTypes.bool,
    }).isRequired,
    setForm: PropTypes.func.isRequired,
    handleAddHost: PropTypes.func.isRequired,
    setIsAddHostHidden: PropTypes.func.isRequired,
};

export default AddHostModal;