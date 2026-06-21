import { authApi, handleApiError } from "@/main-axios";

export type AcmeChallengeType = "http-webroot" | "dns-cloudflare";

export type AcmeSettings = {
  enabled: boolean;
  domain: string;
  email: string;
  challengeType: AcmeChallengeType;
  cloudflareToken: string;
  lastIssuedAt: string | null;
  certStatus: "none" | "valid" | "expiring" | "expired";
  certExpiresAt: string | null;
};

export async function getAcmeSslSettings(): Promise<AcmeSettings> {
  try {
    const response = await authApi.get("/users/acme-ssl-settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch ACME SSL settings");
  }
}

export async function updateAcmeSslSettings(
  settings: Partial<
    Omit<AcmeSettings, "certStatus" | "certExpiresAt" | "lastIssuedAt">
  >,
): Promise<AcmeSettings> {
  try {
    const response = await authApi.patch("/users/acme-ssl-settings", settings);
    return response.data;
  } catch (error) {
    handleApiError(error, "update ACME SSL settings");
  }
}

export async function requestAcmeCertificate(): Promise<
  AcmeSettings & { success: boolean }
> {
  try {
    const response = await authApi.post("/users/acme-ssl-request", {});
    return response.data;
  } catch (error) {
    handleApiError(error, "request ACME certificate");
  }
}
