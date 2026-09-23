import { authApi, handleApiError } from "@/main-axios";

/**
 * Admin allowlists of private addresses that outbound requests may reach, one
 * per core feature that makes them.
 */

export async function getNotificationPrivateEndpoints(): Promise<string[]> {
  try {
    return (await authApi.get("/users/notification-private-endpoints")).data
      .hosts;
  } catch (error) {
    throw handleApiError(error, "get notification endpoint allowlist");
  }
}

export async function getStepCaPrivateEndpoints(): Promise<string[]> {
  try {
    return (await authApi.get("/users/step-ca-private-endpoints")).data.hosts;
  } catch (error) {
    throw handleApiError(error, "get Step CA endpoint allowlist");
  }
}

export async function setStepCaPrivateEndpoints(
  hosts: string[],
): Promise<string[]> {
  try {
    return (await authApi.patch("/users/step-ca-private-endpoints", { hosts }))
      .data.hosts;
  } catch (error) {
    throw handleApiError(error, "update Step CA endpoint allowlist");
  }
}

export async function getSecretSourcePrivateEndpoints(): Promise<string[]> {
  try {
    return (await authApi.get("/users/secret-source-private-endpoints")).data
      .hosts;
  } catch (error) {
    throw handleApiError(error, "get secret source endpoint allowlist");
  }
}

export async function setSecretSourcePrivateEndpoints(
  hosts: string[],
): Promise<string[]> {
  try {
    return (
      await authApi.patch("/users/secret-source-private-endpoints", { hosts })
    ).data.hosts;
  } catch (error) {
    throw handleApiError(error, "update secret source endpoint allowlist");
  }
}

export async function setNotificationPrivateEndpoints(
  hosts: string[],
): Promise<string[]> {
  try {
    return (
      await authApi.patch("/users/notification-private-endpoints", { hosts })
    ).data.hosts;
  } catch (error) {
    throw handleApiError(error, "update notification endpoint allowlist");
  }
}
