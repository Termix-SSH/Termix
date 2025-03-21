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
import {useEffect, useState} from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const NoAuthenticationModal = ({ isHidden, form, setForm, setIsNoAuthHidden, handleAuthSubmit }) => {
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (!form.authMethod) {
            setForm(prev => ({
                ...prev,
                authMethod: 'Select Auth',
                password: '',
                sshKey: '',
                keyType: '',
            }));
        }
    }, []);

    const isFormValid = () => {
        if (!form.authMethod || form.authMethod === 'Select Auth') return false;
        if (form.authMethod === 'sshKey' && !form.sshKey) return false;
        if (form.authMethod === 'password' && !form.password) return false;
        return true;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if(isFormValid()) {
            handleAuthSubmit(form);
            setForm (prev => ({
                ...prev,
                authMethod: 'Select Auth',
                password: '',
                sshKey: '',
                keyType: '',
            }))
        }
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
                    sshKey: keyContent,
                    keyType: keyType,
                    authMethod: 'sshKey'
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
                onClose={(e, reason) => {
                    if (reason !== 'backdropClick') {
                        setIsNoAuthHidden(true);
                    }
                }}
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
                    <DialogTitle sx={{ mb: 2 }}>Authentication Required</DialogTitle>
                    <DialogContent>
                        <form onSubmit={handleSubmit}>
                            <Stack spacing={2}>
                                <FormControl error={!form.authMethod || form.authMethod === 'Select Auth'}>
                                    <FormLabel>Authentication Method</FormLabel>
                                    <Select
                                        value={form.authMethod || 'Select Auth'}
                                        onChange={(e, val) => setForm(prev => ({ 
                                            ...prev, 
                                            authMethod: val, 
                                            password: '', 
                                            sshKey: '',
                                            keyType: '',
                                        }))}
                                        sx={{
                                            backgroundColor: theme.palette.general.primary,
                                            color: theme.palette.text.primary,
                                        }}
                                    >
                                        <Option value="Select Auth" disabled>Select Auth</Option>
                                        <Option value="password">Password</Option>
                                        <Option value="sshKey">SSH Key</Option >
                                    </Select>
                                </FormControl>

                                {form.authMethod === 'password' && (
                                    <FormControl error={!form.password}>
                                        <FormLabel>Password</FormLabel>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <Input
                                                type={showPassword ? "text" : "password"}
                                                value={form.password || ''}
                                                onChange={(e) => setForm({...form, password: e.target.value})}
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
                                )}

                                {form.authMethod === 'sshKey' && (
                                    <Stack spacing={2}>
                                        <FormControl error={!form.sshKey}>
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
                                        </FormControl>
                                    </Stack>
                                )}

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
                                        marginTop: 2,
                                        height: '40px',
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
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    setIsNoAuthHidden: PropTypes.func.isRequired,
    handleAuthSubmit: PropTypes.func.isRequired,
};

export default NoAuthenticationModal;