// Import SSH2 using ES modules
import ssh2Pkg from 'ssh2';
const ssh2Utils = ssh2Pkg.utils;

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

  // Check for PKCS#8 format (modern format)
  if (content.includes('-----BEGIN PRIVATE KEY-----')) {
    // Try to decode and analyze the DER structure for better detection
    try {
      const base64Content = content
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\s/g, '');

      const decoded = Buffer.from(base64Content, 'base64');
      const decodedString = decoded.toString('binary');

      // Check for algorithm identifiers in the DER structure
      if (decodedString.includes('1.2.840.113549.1.1.1')) {
        // RSA OID
        return 'ssh-rsa';
      } else if (decodedString.includes('1.2.840.10045.2.1')) {
        // EC Private Key OID - this indicates ECDSA
        if (decodedString.includes('1.2.840.10045.3.1.7')) {
          // prime256v1 curve OID
          return 'ecdsa-sha2-nistp256';
        }
        return 'ecdsa-sha2-nistp256'; // Default to P-256
      } else if (decodedString.includes('1.3.101.112')) {
        // Ed25519 OID
        return 'ssh-ed25519';
      }
    } catch (error) {
      // If decoding fails, fall back to length-based detection
      console.warn('Failed to decode private key for type detection:', error);
    }

    // Fallback: Try to detect key type from the content structure
    // This is a fallback for PKCS#8 format keys
    if (content.length < 800) {
      // Ed25519 keys are typically shorter
      return 'ssh-ed25519';
    } else if (content.length > 1600) {
      // RSA keys are typically longer
      return 'ssh-rsa';
    } else {
      // ECDSA keys are typically medium length
      return 'ecdsa-sha2-nistp256';
    }
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

  // Check for PEM format public keys
  if (content.includes('-----BEGIN PUBLIC KEY-----')) {
    // Try to decode the base64 content to detect key type
    try {
      const base64Content = content
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .replace(/\s/g, '');

      const decoded = Buffer.from(base64Content, 'base64');
      const decodedString = decoded.toString('binary');

      // Check for algorithm identifiers in the DER structure
      if (decodedString.includes('1.2.840.113549.1.1.1')) {
        // RSA OID
        return 'ssh-rsa';
      } else if (decodedString.includes('1.2.840.10045.2.1')) {
        // EC Public Key OID - this indicates ECDSA
        if (decodedString.includes('1.2.840.10045.3.1.7')) {
          // prime256v1 curve OID
          return 'ecdsa-sha2-nistp256';
        }
        return 'ecdsa-sha2-nistp256'; // Default to P-256
      } else if (decodedString.includes('1.3.101.112')) {
        // Ed25519 OID
        return 'ssh-ed25519';
      }
    } catch (error) {
      // If decoding fails, fall back to length-based detection
      console.warn('Failed to decode public key for type detection:', error);
    }

    // Fallback: Try to guess based on key length
    if (content.length < 400) {
      return 'ssh-ed25519';
    } else if (content.length > 600) {
      return 'ssh-rsa';
    } else {
      return 'ecdsa-sha2-nistp256';
    }
  }

  if (content.includes('-----BEGIN RSA PUBLIC KEY-----')) {
    return 'ssh-rsa';
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
            console.log('Public key buffer type:', typeof publicKeyBuffer);
            console.log('Public key buffer is Buffer:', Buffer.isBuffer(publicKeyBuffer));

            // ssh2's getPublicSSH() returns binary SSH protocol data, not text
            // We need to convert this to proper SSH public key format
            if (Buffer.isBuffer(publicKeyBuffer)) {
              // Convert binary SSH data to base64 and create proper SSH key format
              const base64Data = publicKeyBuffer.toString('base64');

              // Create proper SSH public key format: "keytype base64data"
              if (keyType === 'ssh-rsa') {
                publicKey = `ssh-rsa ${base64Data}`;
              } else if (keyType === 'ssh-ed25519') {
                publicKey = `ssh-ed25519 ${base64Data}`;
              } else if (keyType.startsWith('ecdsa-')) {
                publicKey = `${keyType} ${base64Data}`;
              } else {
                publicKey = `${keyType} ${base64Data}`;
              }

              console.log('Generated SSH public key format, length:', publicKey.length);
              console.log('Public key starts with:', publicKey.substring(0, 50));
            } else {
              console.warn('Unexpected public key buffer type');
              publicKey = '';
            }
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
    } else {
      console.warn('SSH2 parseKey function not available');
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