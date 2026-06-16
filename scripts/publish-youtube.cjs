const fs = require("fs");
const path = require("path");

function extractYoutubeId(notes) {
  const match = notes.match(
    /<!--\s*YOUTUBE\s*-->([\s\S]*?)<!--\s*\/YOUTUBE\s*-->/,
  );
  if (!match || !match[1].trim()) {
    throw new Error(
      "missing or empty <!-- YOUTUBE --> section in release notes",
    );
  }
  return parseYoutubeId(match[1].trim());
}

function parseYoutubeId(raw) {
  const value = raw.trim();
  let m = value.match(/[?&]v=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = value.match(/youtu\.be\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = value.match(/embed\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]+$/.test(value)) return value;
  throw new Error(`could not parse a YouTube video id from "${value}"`);
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `token exchange failed (${res.status}): ${await res.text()}`,
    );
  }
  const json = await res.json();
  return json.access_token;
}

async function setVideoPublic(accessToken, videoId) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/videos?part=status",
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: videoId,
        status: { privacyStatus: "public" },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `videos.update failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json();
}

async function main() {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN are required",
    );
  }

  const notesPath = path.resolve(
    process.env.RELEASE_NOTES || "RELEASE_NOTES.md",
  );
  const notes = fs.readFileSync(notesPath, "utf8");
  const videoId = extractYoutubeId(notes);

  const accessToken = await getAccessToken({
    clientId,
    clientSecret,
    refreshToken,
  });
  await setVideoPublic(accessToken, videoId);

  console.log(`Set YouTube video ${videoId} to public.`);
}

module.exports = { extractYoutubeId, parseYoutubeId };

if (require.main === module) {
  main().catch((err) => {
    console.error(`publish-youtube: ${err.message}`);
    process.exit(1);
  });
}
