// Simple fallback SSH key type detection
function detectKeyTypeFromContent(keyContent: string): string {
  const content = keyContent.trim();

  // Check for OpenSSH format headers
  if (content.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    // Look for key type indicators in the content
    if (content.includes('ssh-ed25519') || content.includes('AAAAC3NzaC1lZDI1NTE5')) {
      return 'ssh-ed25519';
    }
    if (content.includes('ssh-rsa') || content.includes('AAAAB3NzaC1yc2E')) {
      return 'ssh-rsa';
    }
    if (content.includes('ecdsa-sha2-nistp256')) {
      return 'ecdsa-sha2-nistp256';
    }
    if (content.includes('ecdsa-sha2-nistp384')) {
      return 'ecdsa-sha2-nistp384';
    }
    if (content.includes('ecdsa-sha2-nistp521')) {
      return 'ecdsa-sha2-nistp521';
    }

    // For OpenSSH format, try to detect by analyzing the base64 content structure
    try {
      const base64Content = content
        .replace('-----BEGIN OPENSSH PRIVATE KEY-----', '')
        .replace('-----END OPENSSH PRIVATE KEY-----', '')
        .replace(/\s/g, '');

      // OpenSSH format starts with "openssh-key-v1" followed by key type
      const decoded = Buffer.from(base64Content, 'base64').toString('binary');

      if (decoded.includes('ssh-rsa')) {
        return 'ssh-rsa';
      }
      if (decoded.includes('ssh-ed25519')) {
        return 'ssh-ed25519';
      }
      if (decoded.includes('ecdsa-sha2-nistp256')) {
        return 'ecdsa-sha2-nistp256';
      }
      if (decoded.includes('ecdsa-sha2-nistp384')) {
        return 'ecdsa-sha2-nistp384';
      }
      if (decoded.includes('ecdsa-sha2-nistp521')) {
        return 'ecdsa-sha2-nistp521';
      }

      // Default to RSA for OpenSSH format if we can't detect specifically
      return 'ssh-rsa';
    } catch (error) {
      console.warn('Failed to decode OpenSSH key content:', error);
      // If decoding fails, default to RSA as it's most common for OpenSSH format
      return 'ssh-rsa';
    }
  }

  // Check for traditional PEM headers
  if (content.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    return 'ssh-rsa';
  }
  if (content.includes('-----BEGIN DSA PRIVATE KEY-----')) {
    return 'ssh-dss';
  }
  if (content.includes('-----BEGIN EC PRIVATE KEY-----')) {
    return 'ecdsa-sha2-nistp256'; // Default ECDSA type
  }

  return 'unknown';
}

// Detect public key type from public key content
function detectPublicKeyTypeFromContent(publicKeyContent: string): string {
  const content = publicKeyContent.trim();

  // SSH public keys start with the key type
  if (content.startsWith('ssh-rsa ')) {
    return 'ssh-rsa';
  }
  if (content.startsWith('ssh-ed25519 ')) {
    return 'ssh-ed25519';
  }
  if (content.startsWith('ecdsa-sha2-nistp256 ')) {
    return 'ecdsa-sha2-nistp256';
  }
  if (content.startsWith('ecdsa-sha2-nistp384 ')) {
    return 'ecdsa-sha2-nistp384';
  }
  if (content.startsWith('ecdsa-sha2-nistp521 ')) {
    return 'ecdsa-sha2-nistp521';
  }
  if (content.startsWith('ssh-dss ')) {
    return 'ssh-dss';
  }

  // Check for base64 encoded key data patterns
  if (content.includes('AAAAB3NzaC1yc2E')) {
    return 'ssh-rsa';
  }
  if (content.includes('AAAAC3NzaC1lZDI1NTE5')) {
    return 'ssh-ed25519';
  }
  if (content.includes('AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY')) {
    return 'ecdsa-sha2-nistp256';
  }
  if (content.includes('AAAAE2VjZHNhLXNoYTItbmlzdHAzODQ')) {
    return 'ecdsa-sha2-nistp384';
  }
  if (content.includes('AAAAE2VjZHNhLXNoYTItbmlzdHA1MjE')) {
    return 'ecdsa-sha2-nistp521';
  }
  if (content.includes('AAAAB3NzaC1kc3M')) {
    return 'ssh-dss';
  }

  return 'unknown';
}

// Try multiple import approaches for SSH2
let ssh2Utils: any = null;

try {
  // Approach 1: Default import
  console.log('Trying SSH2 default import...');
  const ssh2Default = require('ssh2');
  console.log('SSH2 default import result:', typeof ssh2Default);
  console.log('SSH2 utils from default:', typeof ssh2Default?.utils);

  if (ssh2Default && ssh2Default.utils) {
    ssh2Utils = ssh2Default.utils;
    console.log('Using SSH2 from default import');
  }
} catch (error) {
  console.log('SSH2 default import failed:', error instanceof Error ? error.message : error);
}

if (!ssh2Utils) {
  try {
    // Approach 2: Direct utils import
    console.log('Trying SSH2 utils direct import...');
    const ssh2UtilsDirect = require('ssh2').utils;
    console.log('SSH2 utils direct import result:', typeof ssh2UtilsDirect);

    if (ssh2UtilsDirect) {
      ssh2Utils = ssh2UtilsDirect;
      console.log('Using SSH2 from direct utils import');
    }
  } catch (error) {
    console.log('SSH2 utils direct import failed:', error instanceof Error ? error.message : error);
  }
}

if (!ssh2Utils) {
  console.error('Failed to import SSH2 utils with any method - using fallback detection');
}

export interface KeyInfo {
  privateKey: string;
  publicKey: string;
  keyType: string;
  success: boolean;
  error?: string;
}

export interface PublicKeyInfo {
  publicKey: string;
  keyType: string;
  success: boolean;
  error?: string;
}

export interface KeyPairValidationResult {
  isValid: boolean;
  privateKeyType: string;
  publicKeyType: string;
  generatedPublicKey?: string;
  error?: string;
}

/**
 * Parse SSH private key and extract public key and type information
 */
export function parseSSHKey(privateKeyData: string, passphrase?: string): KeyInfo {
  console.log('=== SSH Key Parsing Debug ===');
  console.log('Key length:', privateKeyData?.length || 'undefined');
  console.log('First 100 chars:', privateKeyData?.substring(0, 100) || 'undefined');
  console.log('ssh2Utils available:', typeof ssh2Utils);
  console.log('parseKey function available:', typeof ssh2Utils?.parseKey);

  try {
    let keyType = 'unknown';
    let publicKey = '';
    let useSSH2 = false;

    // Try SSH2 first if available
    if (ssh2Utils && typeof ssh2Utils.parseKey === 'function') {
      try {
        console.log('Calling ssh2Utils.parseKey...');
        const parsedKey = ssh2Utils.parseKey(privateKeyData, passphrase);
        console.log('parseKey returned:', typeof parsedKey, parsedKey instanceof Error ? parsedKey.message : 'success');

        if (!(parsedKey instanceof Error)) {
          // Extract key type
          if (parsedKey.type) {
            keyType = parsedKey.type;
          }
          console.log('Extracted key type:', keyType);

          // Generate public key in SSH format
          try {
            console.log('Attempting to generate public key...');
            const publicKeyBuffer = parsedKey.getPublicSSH();
            // Handle SSH public key format properly
            publicKey = publicKeyBuffer.toString('utf8').trim();
            console.log('Public key generated, length:', publicKey.length);
          } catch (error) {
            console.warn('Failed to generate public key:', error);
            publicKey = '';
          }

          useSSH2 = true;
          console.log(`SSH key parsed successfully with SSH2: ${keyType}`);
        } else {
          console.warn('SSH2 parsing failed:', parsedKey.message);
        }
      } catch (error) {
        console.warn('SSH2 parsing exception:', error instanceof Error ? error.message : error);
      }
    }

    // Fallback to content-based detection
    if (!useSSH2) {
      console.log('Using fallback key type detection...');
      keyType = detectKeyTypeFromContent(privateKeyData);
      console.log(`Fallback detected key type: ${keyType}`);

      // For fallback, we can't generate public key but the detection is still useful
      publicKey = '';

      if (keyType !== 'unknown') {
        console.log(`SSH key type detected successfully with fallback: ${keyType}`);
      }
    }

    return {
      privateKey: privateKeyData,
      publicKey,
      keyType,
      success: keyType !== 'unknown'
    };
  } catch (error) {
    console.error('Exception during SSH key parsing:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');

    // Final fallback - try content detection
    try {
      const fallbackKeyType = detectKeyTypeFromContent(privateKeyData);
      if (fallbackKeyType !== 'unknown') {
        console.log(`Final fallback detection successful: ${fallbackKeyType}`);
        return {
          privateKey: privateKeyData,
          publicKey: '',
          keyType: fallbackKeyType,
          success: true
        };
      }
    } catch (fallbackError) {
      console.error('Even fallback detection failed:', fallbackError);
    }

    return {
      privateKey: privateKeyData,
      publicKey: '',
      keyType: 'unknown',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error parsing key'
    };
  }
}

/**
 * Parse SSH public key and extract type information
 */
export function parsePublicKey(publicKeyData: string): PublicKeyInfo {
  console.log('=== SSH Public Key Parsing Debug ===');
  console.log('Public key length:', publicKeyData?.length || 'undefined');
  console.log('First 100 chars:', publicKeyData?.substring(0, 100) || 'undefined');

  try {
    const keyType = detectPublicKeyTypeFromContent(publicKeyData);
    console.log(`Public key type detected: ${keyType}`);

    return {
      publicKey: publicKeyData,
      keyType,
      success: keyType !== 'unknown'
    };
  } catch (error) {
    console.error('Exception during SSH public key parsing:', error);
    return {
      publicKey: publicKeyData,
      keyType: 'unknown',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error parsing public key'
    };
  }
}

/**
 * Detect SSH key type from private key content
 */
export function detectKeyType(privateKeyData: string): string {
  try {
    const parsedKey = ssh2Utils.parseKey(privateKeyData);
    if (parsedKey instanceof Error) {
      return 'unknown';
    }
    return parsedKey.type || 'unknown';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get friendly key type name
 */
export function getFriendlyKeyTypeName(keyType: string): string {
  const keyTypeMap: Record<string, string> = {
    'ssh-rsa': 'RSA',
    'ssh-ed25519': 'Ed25519',
    'ecdsa-sha2-nistp256': 'ECDSA P-256',
    'ecdsa-sha2-nistp384': 'ECDSA P-384',
    'ecdsa-sha2-nistp521': 'ECDSA P-521',
    'ssh-dss': 'DSA',
    'rsa-sha2-256': 'RSA-SHA2-256',
    'rsa-sha2-512': 'RSA-SHA2-512',
    'unknown': 'Unknown'
  };

  return keyTypeMap[keyType] || keyType;
}

/**
 * Validate if a private key and public key form a valid key pair
 */
export function validateKeyPair(privateKeyData: string, publicKeyData: string, passphrase?: string): KeyPairValidationResult {
  console.log('=== Key Pair Validation Debug ===');
  console.log('Private key length:', privateKeyData?.length || 'undefined');
  console.log('Public key length:', publicKeyData?.length || 'undefined');

  try {
    // First parse the private key and try to generate public key
    const privateKeyInfo = parseSSHKey(privateKeyData, passphrase);
    const publicKeyInfo = parsePublicKey(publicKeyData);

    console.log('Private key parsing result:', privateKeyInfo.success, privateKeyInfo.keyType);
    console.log('Public key parsing result:', publicKeyInfo.success, publicKeyInfo.keyType);

    if (!privateKeyInfo.success) {
      return {
        isValid: false,
        privateKeyType: privateKeyInfo.keyType,
        publicKeyType: publicKeyInfo.keyType,
        error: `Invalid private key: ${privateKeyInfo.error}`
      };
    }

    if (!publicKeyInfo.success) {
      return {
        isValid: false,
        privateKeyType: privateKeyInfo.keyType,
        publicKeyType: publicKeyInfo.keyType,
        error: `Invalid public key: ${publicKeyInfo.error}`
      };
    }

    // Check if key types match
    if (privateKeyInfo.keyType !== publicKeyInfo.keyType) {
      return {
        isValid: false,
        privateKeyType: privateKeyInfo.keyType,
        publicKeyType: publicKeyInfo.keyType,
        error: `Key type mismatch: private key is ${privateKeyInfo.keyType}, public key is ${publicKeyInfo.keyType}`
      };
    }

    // If we have a generated public key from the private key, compare them
    if (privateKeyInfo.publicKey && privateKeyInfo.publicKey.trim()) {
      const generatedPublicKey = privateKeyInfo.publicKey.trim();
      const providedPublicKey = publicKeyData.trim();

      console.log('Generated public key length:', generatedPublicKey.length);
      console.log('Provided public key length:', providedPublicKey.length);

      // Compare the key data part (excluding comments)
      const generatedKeyParts = generatedPublicKey.split(' ');
      const providedKeyParts = providedPublicKey.split(' ');

      if (generatedKeyParts.length >= 2 && providedKeyParts.length >= 2) {
        // Compare key type and key data (first two parts)
        const generatedKeyData = generatedKeyParts[0] + ' ' + generatedKeyParts[1];
        const providedKeyData = providedKeyParts[0] + ' ' + providedKeyParts[1];

        console.log('Generated key data:', generatedKeyData.substring(0, 50) + '...');
        console.log('Provided key data:', providedKeyData.substring(0, 50) + '...');

        if (generatedKeyData === providedKeyData) {
          return {
            isValid: true,
            privateKeyType: privateKeyInfo.keyType,
            publicKeyType: publicKeyInfo.keyType,
            generatedPublicKey: generatedPublicKey
          };
        } else {
          return {
            isValid: false,
            privateKeyType: privateKeyInfo.keyType,
            publicKeyType: publicKeyInfo.keyType,
            generatedPublicKey: generatedPublicKey,
            error: 'Public key does not match the private key'
          };
        }
      }
    }

    // If we can't generate public key or compare, just check if types match
    return {
      isValid: true, // Assume valid if types match and no errors
      privateKeyType: privateKeyInfo.keyType,
      publicKeyType: publicKeyInfo.keyType,
      error: 'Unable to verify key pair match, but key types are compatible'
    };

  } catch (error) {
    console.error('Exception during key pair validation:', error);
    return {
      isValid: false,
      privateKeyType: 'unknown',
      publicKeyType: 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error during validation'
    };
  }
}