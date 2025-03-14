import PropTypes from 'prop-types';
import { useEffect } from 'react';
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
    Checkbox
} from '@mui/joy';
import theme from '/src/theme';

const EditHostModal = ({ isHidden, form, setForm, handleEditHost, setIsEditHostHidden, hostConfig }) => {
    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.name.endsWith('.rsa') || file.name.endsWith('.key') || file.name.endsWith('.pem') || file.name.endsWith('.der') || file.name.endsWith('.p8') || file.name.endsWith('.ssh')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    setForm({ ...form, rsaKey: event.target.result });
                };
                reader.readAsText(file);
            } else {
                alert("Please upload a valid RSA private key file.");
            }
        }
    };

    const isFormValid = () => {
        if (form.authMethod === 'Select Auth') return false;
        if (!form.ip || !form.user || !form.port) return false;
        if (form.authMethod === 'rsaKey' && !form.rsaKey) return false;
        if (form.authMethod === 'password' && !form.password) return false;
        return true;
    };

    useEffect(() => {
        if (hostConfig) {
            setForm({
                name: hostConfig.name || '',
                ip: hostConfig.ip || '',
                user: hostConfig.user || '',
                password: hostConfig.password || '',
                rsaKey: hostConfig.rsaKey || '',
                port: Number(hostConfig.port) || 22,
                authMethod: hostConfig.password ? 'password' : 'rsaKey',
                rememberHost: hostConfig.rememberHost || false,
            });
        }
    }, [hostConfig, setForm]);

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsEditHostHidden(true)}>
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
                    <DialogTitle>Edit Host</DialogTitle>
                    <DialogContent>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (isFormValid()) handleEditHost();
                            }}
                        >
                            <Stack spacing={2} sx={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}>
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
                                <FormControl error={!form.authMethod || form.authMethod === 'Select Auth'}>
                                    <FormLabel>Authentication Method</FormLabel>
                                    <Select
                                        value={form.authMethod || 'Select Auth'}
                                        onChange={(e, newValue) => setForm({ ...form, authMethod: newValue })}
                                        required
                                        sx={{
                                            backgroundColor: !form.authMethod || form.authMethod === 'Select Auth' ? theme.palette.general.tertiary : theme.palette.general.primary,
                                            color: theme.palette.text.primary,
                                            '&:hover': {
                                                backgroundColor: theme.palette.general.disabled,
                                            },
                                        }}
                                    >
                                        <Option value="Select Auth" disabled>
                                            Select Auth
                                        </Option>
                                        <Option value="password">Password</Option>
                                        <Option value="rsaKey">RSA Key</Option>
                                    </Select>
                                </FormControl>
                                {form.authMethod === 'password' && (
                                    <FormControl error={!form.password}>
                                        <FormLabel>Host Password</FormLabel>
                                        <Input
                                            type="password"
                                            value={form.password}
                                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                                            required
                                            sx={{
                                                backgroundColor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                            }}
                                        />
                                    </FormControl>
                                )}
                                {form.authMethod === 'rsaKey' && (
                                    <FormControl error={!form.rsaKey}>
                                        <FormLabel>RSA Key</FormLabel>
                                        <Input
                                            type="file"
                                            onChange={handleFileChange}
                                            required
                                            sx={{
                                                backgroundColor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                                padding: 1,
                                                textAlign: 'center',
                                                width: '100%',
                                                minWidth: 'auto',
                                                minHeight: 'auto',
                                            }}
                                        />
                                    </FormControl>
                                )}
                                <FormControl error={form.port < 1 || form.port > 65535}>
                                    <FormLabel>Host Port</FormLabel>
                                    <Input
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
                                    Edit Host
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
    form: PropTypes.shape({
        name: PropTypes.string,
        ip: PropTypes.string.isRequired,
        user: PropTypes.string.isRequired,
        password: PropTypes.string,
        rsaKey: PropTypes.string,
        port: PropTypes.number.isRequired,
        authMethod: PropTypes.string.isRequired,
        rememberHost: PropTypes.bool,
    }).isRequired,
    setForm: PropTypes.func.isRequired,
    handleEditHost: PropTypes.func.isRequired,
    setIsEditHostHidden: PropTypes.func.isRequired,
    hostConfig: PropTypes.object,
};

export default EditHostModal;