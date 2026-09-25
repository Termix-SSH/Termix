import { authApi, handleApiError } from "@/main-axios";

export type TlsCertificateInfo = {
  subject: string;
  issuer: string;
  names: string[];
  notBefore: string;
  notAfter: string;
  selfSigned: boolean;
  fingerprint: string;
};

export type TlsStatus = {
  enabled: boolean;
  certificate: TlsCertificateInfo | null;
  renewal: { pluginId: string; pluginName: string } | null;
};

export async function getTlsStatus(): Promise<TlsStatus> {
  try {
    const response = await authApi.get("/users/tls-certificate");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch TLS certificate status");
  }
}

export async function uploadTlsCertificate(payload: {
  certificate: string;
  privateKey: string;
}): Promise<TlsStatus & { success: boolean; reloadMessage?: string }> {
  try {
    const response = await authApi.post("/users/tls-certificate", payload);
    return response.data;
  } catch (error) {
    handleApiError(error, "upload TLS certificate");
  }
}
