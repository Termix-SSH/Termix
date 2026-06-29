const fs = require("fs");
const path = require("path");

const guacdClientPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "guacamole-lite",
  "lib",
  "GuacdClient.js",
);
const cryptPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "guacamole-lite",
  "lib",
  "Crypt.js",
);

if (!fs.existsSync(guacdClientPath) || !fs.existsSync(cryptPath)) {
  console.log("[patch-guacamole-lite] File not found, skipping");
  process.exit(0);
}

let guacdClientContent = fs.readFileSync(guacdClientPath, "utf8");
let cryptContent = fs.readFileSync(cryptPath, "utf8");

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

// Patch 4: answer guacd's dynamic argument requests locally.
// macOS Screen Sharing can request VNC username/password through the
// post-handshake `required`/`require` flow. guacamole-lite forwards those
// instructions to the browser, but Termix already keeps the credentials in the
// server-side token and the browser does not provide an onrequired handler.
const oldSendBuffer =
  "        this.lastActivity = Date.now();\n" + "        this.sendBuffer = '';";
const newSendBuffer =
  "        this.lastActivity = Date.now();\n" +
  "        this.sendBuffer = '';\n" +
  "        this.nextArgumentStreamIndex = 0;";

const oldSendInstructionBlock =
  "    sendInstruction(instruction) {\n" +
  "        // convert every element in the instruction array to a string. convert null to an empty string\n" +
  "        instruction = instruction.map((element) => {\n" +
  "            if (element === null || element === undefined) {\n" +
  "                return '';\n" +
  "            }\n" +
  "            return String(element);\n" +
  "        });\n" +
  "\n" +
  "        const instructionString = GuacamoleParser.toInstruction(instruction);\n" +
  "        this.send(instructionString);\n" +
  "    }\n";
const newSendInstructionBlock =
  oldSendInstructionBlock +
  "\n" +
  "    sendArgumentValue(name, value) {\n" +
  "        const stream = this.nextArgumentStreamIndex++;\n" +
  "        this.sendInstruction(['argv', stream, 'text/plain', name]);\n" +
  "        this.sendInstruction(['blob', stream, Buffer.from(String(value ?? ''), 'utf8').toString('base64')]);\n" +
  "        this.sendInstruction(['end', stream]);\n" +
  "    }\n" +
  "\n" +
  "    sendRequiredArguments(params) {\n" +
  "        params.forEach((name) => {\n" +
  "            this.sendArgumentValue(name, this.connectionSettings[name]);\n" +
  "        });\n" +
  "    }\n";

const oldReadyHandler =
  '        // Handle "ready" instruction\n' +
  "        if (opcode === 'ready') {";
const newReadyHandler =
  "        // Handle dynamic argument requests from guacd\n" +
  "        if (opcode === 'required' || opcode === 'require') {\n" +
  "            this.sendRequiredArguments(params);\n" +
  "            return;\n" +
  "        }\n" +
  "\n" +
  oldReadyHandler;

let patched = false;

if (!guacdClientContent.includes(newVersionCheck)) {
  if (!guacdClientContent.includes(oldVersionCheck)) {
    console.log(
      "[patch-guacamole-lite] Version check target not found, skipping",
    );
    process.exit(0);
  }
  guacdClientContent = guacdClientContent.replace(
    oldVersionCheck,
    newVersionCheck,
  );
  patched = true;
}

if (!guacdClientContent.includes(newTimezone)) {
  if (!guacdClientContent.includes(oldTimezone)) {
    console.log("[patch-guacamole-lite] Timezone target not found, skipping");
    process.exit(0);
  }
  guacdClientContent = guacdClientContent.replace(oldTimezone, newTimezone);
  patched = true;
}

if (!guacdClientContent.includes(newConnect)) {
  if (!guacdClientContent.includes(oldConnect)) {
    console.log(
      "[patch-guacamole-lite] Connect target not found, skipping name patch",
    );
    process.exit(0);
  }
  guacdClientContent = guacdClientContent.replace(oldConnect, newConnect);
  patched = true;
}

if (!guacdClientContent.includes("this.nextArgumentStreamIndex = 0;")) {
  if (!guacdClientContent.includes(oldSendBuffer)) {
    console.log(
      "[patch-guacamole-lite] Argument stream index target not found, skipping",
    );
    process.exit(0);
  }
  guacdClientContent = guacdClientContent.replace(oldSendBuffer, newSendBuffer);
  patched = true;
}

if (!guacdClientContent.includes("sendRequiredArguments(params) {")) {
  if (!guacdClientContent.includes(oldSendInstructionBlock)) {
    console.log(
      "[patch-guacamole-lite] Required argument helper target not found, skipping",
    );
    process.exit(0);
  }
  guacdClientContent = guacdClientContent.replace(
    oldSendInstructionBlock,
    newSendInstructionBlock,
  );
  patched = true;
}

if (
  !guacdClientContent.includes("opcode === 'required' || opcode === 'require'")
) {
  if (!guacdClientContent.includes(oldReadyHandler)) {
    console.log(
      "[patch-guacamole-lite] Required opcode target not found, skipping",
    );
    process.exit(0);
  }
  guacdClientContent = guacdClientContent.replace(
    oldReadyHandler,
    newReadyHandler,
  );
  patched = true;
}

// Patch 5: guacamole-lite decrypts token JSON through ASCII/binary strings,
// which corrupts IV/ciphertext bytes and non-ASCII connection settings such as
// RDP/VNC passwords with umlauts. Keep the encrypted fields as Buffers and
// decode the plaintext JSON as UTF-8.
const oldDecryptBlock =
  "        let encoded = JSON.parse(this.constructor.base64decode(encodedString));\n" +
  "\n" +
  "        encoded.iv = this.constructor.base64decode(encoded.iv);\n" +
  "        encoded.value = this.constructor.base64decode(encoded.value, 'binary');\n" +
  "\n" +
  "        const decipher = Crypto.createDecipheriv(this.cypher, this.key, encoded.iv);\n" +
  "\n" +
  "        let decrypted = decipher.update(encoded.value, 'binary', 'ascii');\n" +
  "        decrypted += decipher.final('ascii');";
const oldPartiallyPatchedDecryptBlock =
  "        let encoded = JSON.parse(this.constructor.base64decode(encodedString));\n" +
  "\n" +
  "        encoded.iv = this.constructor.base64decode(encoded.iv);\n" +
  "        encoded.value = this.constructor.base64decode(encoded.value, 'binary');\n" +
  "\n" +
  "        const decipher = Crypto.createDecipheriv(this.cypher, this.key, encoded.iv);\n" +
  "\n" +
  "        let decrypted = decipher.update(encoded.value, 'binary', 'utf8');\n" +
  "        decrypted += decipher.final('utf8');";
const newDecryptBlock =
  "        const encoded = JSON.parse(Buffer.from(encodedString, 'base64').toString('utf8'));\n" +
  "\n" +
  "        const iv = Buffer.from(encoded.iv, 'base64');\n" +
  "        const value = Buffer.from(encoded.value, 'base64');\n" +
  "\n" +
  "        const decipher = Crypto.createDecipheriv(this.cypher, this.key, iv);\n" +
  "\n" +
  "        let decrypted = decipher.update(value, undefined, 'utf8');\n" +
  "        decrypted += decipher.final('utf8');";

if (!cryptContent.includes(newDecryptBlock)) {
  if (cryptContent.includes(oldDecryptBlock)) {
    cryptContent = cryptContent.replace(oldDecryptBlock, newDecryptBlock);
  } else if (cryptContent.includes(oldPartiallyPatchedDecryptBlock)) {
    cryptContent = cryptContent.replace(
      oldPartiallyPatchedDecryptBlock,
      newDecryptBlock,
    );
  } else {
    console.log(
      "[patch-guacamole-lite] UTF-8 token decrypt target not found, skipping",
    );
    process.exit(0);
  }
  patched = true;
}

if (!patched) {
  console.log("[patch-guacamole-lite] Already patched");
  process.exit(0);
}

fs.writeFileSync(guacdClientPath, guacdClientContent);
fs.writeFileSync(cryptPath, cryptContent);
console.log(
  "[patch-guacamole-lite] Patched protocol VERSION_1_3_0/1_5_0 support, name handshake, required arguments, and UTF-8 token decrypt",
);
