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

const oldCheck = "if (version === '1_0_0' || version === '1_1_0') {";
const newCheck =
  "if (version === '1_0_0' || version === '1_1_0' || version === '1_3_0' || version === '1_5_0') {";

if (content.includes(newCheck)) {
  console.log("[patch-guacamole-lite] Already patched");
  process.exit(0);
}

if (!content.includes(oldCheck)) {
  console.log("[patch-guacamole-lite] Target code not found, skipping");
  process.exit(0);
}

content = content.replace(oldCheck, newCheck);
fs.writeFileSync(filePath, content);
console.log(
  "[patch-guacamole-lite] Patched to support protocol VERSION_1_3_0 and VERSION_1_5_0",
);
