const API = "https://api.crowdin.com/api/v2";
const ENGINE_ID = 649248; // Google Translate MT engine
const PROJECT_NAME = "termix-ssh";
const SOURCE_FILE = "en.json";

function token() {
  const t = process.env.CROWDIN_API_KEY;
  if (!t) throw new Error("CROWDIN_API_KEY is not set");
  return t;
}

async function request(method, pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${pathname} -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function paged(pathname) {
  const items = [];
  let offset = 0;
  const limit = 500;
  for (;;) {
    const sep = pathname.includes("?") ? "&" : "?";
    const page = await request(
      "GET",
      `${pathname}${sep}limit=${limit}&offset=${offset}`,
    );
    const batch = (page.data || []).map((row) => row.data);
    items.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return items;
}

async function resolveProjectId() {
  const projects = await paged("/projects");
  const match = projects.find(
    (p) => p.identifier === PROJECT_NAME || p.name === PROJECT_NAME,
  );
  if (!match) throw new Error(`project "${PROJECT_NAME}" not found`);
  return { id: match.id, targetLanguageIds: match.targetLanguageIds || [] };
}

async function resolveFileId(projectId) {
  const files = await paged(`/projects/${projectId}/files`);
  const match = files.find(
    (f) => f.name === SOURCE_FILE || f.path === `/${SOURCE_FILE}`,
  );
  if (!match)
    throw new Error(`source file "${SOURCE_FILE}" not found in project`);
  return match.id;
}

async function pollPreTranslation(projectId, preTranslationId) {
  for (;;) {
    const { data } = await request(
      "GET",
      `/projects/${projectId}/pre-translations/${preTranslationId}`,
    );
    if (data.status === "finished") return data;
    if (data.status === "failed" || data.status === "canceled") {
      throw new Error(
        `pre-translation ${data.status} (progress ${data.progress}%)`,
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function main() {
  const { id: projectId, targetLanguageIds } = await resolveProjectId();
  if (targetLanguageIds.length === 0) {
    throw new Error("project has no target languages configured");
  }

  const fileId = await resolveFileId(projectId);

  console.log(
    `Pre-translating project ${projectId}, file ${fileId}, ${targetLanguageIds.length} languages via MT engine ${ENGINE_ID}`,
  );

  const { data } = await request(
    "POST",
    `/projects/${projectId}/pre-translations`,
    {
      languageIds: targetLanguageIds,
      fileIds: [fileId],
      method: "mt",
      engineId: ENGINE_ID,
      scope: "untranslated",
    },
  );

  const result = await pollPreTranslation(projectId, data.identifier);
  console.log(`Pre-translation finished (${result.progress}%)`);
}

module.exports = {
  resolveProjectId,
  resolveFileId,
  pollPreTranslation,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`crowdin-pretranslate: ${err.message}`);
    process.exit(1);
  });
}
