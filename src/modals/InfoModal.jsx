import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import { Modal, Button, DialogTitle, DialogContent, ModalDialog } from '@mui/joy';
import theme from '/src/theme';

const InfoModal = ({ isHidden, infoMessage, title, setIsInfoHidden }) => {
    return (
        <CssVarsProvider theme={theme}>
            <Modal 
                open={!isHidden} 
                onClose={() => setIsInfoHidden(true)}
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
                        padding: 2,
                        borderRadius: 6,
                        width: "auto",
                        maxWidth: "450px",
                        minWidth: "350px",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 1,
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)"
                    }}
                >
                    <DialogTitle sx={{ marginBottom: 1 }}>{title || "Information"}</DialogTitle>
                    <DialogContent sx={{ 
                        color: theme.palette.text.primary,
                        textAlign: 'center',
                        width: '100%'
                    }}>
                        {infoMessage}
                    </DialogContent>
                    <Button
                        onClick={() => setIsInfoHidden(true)}
                        sx={{
                            backgroundColor: theme.palette.general.primary,
                            '&:hover': {
                                backgroundColor: theme.palette.general.disabled,
                            },
                            minWidth: '100px'
                        }}
                    >
                        Close
                    </Button>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

InfoModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    infoMessage: PropTypes.string.isRequired,
    title: PropTypes.string,
    setIsInfoHidden: PropTypes.func.isRequired,
};

export default InfoModal; 