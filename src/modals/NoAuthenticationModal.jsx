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
import { useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

const NoAuthenticationModal = ({ isHidden, form, setForm, setIsNoAuthHidden, handleAuthSubmit }) => {
    const [showPassword, setShowPassword] = useState(false);

    const isFormValid = () => {
        if (form.authMethod === 'Select Auth') return false;
        if (form.authMethod === 'rsaKey' && !form.rsaKey) return false;
        if (form.authMethod === 'password' && !form.password) return false;
        return true;
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (isFormValid()) {
            handleAuthSubmit(form);
            setForm({ authMethod: 'Select Auth', password: '', rsaKey: '' });
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
                disableBackdropClic
            >
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
                    <DialogTitle>Authentication Required</DialogTitle>
                    <DialogContent>
                        <form onSubmit={handleSubmit}>
                            <Stack spacing={2} sx={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}>
                                <FormControl error={!form.authMethod || form.authMethod === 'Select Auth'}>
                                    <FormLabel sx={{ color: theme.palette.text.primary }}>Authentication Method</FormLabel>
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
                                        <Option value="Select Auth" disabled>Select Auth</Option>
                                        <Option value="password">Password</Option>
                                        <Option value="rsaKey">RSA Key</Option>
                                    </Select>
                                </FormControl>
                                {form.authMethod === 'password' && (
                                    <FormControl error={!form.password}>
                                        <FormLabel sx={{ color: theme.palette.text.primary }}>Password</FormLabel>
                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                            <Input
                                                type={showPassword ? 'text' : 'password'}
                                                value={form.password}
                                                onChange={(e) => setForm({ ...form, password: e.target.value })}
                                                required
                                                sx={{
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                    flex: 1,
                                                }}
                                            />
                                            <IconButton
                                                onClick={() => setShowPassword(!showPassword)}
                                                sx={{
                                                    color: theme.palette.text.primary,
                                                    marginLeft: 1,
                                                }}
                                            >
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </div>
                                    </FormControl>
                                )}
                                {form.authMethod === 'rsaKey' && (
                                    <FormControl error={!form.rsaKey}>
                                        <FormLabel sx={{ color: theme.palette.text.primary }}>RSA Key</FormLabel>
                                        <Input
                                            type="file"
                                            onChange={(e) => {
                                                const file = e.target.files[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = (event) => {
                                                        setForm({ ...form, rsaKey: event.target.result });
                                                    };
                                                    reader.readAsText(file);
                                                }
                                            }}
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
                                <Button
                                    type="submit"
                                    disabled={!isFormValid()}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        color: theme.palette.text.primary,
                                        '&:hover': {
                                            backgroundColor: theme.palette.general.disabled,
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
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    setIsNoAuthHidden: PropTypes.func.isRequired,
    handleAuthSubmit: PropTypes.func.isRequired,
};

export default NoAuthenticationModal;