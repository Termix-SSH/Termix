import type { Request, RequestHandler, Response, Router } from "express";
import crypto from "crypto";
import ssh2Pkg from "ssh2";
import { authLogger } from "../../utils/logger.js";
import {
  parsePublicKey,
  parseSSHKey,
  validateKeyPair,
} from "../../utils/ssh-key-utils.js";

const { utils: ssh2Utils } = ssh2Pkg;

function generateSSHKeyPair(
  keyType: string,
  keySize?: number,
  passphrase?: string,
): {
  success: boolean;
  privateKey?: string;
  publicKey?: string;
  error?: string;
} {
  try {
    let ssh2Type = keyType;
    const options: {
      bits?: number;
      passphrase?: string;
      cipher?: string;
    } = {};

    if (keyType === "ssh-rsa") {
      ssh2Type = "rsa";
      options.bits = keySize || 2048;
    } else if (keyType === "ssh-ed25519") {
      ssh2Type = "ed25519";
    } else if (keyType === "ecdsa-sha2-nistp256") {
      ssh2Type = "ecdsa";
      options.bits = 256;
    }

    if (passphrase && passphrase.trim()) {
      options.passphrase = passphrase;
      options.cipher = "aes128-cbc";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyPair = ssh2Utils.generateKeyPairSync(ssh2Type as any, options);

    return {
      success: true,
      privateKey: keyPair.private,
      publicKey: keyPair.public,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "SSH key generation failed",
    };
  }
}

export function registerCredentialKeyRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /credentials/detect-key-type:
   *   post:
   *     summary: Detect SSH key type
   *     description: Detects the type of an SSH private key.
   *     tags:
   *       - Credentials
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               privateKey:
   *                 type: string
   *               keyPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: Key type detection result.
   *       400:
   *         description: Private key is required.
   *       500:
   *         description: Failed to detect key type.
   */
  router.post(
    "/detect-key-type",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const { privateKey, keyPassword } = req.body;

      if (!privateKey || typeof privateKey !== "string") {
        return res.status(400).json({ error: "Private key is required" });
      }

      try {
        const keyInfo = parseSSHKey(privateKey, keyPassword);

        const response = {
          success: keyInfo.success,
          keyType: keyInfo.keyType,
          detectedKeyType: keyInfo.keyType,
          hasPublicKey: !!keyInfo.publicKey,
          error: keyInfo.error || null,
        };

        res.json(response);
      } catch (error) {
        authLogger.error("Failed to detect key type", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to detect key type",
        });
      }
    },
  );

  /**
   * @openapi
   * /credentials/detect-public-key-type:
   *   post:
   *     summary: Detect SSH public key type
   *     description: Detects the type of an SSH public key.
   *     tags:
   *       - Credentials
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               publicKey:
   *                 type: string
   *     responses:
   *       200:
   *         description: Key type detection result.
   *       400:
   *         description: Public key is required.
   *       500:
   *         description: Failed to detect public key type.
   */
  router.post(
    "/detect-public-key-type",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const { publicKey } = req.body;

      if (!publicKey || typeof publicKey !== "string") {
        return res.status(400).json({ error: "Public key is required" });
      }

      try {
        const keyInfo = parsePublicKey(publicKey);

        const response = {
          success: keyInfo.success,
          keyType: keyInfo.keyType,
          detectedKeyType: keyInfo.keyType,
          error: keyInfo.error || null,
        };

        res.json(response);
      } catch (error) {
        authLogger.error("Failed to detect public key type", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to detect public key type",
        });
      }
    },
  );

  /**
   * @openapi
   * /credentials/validate-key-pair:
   *   post:
   *     summary: Validate SSH key pair
   *     description: Validates if a given SSH private key and public key match.
   *     tags:
   *       - Credentials
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               privateKey:
   *                 type: string
   *               publicKey:
   *                 type: string
   *               keyPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: Key pair validation result.
   *       400:
   *         description: Private key and public key are required.
   *       500:
   *         description: Failed to validate key pair.
   */
  router.post(
    "/validate-key-pair",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const { privateKey, publicKey, keyPassword } = req.body;

      if (!privateKey || typeof privateKey !== "string") {
        return res.status(400).json({ error: "Private key is required" });
      }

      if (!publicKey || typeof publicKey !== "string") {
        return res.status(400).json({ error: "Public key is required" });
      }

      try {
        const validationResult = validateKeyPair(
          privateKey,
          publicKey,
          keyPassword,
        );

        const response = {
          isValid: validationResult.isValid,
          privateKeyType: validationResult.privateKeyType,
          publicKeyType: validationResult.publicKeyType,
          generatedPublicKey: validationResult.generatedPublicKey,
          error: validationResult.error || null,
        };

        res.json(response);
      } catch (error) {
        authLogger.error("Failed to validate key pair", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to validate key pair",
        });
      }
    },
  );

  /**
   * @openapi
   * /credentials/generate-key-pair:
   *   post:
   *     summary: Generate new SSH key pair
   *     description: Generates a new SSH key pair.
   *     tags:
   *       - Credentials
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               keyType:
   *                 type: string
   *               keySize:
   *                 type: integer
   *               passphrase:
   *                 type: string
   *     responses:
   *       200:
   *         description: The new key pair.
   *       500:
   *         description: Failed to generate SSH key pair.
   */
  router.post(
    "/generate-key-pair",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const { keyType = "ssh-ed25519", keySize = 2048, passphrase } = req.body;

      try {
        const result = generateSSHKeyPair(keyType, keySize, passphrase);

        if (result.success && result.privateKey && result.publicKey) {
          const response = {
            success: true,
            privateKey: result.privateKey,
            publicKey: result.publicKey,
            keyType: keyType,
            format: "ssh",
            algorithm: keyType,
            keySize: keyType === "ssh-rsa" ? keySize : undefined,
            curve: keyType === "ecdsa-sha2-nistp256" ? "nistp256" : undefined,
          };

          res.json(response);
        } else {
          res.status(500).json({
            success: false,
            error: result.error || "Failed to generate SSH key pair",
          });
        }
      } catch (error) {
        authLogger.error("Failed to generate key pair", error);
        res.status(500).json({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate key pair",
        });
      }
    },
  );

  /**
   * @openapi
   * /credentials/generate-public-key:
   *   post:
   *     summary: Generate public key from private key
   *     description: Generates a public key from a given private key.
   *     tags:
   *       - Credentials
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               privateKey:
   *                 type: string
   *               keyPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: The generated public key.
   *       400:
   *         description: Private key is required.
   *       500:
   *         description: Failed to generate public key.
   */
  router.post(
    "/generate-public-key",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const { privateKey, keyPassword } = req.body;

      if (!privateKey || typeof privateKey !== "string") {
        return res.status(400).json({ error: "Private key is required" });
      }

      try {
        let privateKeyObj;
        const parseAttempts = [];

        try {
          privateKeyObj = crypto.createPrivateKey({
            key: privateKey,
            passphrase: keyPassword,
          });
        } catch (error) {
          parseAttempts.push(`Method 1 (with passphrase): ${error.message}`);
        }

        if (!privateKeyObj) {
          try {
            privateKeyObj = crypto.createPrivateKey(privateKey);
          } catch (error) {
            parseAttempts.push(
              `Method 2 (without passphrase): ${error.message}`,
            );
          }
        }

        if (!privateKeyObj) {
          try {
            privateKeyObj = crypto.createPrivateKey({
              key: privateKey,
              format: "pem",
              type: "pkcs8",
            });
          } catch (error) {
            parseAttempts.push(`Method 3 (PKCS#8): ${error.message}`);
          }
        }

        if (
          !privateKeyObj &&
          privateKey.includes("-----BEGIN RSA PRIVATE KEY-----")
        ) {
          try {
            privateKeyObj = crypto.createPrivateKey({
              key: privateKey,
              format: "pem",
              type: "pkcs1",
            });
          } catch (error) {
            parseAttempts.push(`Method 4 (PKCS#1): ${error.message}`);
          }
        }

        if (
          !privateKeyObj &&
          privateKey.includes("-----BEGIN EC PRIVATE KEY-----")
        ) {
          try {
            privateKeyObj = crypto.createPrivateKey({
              key: privateKey,
              format: "pem",
              type: "sec1",
            });
          } catch (error) {
            parseAttempts.push(`Method 5 (SEC1): ${error.message}`);
          }
        }

        if (!privateKeyObj) {
          try {
            const keyInfo = parseSSHKey(privateKey, keyPassword);

            if (keyInfo.success && keyInfo.publicKey) {
              const publicKeyString = String(keyInfo.publicKey);
              return res.json({
                success: true,
                publicKey: publicKeyString,
                keyType: keyInfo.keyType,
              });
            } else {
              parseAttempts.push(
                `SSH2 fallback: ${keyInfo.error || "No public key generated"}`,
              );
            }
          } catch (error) {
            parseAttempts.push(`SSH2 fallback exception: ${error.message}`);
          }
        }

        if (!privateKeyObj) {
          return res.status(400).json({
            success: false,
            error: "Unable to parse private key. Tried multiple formats.",
            details: parseAttempts,
          });
        }

        const publicKeyObj = crypto.createPublicKey(privateKeyObj);
        const publicKeyPem = publicKeyObj.export({
          type: "spki",
          format: "pem",
        });

        const publicKeyString =
          typeof publicKeyPem === "string"
            ? publicKeyPem
            : (publicKeyPem as Buffer).toString("utf8");

        let keyType = "unknown";
        const asymmetricKeyType = privateKeyObj.asymmetricKeyType;

        if (asymmetricKeyType === "rsa") {
          keyType = "ssh-rsa";
        } else if (asymmetricKeyType === "ed25519") {
          keyType = "ssh-ed25519";
        } else if (asymmetricKeyType === "ec") {
          keyType = "ecdsa-sha2-nistp256";
        }

        let finalPublicKey = publicKeyString;
        let formatType = "pem";

        try {
          const ssh2PrivateKey = ssh2Utils.parseKey(privateKey, keyPassword);
          if (!(ssh2PrivateKey instanceof Error)) {
            const publicKeyBuffer = ssh2PrivateKey.getPublicSSH();
            const base64Data = publicKeyBuffer.toString("base64");
            finalPublicKey = `${keyType} ${base64Data}`;
            formatType = "ssh";
          }
        } catch {
          // Ignore validation errors
        }

        const response = {
          success: true,
          publicKey: finalPublicKey,
          keyType: keyType,
          format: formatType,
        };

        res.json(response);
      } catch (error) {
        authLogger.error("Failed to generate public key", error);
        res.status(500).json({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate public key",
        });
      }
    },
  );
}
