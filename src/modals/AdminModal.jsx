import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { CssVarsProvider } from '@mui/joy/styles';
import {
    Modal,
    Button,
    FormControl,
    FormLabel,
    Input,
    DialogTitle,
    DialogContent,
    ModalDialog,
    List,
    ListItem,
    Typography,
    Divider,
    Switch
} from '@mui/joy';
import theme from '/src/theme';

const AdminModal = ({ 
    isHidden, 
    setIsHidden, 
    handleAddAdmin, 
    handleToggleAccountCreation,
    checkAccountCreationStatus,
    getAllAdmins 
}) => {
    const [username, setUsername] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [accountCreationEnabled, setAccountCreationEnabled] = useState(true);
    const [admins, setAdmins] = useState([]);

    useEffect(() => {
        if (!isHidden) {
            loadData();
        }
    }, [isHidden]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const status = await checkAccountCreationStatus();
            setAccountCreationEnabled(status.allowed);
            
            const adminList = await getAllAdmins();
            setAdmins(adminList);
        } catch (error) {
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isLoading || !username.trim()) return;
        
        setIsLoading(true);
        try {
            await handleAddAdmin(username.trim());
            setUsername('');
            await loadData();
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggle = async () => {
        setIsLoading(true);
        try {
            const result = await handleToggleAccountCreation(!accountCreationEnabled);
            if (result !== null) {
                setAccountCreationEnabled(result);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleModalClick = (event) => {
        event.stopPropagation();
    };

    return (
        <CssVarsProvider theme={theme}>
            <Modal 
                open={!isHidden} 
                onClose={() => !isLoading && setIsHidden(true)}
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
                    onClick={handleModalClick}
                    sx={{
                        backgroundColor: theme.palette.general.tertiary,
                        borderColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                        padding: 3,
                        borderRadius: 10,
                        maxWidth: '400px',
                        width: '100%',
                        boxSizing: 'border-box',
                        mx: 2,
                    }}
                >
                    <DialogTitle sx={{ mb: 2 }}>Admin Panel</DialogTitle>
                    <DialogContent>
                        <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
                            <FormControl sx={{ mb: 3 }}>
                                <FormLabel>Add a new admin</FormLabel>
                                <Input
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Enter username"
                                    onClick={(e) => e.stopPropagation()}
                                    sx={{
                                        backgroundColor: theme.palette.general.primary,
                                        color: theme.palette.text.primary,
                                        mb: 2
                                    }}
                                />
                                <Button
                                    type="submit"
                                    disabled={!username.trim() || isLoading}
                                    onClick={(e) => e.stopPropagation()}
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
                                        width: '100%',
                                        height: '40px',
                                    }}
                                >
                                    {isLoading ? "Adding..." : "Add Admin"}
                                </Button>
                            </FormControl>

                            <Divider sx={{ my: 3 }} />

                            <FormControl sx={{ mb: 3 }}>
                                <FormLabel>Account Creation</FormLabel>
                                <div style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'space-between',
                                    backgroundColor: theme.palette.general.primary,
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    marginBottom: '8px'
                                }}>
                                    <Typography sx={{ color: '#ffffff' }}>
                                        {accountCreationEnabled ? "Enabled" : "Disabled"}
                                    </Typography>
                                    <Switch
                                        checked={accountCreationEnabled}
                                        onChange={handleToggle}
                                        disabled={isLoading}
                                    />
                                </div>
                            </FormControl>

                            <Divider sx={{ my: 3 }} />

                            <Typography level="body1" sx={{ mb: 2, color: '#ffffff' }}>Current Admins:</Typography>
                            <List sx={{ 
                                backgroundColor: theme.palette.general.primary, 
                                borderRadius: '8px',
                                maxHeight: '150px',
                                overflow: 'auto'
                            }}>
                                {admins.length > 0 ? (
                                    admins.map((admin, index) => (
                                        <ListItem key={index} sx={{ py: 1, color: '#ffffff' }}>
                                            {admin.username || admin}
                                        </ListItem>
                                    ))
                                ) : (
                                    <ListItem sx={{ py: 1, color: '#ffffff' }}>No admins found</ListItem>
                                )}
                            </List>

                            <Button
                                onClick={() => !isLoading && setIsHidden(true)}
                                sx={{
                                    backgroundColor: theme.palette.general.primary,
                                    color: theme.palette.text.primary,
                                    '&:hover': {
                                        backgroundColor: theme.palette.general.disabled
                                    },
                                    width: '100%',
                                    marginTop: 3,
                                    height: '40px',
                                }}
                            >
                                Close
                            </Button>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

AdminModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    setIsHidden: PropTypes.func.isRequired,
    handleAddAdmin: PropTypes.func.isRequired,
    handleToggleAccountCreation: PropTypes.func.isRequired,
    checkAccountCreationStatus: PropTypes.func.isRequired,
    getAllAdmins: PropTypes.func.isRequired
};

export default AdminModal; 