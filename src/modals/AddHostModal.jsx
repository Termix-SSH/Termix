import PropTypes from 'prop-types';
import { CssVarsProvider } from '@mui/joy/styles';
import {
    Modal,
    Button,
    FormControl,
    FormLabel,
    Input,
    Stack,
    ModalDialog,
    Select,
    Option,
    Checkbox,
    IconButton,
    Tabs,
    TabList,
    Tab,
    TabPanel,
    Chip,
    Box,
    Typography
} from '@mui/joy';
import { Collapse } from '@mui/material';
import theme from '/src/theme';
import { useState } from 'react';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import AddIcon from '@mui/icons-material/Add';
import FolderIcon from '@mui/icons-material/Folder';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DeleteIcon from '@mui/icons-material/Delete';

const FolderTree = ({ folders, selectedFolder, onSelectFolder, onAddFolder, onDeleteFolder }) => {
    const [newFolderName, setNewFolderName] = useState('');
    const [isAddingFolder, setIsAddingFolder] = useState(false);

    const handleAddFolder = () => {
        if (newFolderName.trim()) {
            onAddFolder(newFolderName.trim());
            setNewFolderName('');
            setIsAddingFolder(false);
        }
    };

    return (
        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Typography level="body-sm" sx={{ mb: 1 }}>Folders</Typography>
            <div style={{ display: 'flex', gap: '8px' }}>
                <Select
                    value={selectedFolder || ''}
                    onChange={(e, val) => onSelectFolder(val)}
                    sx={{
                        flex: 1,
                        backgroundColor: theme.palette.general.primary,
                        color: theme.palette.text.primary,
                    }}
                >
                    <Option value="">No Folder</Option>
                    {folders.map(folder => (
                        <Option key={folder} value={folder}>{folder}</Option>
                    ))}
                </Select>
                {isAddingFolder ? (
                    <>
                        <Input
                            size="sm"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            placeholder="New folder name"
                            autoFocus
                            onKeyPress={(e) => e.key === 'Enter' && handleAddFolder()}
                            sx={{
                                backgroundColor: theme.palette.general.primary,
                                color: theme.palette.text.primary,
                            }}
                        />
                        <IconButton
                            size="sm"
                            onClick={handleAddFolder}
                            disabled={!newFolderName.trim()}
                        >
                            <AddIcon />
                        </IconButton>
                        <IconButton
                            size="sm"
                            onClick={() => {
                                setIsAddingFolder(false);
                                setNewFolderName('');
                            }}
                        >
                            <DeleteIcon />
                        </IconButton>
                    </>
                ) : (
                    <IconButton
                        size="sm"
                        onClick={() => setIsAddingFolder(true)}
                    >
                        <AddIcon />
                    </IconButton>
                )}
            </div>
        </Box>
    );
};

const AddHostModal = ({ isHidden, form, setForm, handleAddHost, setIsAddHostHidden, hosts }) => {
    const [showPassword, setShowPassword] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    const [errorMessage, setErrorMessage] = useState("");
    const [showError, setShowError] = useState(false);
    const [newTag, setNewTag] = useState("");
    const [availableFolders, setAvailableFolders] = useState([]);

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

                if (keyContent.includes('BEGIN RSA PRIVATE KEY') || keyContent.includes('BEGIN RSA PUBLIC KEY')) {
                    keyType = 'RSA';
                } else if (keyContent.includes('BEGIN OPENSSH PRIVATE KEY') && keyContent.includes('ssh-ed25519')) {
                    keyType = 'ED25519';
                } else if (keyContent.includes('BEGIN EC PRIVATE KEY') || keyContent.includes('BEGIN EC PUBLIC KEY')) {
                    keyType = 'ECDSA';
                } else if (keyContent.includes('BEGIN DSA PRIVATE KEY')) {
                    keyType = 'DSA';
                }

                setForm(prev => ({
                    ...prev,
                    sshKey: keyContent,
                    keyType: keyType,
                    authMethod: 'sshKey'
                }));
            };
            reader.readAsText(file);
        } else {
            alert('Please upload a valid SSH key file (RSA, ED25519, ECDSA, DSA, PEM, or PPK format).');
        }
    };

    const handleAuthChange = (newMethod) => {
        setForm((prev) => ({
            ...prev,
            authMethod: newMethod,
            password: "",
            sshKey: "",
            keyType: "",
        }));
    };

    const isFormValid = () => {
        const { ip, user, port, authMethod, password, sshKey } = form;

        if (!ip?.trim() || !user?.trim() || !port) return false;

        const portNum = Number(port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;

        if (!form.rememberHost) return true;

        if (form.rememberHost) {
            if (authMethod === 'Select Auth') return false;
            if (authMethod === 'password' && !password?.trim()) return false;
            if (authMethod === 'sshKey' && !sshKey?.trim()) return false;
        }

        return true;
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        
        setErrorMessage("");
        setShowError(false);

        if (!form.ip?.trim()) {
            setErrorMessage("Please provide an IP address.");
            setShowError(true);
            return;
        }
        
        if (form.connectionType === 'ssh' && !form.user?.trim()) {
            setErrorMessage("Please provide a username for SSH connection.");
            setShowError(true);
            return;
        }
        
        try {
            handleAddHost();
            setActiveTab(0);
        } catch (error) {
            console.error("Add host error:", error);
            setErrorMessage(error.message || "Failed to add host. The host name or IP may already exist.");
            setShowError(true);
        }
    };

    const handleAddTag = (e) => {
        if (e && e.preventDefault) {
            e.preventDefault();
        }
        if (newTag.trim() && !form.tags?.includes(newTag.trim())) {
            setForm(prev => ({
                ...prev,
                tags: [...(prev.tags || []), newTag.trim()]
            }));
            setNewTag("");
        }
    };

    const handleRemoveTag = (tagToRemove) => {
        setForm(prev => ({
            ...prev,
            tags: prev.tags ? prev.tags.filter(tag => tag !== tagToRemove) : []
        }));
    };

    const handleAddFolder = (folderPath) => {
        if (!availableFolders.includes(folderPath)) {
            setAvailableFolders(prev => [...prev, folderPath]);
        }
    };

    const handleDeleteFolder = (folderPath) => {
        setAvailableFolders(prev => prev.filter(f => f !== folderPath));
        if (form.folder === folderPath) {
            setForm(prev => ({ ...prev, folder: null }));
        }
    };

    return (
        <CssVarsProvider theme={theme}>
            <Modal open={!isHidden} onClose={() => setIsAddHostHidden(true)}
                   sx={{
                       display: 'flex',
                       justifyContent: 'center',
                       alignItems: 'center',
                       backdropFilter: 'blur(5px)',
                       backgroundColor: 'rgba(0, 0, 0, 0.2)',
                   }}
            >
                <ModalDialog
                    layout="center"
                    variant="outlined"
                    sx={{
                        backgroundColor: theme.palette.general.tertiary,
                        borderColor: theme.palette.general.secondary,
                        color: theme.palette.text.primary,
                        padding: 0,
                        borderRadius: 10,
                        maxWidth: '500px',
                        width: '100%',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        boxSizing: 'border-box',
                        mx: 2,
                    }}
                >
                    {showError && (
                        <div style={{ 
                            backgroundColor: "#c53030", 
                            color: "white", 
                            padding: "10px", 
                            textAlign: "center",
                            borderTopLeftRadius: "10px",
                            borderTopRightRadius: "10px"
                        }}>
                            {errorMessage}
                        </div>
                    )}
                    <Tabs
                        value={activeTab}
                        onChange={(e, val) => setActiveTab(val)}
                        sx={{
                            width: '100%',
                            mb: 0,
                            backgroundColor: theme.palette.general.tertiary,
                        }}
                    >
                        <TabList
                            sx={{
                                width: '100%',
                                gap: 0,
                                borderTopLeftRadius: 10,
                                borderTopRightRadius: 10,
                                backgroundColor: theme.palette.general.primary,
                                '& button': {
                                    flex: 1,
                                    bgcolor: 'transparent',
                                    color: theme.palette.text.secondary,
                                    '&:hover': {
                                        bgcolor: theme.palette.general.disabled,
                                    },
                                    '&.Mui-selected': {
                                        bgcolor: theme.palette.general.tertiary,
                                        color: theme.palette.text.primary,
                                        '&:hover': {
                                            bgcolor: theme.palette.general.tertiary,
                                        },
                                    },
                                },
                            }}
                        >
                            <Tab sx={{ flex: 1 }}>Basic Info</Tab>
                            <Tab sx={{ flex: 1 }}>Connection</Tab>
                            <Tab sx={{ flex: 1 }}>Authentication</Tab>
                        </TabList>

                        <div style={{ padding: '24px', backgroundColor: theme.palette.general.tertiary }}>
                            <TabPanel value={0}>
                                <Stack spacing={2}>
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
                                    
                                    <FormControl>
                                        <FormLabel>Folder</FormLabel>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <Input
                                                value={form.folder || ''}
                                                onChange={(e) => setForm({ ...form, folder: e.target.value })}
                                                placeholder="New folder"
                                                sx={{
                                                    flex: 1,
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                            <Select
                                                value={form.folder || ''}
                                                onChange={(e, val) => setForm({ ...form, folder: val })}
                                                placeholder="Select folder"
                                                sx={{
                                                    width: '180px',
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            >
                                                <Option value="">No Folder</Option>
                                                {Array.from(new Set([
                                                    ...Array.from(new Set(hosts?.map(host => host.config?.folder).filter(Boolean) || [])),
                                                    ...Array.from(new Set(window.availableFolders || []))
                                                ].filter(Boolean))).map(folder => (
                                                    <Option key={folder} value={folder}>{folder}</Option>
                                                ))}
                                                {form.folder && !Array.from(new Set([
                                                    ...Array.from(new Set(hosts?.map(host => host.config?.folder).filter(Boolean) || [])),
                                                    ...Array.from(new Set(window.availableFolders || []))
                                                ])).includes(form.folder) && (
                                                    <Option key={form.folder} value={form.folder}>New Folder</Option>
                                                )}
                                            </Select>
                                        </div>
                                    </FormControl>
                                    
                                    <FormControl>
                                        <FormLabel>Tags</FormLabel>
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                                            {form.tags?.map((tag) => (
                                                <Chip
                                                    key={tag}
                                                    variant="soft"
                                                    color="neutral"
                                                    sx={{
                                                        backgroundColor: theme.palette.general.primary,
                                                        color: theme.palette.text.primary,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '2px',
                                                        padding: '4px 4px 4px 8px',
                                                        position: 'relative'
                                                    }}
                                                >
                                                    <span>{tag}</span>
                                                    <span
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleRemoveTag(tag);
                                                        }}
                                                        style={{
                                                            marginLeft: '4px',
                                                            color: 'red',
                                                            padding: '0 8px',
                                                            cursor: 'pointer',
                                                            fontWeight: 'bold',
                                                            fontSize: '16px',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        ×
                                                    </span>
                                                </Chip>
                                            ))}
                                        </Box>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <Input
                                                value={newTag}
                                                onChange={(e) => setNewTag(e.target.value)}
                                                placeholder="Add tag"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleAddTag();
                                                    }
                                                }}
                                                sx={{
                                                    flex: 1,
                                                    backgroundColor: theme.palette.general.primary,
                                                    color: theme.palette.text.primary,
                                                }}
                                            />
                                            <IconButton
                                                size="sm"
                                                onClick={handleAddTag}
                                                disabled={!newTag.trim()}
                                            >
                                                <AddIcon />
                                            </IconButton>
                                        </div>
                                    </FormControl>

                                    <FormControl>
                                        <FormLabel>Remember Host</FormLabel>
                                        <Checkbox
                                            checked={Boolean(form.rememberHost)}
                                            onChange={(e) => setForm({
                                                ...form,
                                                rememberHost: e.target.checked,
                                            })}
                                            sx={{
                                                color: theme.palette.text.primary,
                                                '&.Mui-checked': {
                                                    color: theme.palette.text.primary,
                                                },
                                            }}
                                        />
                                    </FormControl>

                                    <FormControl>
                                        <FormLabel>Pin Connection</FormLabel>
                                        <Checkbox
                                            checked={Boolean(form.isPinned)}
                                            onChange={(e) => setForm({
                                                ...form,
                                                isPinned: e.target.checked,
                                            })}
                                            sx={{
                                                color: theme.palette.text.primary,
                                                '&.Mui-checked': {
                                                    color: theme.palette.text.primary,
                                                },
                                            }}
                                        />
                                    </FormControl>
                                </Stack>
                            </TabPanel>

                            <TabPanel value={1}>
                                <Stack spacing={2}>
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
                                    <FormControl error={form.port < 1 || form.port > 65535}>
                                        <FormLabel>Host Port</FormLabel>
                                        <Input
                                            type="number"
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
                                </Stack>
                            </TabPanel>

                            <TabPanel value={2}>
                                <Stack spacing={2}>
                                    <FormControl error={!form.authMethod || form.authMethod === 'Select Auth'}>
                                        <FormLabel>Authentication Method</FormLabel>
                                        <Select
                                            value={form.authMethod}
                                            onChange={(e, val) => handleAuthChange(val)}
                                            sx={{
                                                backgroundColor: theme.palette.general.primary,
                                                color: theme.palette.text.primary,
                                            }}
                                        >
                                            <Option value="Select Auth" disabled>Select Auth</Option>
                                            <Option value="password">Password</Option>
                                            <Option value="sshKey">SSH Key</Option>
                                        </Select>
                                    </FormControl>

                                    {form.authMethod === 'password' && (
                                        <FormControl error={!form.password}>
                                            <FormLabel>Password</FormLabel>
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                <Input
                                                    type={showPassword ? 'text' : 'password'}
                                                    value={form.password}
                                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
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

                                    {form.rememberHost && (
                                        <FormControl>
                                            <FormLabel>Store Password</FormLabel>
                                            <Checkbox
                                                checked={Boolean(form.storePassword)}
                                                onChange={(e) => setForm({ ...form, storePassword: e.target.checked })}
                                                sx={{
                                                    color: theme.palette.text.primary,
                                                    '&.Mui-checked': {
                                                        color: theme.palette.text.primary,
                                                    },
                                                }}
                                            />
                                        </FormControl>
                                    )}
                                </Stack>
                            </TabPanel>
                        </div>

                        <Button
                            onClick={handleSubmit}
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
                                marginTop: 1,
                                width: '100%',
                                height: '40px',
                            }}
                        >
                            Add Host
                        </Button>
                    </Tabs>
                </ModalDialog>
            </Modal>
        </CssVarsProvider>
    );
};

AddHostModal.propTypes = {
    isHidden: PropTypes.bool.isRequired,
    form: PropTypes.object.isRequired,
    setForm: PropTypes.func.isRequired,
    handleAddHost: PropTypes.func.isRequired,
    setIsAddHostHidden: PropTypes.func.isRequired,
    hosts: PropTypes.array
};

export default AddHostModal;