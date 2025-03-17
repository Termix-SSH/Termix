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
    IconButton,
    Select,
    Option,
} from '@mui/joy';
import theme from '/src/theme';
import { useState, useEffect } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const NoAuthenticationModal = ({ isHidden, setIsHidden, onAuthenticate }) => {
    const [form, setForm] = useState({
        authMethod: 'Select Auth',
        password: '',
        privateKey: '',
        keyType: '',
        passphrase: ''
    });
    const [showPassword, setShowPassword] = useState(false);
    const [showPassphrase, setShowPassphrase] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        onAuthenticate({
            authMethod: form.authMethod,
            password: form.password,
            privateKey: form.privateKey,
            keyType: form.keyType,
            passphrase: form.passphrase
        });
        setIsHidden(true);
    };

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

    return (
        <CssVarsProvider theme={theme}>
            <Modal
                open={!isHidden}
                onClose={() => setIsHidden(true)}
            >
                <ModalDialog
                    sx={{
                        backgroundColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                    }}
                >
                    <DialogTitle sx={{ mb: 2 }}>Authentication Required</DialogTitle>
                    <DialogContent>
                        <form onSubmit={handleSubmit}>
                            <Stack spacing={2}>
                                <FormControl error={!form.authMethod || form.authMethod === 'Select Auth'}>
                                    <FormLabel>Authentication Method</FormLabel>
                                    <Select
                                        value={form.authMethod}
                                        onChange={(e, val) => setForm(prev => ({ 
                                            ...prev, 
                                            authMethod: val, 
                                            password: '', 
                                            privateKey: '',
                                            keyType: '',
                                            passphrase: ''
                                        }))}
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
                                        <Input
                                            type={showPassword ? "text" : "password"}
                                            value={form.password}
                                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                                            endDecorator={
                                                <IconButton onClick={() => setShowPassword(!showPassword)}>
                                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                                </IconButton>
                                            }
                                        />
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

                                <Button
                                    type="submit"
                                    disabled={!form.authMethod || form.authMethod === 'Select Auth' || 
                                            (form.authMethod === 'password' && !form.password) ||
                                            (form.authMethod === 'key' && !form.privateKey)}
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
                                    }}
                                >
                                    Connect
                                </Button>
                            </Stack>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

NoAuthenticationModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    setIsHidden: PropTypes.func.isRequired,
    onAuthenticate: PropTypes.func.isRequired,
};

export default NoAuthenticationModal;