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
    Checkbox
} from '@mui/joy';
import theme from '/src/theme';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const EditHostModal = ({ isHidden, form, setForm, handleEditHost, setIsEditHostHidden, hostConfig }) => {
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        if (hostConfig) {
            const storePassword = hostConfig.password || hostConfig.rsaKey;

            setForm({
                ...form,
                name: hostConfig.name || '',
                ip: hostConfig.ip || '',
                user: hostConfig.user || '',
                password: storePassword && hostConfig.password ? hostConfig.password : '',
                rsaKey: '',
                port: Number(hostConfig.port) || 22,
                authMethod: hostConfig.rsaKey ? 'rsaKey' : (storePassword ? 'password' : 'Select Auth'),
                rememberHost: hostConfig.rememberHost || true,
                storePassword: storePassword ?? false
            });
        }
    }, [hostConfig, setForm]);

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
            storePassword: checked,
            authMethod: checked ? 'password' : 'Select Auth'
        }));
    };

    const isFormValid = () => {
        const { ip, user, port, authMethod, password, rsaKey, storePassword } = form;
        if (!ip?.trim() || !user?.trim() || !port) return false;
        const portNum = Number(port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;

        if (storePassword && authMethod === 'password' && !password.trim()) return false;
        if (storePassword && authMethod === 'rsaKey' && !rsaKey && !hostConfig?.rsaKey) return false;
        if (storePassword && authMethod === 'Select Auth') return false;

        return true;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (isFormValid()) {
            const { authMethod, password, rsaKey, storePassword, ...rest } = form;
            handleEditHost({
                ...rest,
                authMethod,
                password: authMethod === 'password' && storePassword ? password : '',
                rsaKey: authMethod === 'rsaKey' ? rsaKey : ''
            });
        }
    };

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsEditHostHidden(true)}
                   sx={{
                       overflowX: 'hidden',
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
                        maxWidth: '400px',
                        width: '100%',
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                        mx: 2,
                    }}
                >
                    <DialogTitle>Edit Host</DialogTitle>
                    <DialogContent>
                        <form onSubmit={handleSubmit}>
                            <Stack spacing={2} sx={{ width: '100%', overflow: 'hidden' }}>
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

                                {form.storePassword && form.authMethod !== 'Select Auth' && (
                                    <FormControl error={form.authMethod === 'Select Auth'}>
                                        <FormLabel>Authentication Method</FormLabel>
                                        <Select
                                            value={form.authMethod}
                                            onChange={(e, val) => handleAuthChange(val)}
                                            sx={{
                                                backgroundColor:
                                                    form.authMethod === 'Select Auth'
                                                        ? theme.palette.general.tertiary
                                                        : theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                                '&:hover': {
                                                    backgroundColor: theme.palette.general.disabled
                                                }
                                            }}
                                        >
                                            <Option value="Select Auth" disabled>Select Auth</Option>
                                            <Option value="password">Password</Option>
                                            <Option value="rsaKey">RSA Key</Option>
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
                                                onChange={(e) =>
                                                    setForm((prev) => ({ ...prev, password: e.target.value }))
                                                }
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
                                    <FormControl
                                        error={!form.rsaKey && !hostConfig?.rsaKey}
                                        sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
                                    >
                                        <FormLabel>RSA Key</FormLabel>
                                        <Input
                                            type="file"
                                            onChange={handleFileChange}
                                            sx={{
                                                backgroundColor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                                alignItems: 'center'
                                            }}
                                        />
                                        {hostConfig?.rsaKey && !form.rsaKey && (
                                            <FormLabel sx={{ color: theme.palette.text.secondary }}>
                                                Existing key detected. Upload to replace.
                                            </FormLabel>
                                        )}
                                    </FormControl>
                                )}

                                <FormControl error={form.port < 1 || form.port > 65535}>
                                    <FormLabel>Host Port</FormLabel>
                                    <Input
                                        value={form.port}
                                        onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))}
                                        sx={{
                                            backgroundColor: theme.palette.general.primary,
                                            color: theme.palette.text.primary
                                        }}
                                    />
                                </FormControl>

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

                                <Button
                                    type="submit"
                                    disabled={!isFormValid()}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        color: theme.palette.text.primary,
                                        '&:hover': {
                                            backgroundColor: theme.palette.general.disabled
                                        }
                                    }}
                                >
                                    Save Changes
                                </Button>
                            </Stack>
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