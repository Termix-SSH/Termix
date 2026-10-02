import { hostApi } from "@/main-axios";

export async function getHostTags(): Promise<string[]> {
  return (await hostApi.get<{ tags: string[] }>("/tags")).data.tags;
}

export async function saveHostTags(tags: string[]): Promise<string[]> {
  return (await hostApi.put<{ tags: string[] }>("/tags", { tags })).data.tags;
}
