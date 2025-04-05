import PropTypes from 'prop-types';
import { Modal, Button } from "@mui/joy";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import theme from "../theme";

export default function ConfirmDeleteModal({
    isHidden,
    title,
    message,
    itemName,
    onConfirm,
    onCancel,
}) {
    return (
        <Modal
            open={!isHidden}
            onClose={onCancel}
            sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <div style={{
                backgroundColor: theme.palette.general.tertiary,
                borderColor: theme.palette.general.secondary,
                borderWidth: "1px",
                borderStyle: "solid",
                borderRadius: "0.5rem",
                width: "400px",
                overflow: "hidden",
            }}>
                <div className="p-5 flex flex-col gap-4">
                    <h2 className="text-xl font-bold text-center text-white">{title}</h2>
                    
                    <p className="text-center py-2 text-white">
                        {message} 
                        {itemName && <span className="font-bold block mt-1 text-white">{itemName}</span>}
                    </p>
                    
                    <div className="flex gap-3 mt-2">
                        <Button
                            fullWidth
                            onClick={onCancel}
                            sx={{
                                backgroundColor: theme.palette.general.tertiary,
                                color: "white",
                                "&:hover": {
                                    backgroundColor: theme.palette.general.secondary,
                                },
                                height: "40px",
                                border: `1px solid ${theme.palette.general.secondary}`,
                            }}
                        >
                            Cancel
                        </Button>

                        <Button
                            fullWidth
                            color="danger"
                            onClick={onConfirm}
                            startDecorator={<DeleteForeverIcon />}
                            sx={{
                                backgroundColor: "#c53030",
                                color: "white",
                                "&:hover": {
                                    backgroundColor: "#9b2c2c",
                                },
                                height: "40px",
                                border: "1px solid #9b2c2c",
                            }}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

ConfirmDeleteModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    title: PropTypes.string.isRequired,
    message: PropTypes.string.isRequired,
    itemName: PropTypes.string,
    onConfirm: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired,
}; 