import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import { Modal, Button, DialogTitle, DialogContent, ModalDialog } from '@mui/joy';
import theme from './theme';

const ErrorModal = ({ isHidden, errorMessage, setIsErrorHidden }) => {
    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsErrorHidden(true)}>
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
                        justifyContent: "center",
                        gap: 1,
                    }}
                >
                    <DialogTitle sx={{ marginBottom: 1.5 }}>Error</DialogTitle>
                    <DialogContent sx={{ color: theme.palette.text.primary }}>
                        {errorMessage}
                    </DialogContent>
                    <Button
                        onClick={() => setIsErrorHidden(true)}
                        sx={{
                            backgroundColor: theme.palette.general.primary,
                            '&:hover': {
                                backgroundColor: theme.palette.general.disabled,
                            },
                        }}
                    >
                        Close
                    </Button>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

ErrorModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    errorMessage: PropTypes.string.isRequired,
    setIsErrorHidden: PropTypes.func.isRequired,
};

export default ErrorModal;