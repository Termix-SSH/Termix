const fs = require("fs");
const path = require("path");

const filePath = path.join(
  __dirname,
  "..",
  "node_modules",
  "guacamole-lite",
  "lib",
  "GuacdClient.js",
);

if (!fs.existsSync(filePath)) {
  console.log("[patch-guacamole-lite] File not found, skipping");
  process.exit(0);
}

let content = fs.readFileSync(filePath, "utf8");

// Patch 1: version acceptance list
const oldVersionCheck = "if (version === '1_0_0' || version === '1_1_0') {";
const newVersionCheck =
  "if (version === '1_0_0' || version === '1_1_0' || version === '1_3_0' || version === '1_5_0') {";

// Patch 2: timezone instruction must be sent for all protocols >= 1.1.0, not just 1.1.0
const oldTimezone = "if (protocolVersion === '1_1_0') {";
const newTimezone = "if (protocolVersion !== '1_0_0') {";

// Patch 3: send the `name` handshake instruction for protocol >= 1.3.0.
// The Guacamole protocol added the `name` instruction in 1.3.0 (an optional
// human-readable identifier for the joining user). guacd 1.6.0 began requiring
// it during the VNC handshake even when negotiating older protocol versions,
// causing connections to silently drop right after "User joined". See
// Termix-SSH/Support#567 and #734.
const oldConnect =
  "        this.sendInstruction(['connect'].concat(connectArgs));";
const newConnect =
  "        if (protocolVersion === '1_3_0' || protocolVersion === '1_5_0') {\n" +
  "            this.sendInstruction(['name', this.connectionSettings.name || 'guacamole-lite']);\n" +
  "        }\n" +
  "\n" +
  "        this.sendInstruction(['connect'].concat(connectArgs));";

let patched = false;

if (!content.includes(newVersionCheck)) {
  if (!content.includes(oldVersionCheck)) {
    console.log(
      "[patch-guacamole-lite] Version check target not found, skipping",
    );
    process.exit(0);
  }
  content = content.replace(oldVersionCheck, newVersionCheck);
  patched = true;
}

if (!content.includes(newTimezone)) {
  if (!content.includes(oldTimezone)) {
    console.log("[patch-guacamole-lite] Timezone target not found, skipping");
    process.exit(0);
  }
  content = content.replace(oldTimezone, newTimezone);
  patched = true;
}

if (!content.includes(newConnect)) {
  if (!content.includes(oldConnect)) {
    console.log(
      "[patch-guacamole-lite] Connect target not found, skipping name patch",
    );
    process.exit(0);
  }
  content = content.replace(oldConnect, newConnect);
  patched = true;
}

if (!patched) {
  console.log("[patch-guacamole-lite] Already patched");
  process.exit(0);
}

fs.writeFileSync(filePath, content);
console.log(
  "[patch-guacamole-lite] Patched to support protocol VERSION_1_3_0 and VERSION_1_5_0 with name handshake instruction",
);
