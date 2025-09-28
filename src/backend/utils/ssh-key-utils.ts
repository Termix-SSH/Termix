import ssh2Pkg from "ssh2";
const ssh2Utils = ssh2Pkg.utils;

function detectKeyTypeFromContent(keyContent: string): string {
  const content = keyContent.trim();

  if (content.includes("-----BEGIN OPENSSH PRIVATE KEY-----")) {
    if (
      content.includes("ssh-ed25519") ||
      content.includes("AAAAC3NzaC1lZDI1NTE5")
    ) {
      return "ssh-ed25519";
    }
    if (content.includes("ssh-rsa") || content.includes("AAAAB3NzaC1yc2E")) {
      return "ssh-rsa";
    }
    if (content.includes("ecdsa-sha2-nistp256")) {
      return "ecdsa-sha2-nistp256";
    }
    if (content.includes("ecdsa-sha2-nistp384")) {
      return "ecdsa-sha2-nistp384";
    }
    if (content.includes("ecdsa-sha2-nistp521")) {
      return "ecdsa-sha2-nistp521";
    }

    try {
      const base64Content = content
        .replace("-----BEGIN OPENSSH PRIVATE KEY-----", "")
        .replace("-----END OPENSSH PRIVATE KEY-----", "")
        .replace(/\s/g, "");

      const decoded = Buffer.from(base64Content, "base64").toString("binary");

      if (decoded.includes("ssh-rsa")) {
        return "ssh-rsa";
      }
      if (decoded.includes("ssh-ed25519")) {
        return "ssh-ed25519";
      }
      if (decoded.includes("ecdsa-sha2-nistp256")) {
        return "ecdsa-sha2-nistp256";
      }
      if (decoded.includes("ecdsa-sha2-nistp384")) {
        return "ecdsa-sha2-nistp384";
      }
      if (decoded.includes("ecdsa-sha2-nistp521")) {
        return "ecdsa-sha2-nistp521";
      }

      return "ssh-rsa";
    } catch (error) {
      return "ssh-rsa";
    }
  }

  if (content.includes("-----BEGIN RSA PRIVATE KEY-----")) {
    return "ssh-rsa";
  }
  if (content.includes("-----BEGIN DSA PRIVATE KEY-----")) {
    return "ssh-dss";
  }
  if (content.includes("-----BEGIN EC PRIVATE KEY-----")) {
    return "ecdsa-sha2-nistp256";
  }

  if (content.includes("-----BEGIN PRIVATE KEY-----")) {
    try {
      const base64Content = content
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace(/\s/g, "");

      const decoded = Buffer.from(base64Content, "base64");
      const decodedString = decoded.toString("binary");

      if (decodedString.includes("1.2.840.113549.1.1.1")) {
        return "ssh-rsa";
      } else if (decodedString.includes("1.2.840.10045.2.1")) {
        if (decodedString.includes("1.2.840.10045.3.1.7")) {
          return "ecdsa-sha2-nistp256";
        }
        return "ecdsa-sha2-nistp256";
      } else if (decodedString.includes("1.3.101.112")) {
        return "ssh-ed25519";
      }
    } catch (error) {}

    if (content.length < 800) {
      return "ssh-ed25519";
    } else if (content.length > 1600) {
      return "ssh-rsa";
    } else {
      return "ecdsa-sha2-nistp256";
    }
  }

  return "unknown";
}

function detectPublicKeyTypeFromContent(publicKeyContent: string): string {
  const content = publicKeyContent.trim();

  if (content.startsWith("ssh-rsa ")) {
    return "ssh-rsa";
  }
  if (content.startsWith("ssh-ed25519 ")) {
    return "ssh-ed25519";
  }
  if (content.startsWith("ecdsa-sha2-nistp256 ")) {
    return "ecdsa-sha2-nistp256";
  }
  if (content.startsWith("ecdsa-sha2-nistp384 ")) {
    return "ecdsa-sha2-nistp384";
  }
  if (content.startsWith("ecdsa-sha2-nistp521 ")) {
    return "ecdsa-sha2-nistp521";
  }
  if (content.startsWith("ssh-dss ")) {
    return "ssh-dss";
  }

  if (content.includes("-----BEGIN PUBLIC KEY-----")) {
    try {
      const base64Content = content
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace(/\s/g, "");

      const decoded = Buffer.from(base64Content, "base64");
      const decodedString = decoded.toString("binary");

      if (decodedString.includes("1.2.840.113549.1.1.1")) {
        return "ssh-rsa";
      } else if (decodedString.includes("1.2.840.10045.2.1")) {
        if (decodedString.includes("1.2.840.10045.3.1.7")) {
          return "ecdsa-sha2-nistp256";
        }
        return "ecdsa-sha2-nistp256";
      } else if (decodedString.includes("1.3.101.112")) {
        return "ssh-ed25519";
      }
    } catch (error) {}

    if (content.length < 400) {
      return "ssh-ed25519";
    } else if (content.length > 600) {
      return "ssh-rsa";
    } else {
      return "ecdsa-sha2-nistp256";
    }
  }

  if (content.includes("-----BEGIN RSA PUBLIC KEY-----")) {
    return "ssh-rsa";
  }

  if (content.includes("AAAAB3NzaC1yc2E")) {
    return "ssh-rsa";
  }
  if (content.includes("AAAAC3NzaC1lZDI1NTE5")) {
    return "ssh-ed25519";
  }
  if (content.includes("AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY")) {
    return "ecdsa-sha2-nistp256";
  }
  if (content.includes("AAAAE2VjZHNhLXNoYTItbmlzdHAzODQ")) {
    return "ecdsa-sha2-nistp384";
  }
  if (content.includes("AAAAE2VjZHNhLXNoYTItbmlzdHA1MjE")) {
    return "ecdsa-sha2-nistp521";
  }
  if (content.includes("AAAAB3NzaC1kc3M")) {
    return "ssh-dss";
  }

  return "unknown";
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

export function parseSSHKey(
  privateKeyData: string,
  passphrase?: string,
): KeyInfo {
  try {
    let keyType = "unknown";
    let publicKey = "";
    let useSSH2 = false;

    if (ssh2Utils && typeof ssh2Utils.parseKey === "function") {
      try {
        const parsedKey = ssh2Utils.parseKey(privateKeyData, passphrase);

        if (!(parsedKey instanceof Error)) {
          if (parsedKey.type) {
            keyType = parsedKey.type;
          }

          try {
            const publicKeyBuffer = parsedKey.getPublicSSH();

            if (Buffer.isBuffer(publicKeyBuffer)) {
              const base64Data = publicKeyBuffer.toString("base64");

              if (keyType === "ssh-rsa") {
                publicKey = `ssh-rsa ${base64Data}`;
              } else if (keyType === "ssh-ed25519") {
                publicKey = `ssh-ed25519 ${base64Data}`;
              } else if (keyType.startsWith("ecdsa-")) {
                publicKey = `${keyType} ${base64Data}`;
              } else {
                publicKey = `${keyType} ${base64Data}`;
              }
            } else {
              publicKey = "";
            }
          } catch (error) {
            publicKey = "";
          }

          useSSH2 = true;
        }
      } catch (error) {}
    }

    if (!useSSH2) {
      keyType = detectKeyTypeFromContent(privateKeyData);

      publicKey = "";
    }

    return {
      privateKey: privateKeyData,
      publicKey,
      keyType,
      success: keyType !== "unknown",
    };
  } catch (error) {
    try {
      const fallbackKeyType = detectKeyTypeFromContent(privateKeyData);
      if (fallbackKeyType !== "unknown") {
        return {
          privateKey: privateKeyData,
          publicKey: "",
          keyType: fallbackKeyType,
          success: true,
        };
      }
    } catch (fallbackError) {}

    return {
      privateKey: privateKeyData,
      publicKey: "",
      keyType: "unknown",
      success: false,
      error:
        error instanceof Error ? error.message : "Unknown error parsing key",
    };
  }
}

export function parsePublicKey(publicKeyData: string): PublicKeyInfo {
  try {
    const keyType = detectPublicKeyTypeFromContent(publicKeyData);

    return {
      publicKey: publicKeyData,
      keyType,
      success: keyType !== "unknown",
    };
  } catch (error) {
    return {
      publicKey: publicKeyData,
      keyType: "unknown",
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error parsing public key",
    };
  }
}

export function detectKeyType(privateKeyData: string): string {
  try {
    const parsedKey = ssh2Utils.parseKey(privateKeyData);
    if (parsedKey instanceof Error) {
      return "unknown";
    }
    return parsedKey.type || "unknown";
  } catch (error) {
    return "unknown";
  }
}

export function getFriendlyKeyTypeName(keyType: string): string {
  const keyTypeMap: Record<string, string> = {
    "ssh-rsa": "RSA",
    "ssh-ed25519": "Ed25519",
    "ecdsa-sha2-nistp256": "ECDSA P-256",
    "ecdsa-sha2-nistp384": "ECDSA P-384",
    "ecdsa-sha2-nistp521": "ECDSA P-521",
    "ssh-dss": "DSA",
    "rsa-sha2-256": "RSA-SHA2-256",
    "rsa-sha2-512": "RSA-SHA2-512",
    unknown: "Unknown",
  };

  return keyTypeMap[keyType] || keyType;
}

export function validateKeyPair(
  privateKeyData: string,
  publicKeyData: string,
  passphrase?: string,
): KeyPairValidationResult {
  try {
    const privateKeyInfo = parseSSHKey(privateKeyData, passphrase);
    const publicKeyInfo = parsePublicKey(publicKeyData);

    if (!privateKeyInfo.success) {
      return {
        isValid: false,
        privateKeyType: privateKeyInfo.keyType,
        publicKeyType: publicKeyInfo.keyType,
        error: `Invalid private key: ${privateKeyInfo.error}`,
      };
    }

    if (!publicKeyInfo.success) {
      return {
        isValid: false,
        privateKeyType: privateKeyInfo.keyType,
        publicKeyType: publicKeyInfo.keyType,
        error: `Invalid public key: ${publicKeyInfo.error}`,
      };
    }

    if (privateKeyInfo.keyType !== publicKeyInfo.keyType) {
      return {
        isValid: false,
        privateKeyType: privateKeyInfo.keyType,
        publicKeyType: publicKeyInfo.keyType,
        error: `Key type mismatch: private key is ${privateKeyInfo.keyType}, public key is ${publicKeyInfo.keyType}`,
      };
    }

    if (privateKeyInfo.publicKey && privateKeyInfo.publicKey.trim()) {
      const generatedPublicKey = privateKeyInfo.publicKey.trim();
      const providedPublicKey = publicKeyData.trim();

      const generatedKeyParts = generatedPublicKey.split(" ");
      const providedKeyParts = providedPublicKey.split(" ");

      if (generatedKeyParts.length >= 2 && providedKeyParts.length >= 2) {
        const generatedKeyData =
          generatedKeyParts[0] + " " + generatedKeyParts[1];
        const providedKeyData = providedKeyParts[0] + " " + providedKeyParts[1];

        if (generatedKeyData === providedKeyData) {
          return {
            isValid: true,
            privateKeyType: privateKeyInfo.keyType,
            publicKeyType: publicKeyInfo.keyType,
            generatedPublicKey: generatedPublicKey,
          };
        } else {
          return {
            isValid: false,
            privateKeyType: privateKeyInfo.keyType,
            publicKeyType: publicKeyInfo.keyType,
            generatedPublicKey: generatedPublicKey,
            error: "Public key does not match the private key",
          };
        }
      }
    }

    return {
      isValid: true,
      privateKeyType: privateKeyInfo.keyType,
      publicKeyType: publicKeyInfo.keyType,
      error: "Unable to verify key pair match, but key types are compatible",
    };
  } catch (error) {
    return {
      isValid: false,
      privateKeyType: "unknown",
      publicKeyType: "unknown",
      error:
        error instanceof Error
          ? error.message
          : "Unknown error during validation",
    };
  }
}
