import PropTypes from 'prop-types';
import { useState } from 'react';
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
} from '@mui/joy';
import theme from '/src/theme';

const ShareHostModal = ({ isHidden, setIsHidden, handleShare, hostConfig }) => {
    const [username, setUsername] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isLoading || !username.trim()) return;
        
        setIsLoading(true);
        try {
            await handleShare(hostConfig._id, username.trim());
            setUsername('');
            setIsHidden(true);
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
                    <DialogTitle sx={{ mb: 2 }}>Share Host</DialogTitle>
                    <DialogContent>
                        <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
                            <FormControl error={!username.trim()}>
                                <FormLabel>Username to share with</FormLabel>
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
                            </FormControl>

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
                                {isLoading ? "Sharing..." : "Share"}
                            </Button>
                        </form>
                    </DialogContent>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

ShareHostModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    setIsHidden: PropTypes.func.isRequired,
    handleShare: PropTypes.func.isRequired,
    hostConfig: PropTypes.object
};

export default ShareHostModal; 