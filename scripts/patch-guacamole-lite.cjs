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
const clientConnectionPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "guacamole-lite",
  "lib",
  "ClientConnection.js",
);

if (
  !fs.existsSync(guacdClientPath) ||
  !fs.existsSync(cryptPath) ||
  !fs.existsSync(clientConnectionPath)
) {
  console.log("[patch-guacamole-lite] File not found, skipping");
  process.exit(0);
}

let guacdClientContent = fs.readFileSync(guacdClientPath, "utf8");
let cryptContent = fs.readFileSync(cryptPath, "utf8");
let clientConnectionContent = fs.readFileSync(clientConnectionPath, "utf8");

// Patch 1: protocol version negotiation.
// guacamole-lite originally only accepted 1.0.0/1.1.0. Support the protocol
// versions Termix can handle, and conservatively answer future 1.x versions as
// VERSION_1_5_0 so guacd still sees support for `require`/`name` without us
// claiming support for unknown instructions.
const oldVersionBlock =
  "                if (version === '1_0_0' || version === '1_1_0') {\n" +
  "                    protocolVersion = version;\n" +
  "                } else {\n" +
  "                    protocolVersion = '1_1_0';\n" +
  "                }";
const oldPatchedVersionBlock =
  "                if (version === '1_0_0' || version === '1_1_0' || version === '1_3_0' || version === '1_5_0') {\n" +
  "                    protocolVersion = version;\n" +
  "                } else {\n" +
  "                    protocolVersion = '1_1_0';\n" +
  "                }";
const newVersionBlock =
  "                if (version === '1_0_0' || version === '1_1_0' || version === '1_3_0' || version === '1_5_0') {\n" +
  "                    protocolVersion = version;\n" +
  "                } else if (/^1_\\d+_0$/.test(version)) {\n" +
  "                    protocolVersion = '1_5_0';\n" +
  "                } else {\n" +
  "                    protocolVersion = '1_1_0';\n" +
  "                }";

// Patch 2: timezone instruction must be sent for all protocols >= 1.1.0, not just 1.1.0
const oldTimezone = "if (protocolVersion === '1_1_0') {";
const newTimezone = "if (protocolVersion !== '1_0_0') {";

// Patch 3: send the `name` handshake instruction for all protocol versions >= 1.1.0.
// The Guacamole protocol added `name` in 1.3.0, but guacd 1.6.0 began requiring it
// during the VNC handshake even when negotiating VERSION_1_1_0, causing connections to
// silently drop right after "User joined". Sending it for all non-1.0.0 sessions is
// harmless (guacd ignores unknown handshake instructions for older versions). See
// Termix-SSH/Support#567 and #734.
const oldConnect =
  "        this.sendInstruction(['connect'].concat(connectArgs));";
const oldNameConnect =
  "        if (protocolVersion === '1_3_0' || protocolVersion === '1_5_0') {\n" +
  "            this.sendInstruction(['name', this.connectionSettings.name || 'guacamole-lite']);\n" +
  "        }\n" +
  "\n" +
  "        this.sendInstruction(['connect'].concat(connectArgs));";
const newConnect =
  "        if (protocolVersion !== '1_0_0') {\n" +
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

if (!guacdClientContent.includes("} else if (/^1_\\d+_0$/.test(version)) {")) {
  if (guacdClientContent.includes(oldPatchedVersionBlock)) {
    guacdClientContent = guacdClientContent.replace(
      oldPatchedVersionBlock,
      newVersionBlock,
    );
  } else if (guacdClientContent.includes(oldVersionBlock)) {
    guacdClientContent = guacdClientContent.replace(
      oldVersionBlock,
      newVersionBlock,
    );
  } else {
    console.log(
      "[patch-guacamole-lite] Version check target not found, skipping",
    );
    process.exit(0);
  }
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
  if (guacdClientContent.includes(oldNameConnect)) {
    guacdClientContent = guacdClientContent.replace(oldNameConnect, newConnect);
  } else if (guacdClientContent.includes(oldConnect)) {
    guacdClientContent = guacdClientContent.replace(oldConnect, newConnect);
  } else {
    console.log(
      "[patch-guacamole-lite] Connect target not found, skipping name patch",
    );
    process.exit(0);
  }
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

// Patch 7: drop client-to-guacd input instructions from read-only session-share
// joins. guacd has no native read-only enforcement in the versions this project
// targets, so Termix must gate here. Denylist (not allowlist) on purpose: an
// unrecognized opcode is far more likely to be protocol plumbing (sync, blob,
// clipboard streams) than a new input vector, so failing open is the safer
// default for a client we already control.
const oldSendMessageToGuacd =
  "    sendMessageToGuacd(message) {\n" +
  "        this.lastActivity = Date.now();\n" +
  "        this.logger.log(LOGLEVEL.DEBUG, '[ >>> #     ]    Received from WS: ```' + message + '```');\n" +
  "\n" +
  "        if (this.guacdClient) {\n" +
  "            this.guacdClient.send(message, true);\n" +
  "        }\n" +
  "    }";
const newSendMessageToGuacd =
  "    sendMessageToGuacd(message) {\n" +
  "        this.lastActivity = Date.now();\n" +
  "        this.logger.log(LOGLEVEL.DEBUG, '[ >>> #     ]    Received from WS: ```' + message + '```');\n" +
  "\n" +
  "        if (this.isReadOnlyJoin() && this.isInputInstruction(message)) {\n" +
  "            return;\n" +
  "        }\n" +
  "\n" +
  "        if (this.guacdClient) {\n" +
  "            this.guacdClient.send(message, true);\n" +
  "        }\n" +
  "    }\n" +
  "\n" +
  "    isReadOnlyJoin() {\n" +
  "        const connection = this.connectionSettings && this.connectionSettings.connection;\n" +
  "        return !!(connection && connection.join && connection.readOnly === true);\n" +
  "    }\n" +
  "\n" +
  "    // Termix-only read-only gate, not part of the vendored library: extracts just\n" +
  "    // the leading opcode from a raw '<len>.<opcode>,...;' instruction without the\n" +
  "    // overhead of a full stateful parse.\n" +
  "    isInputInstruction(message) {\n" +
  "        const dot = message.indexOf('.');\n" +
  "        if (dot === -1) return false;\n" +
  "        const len = parseInt(message.substring(0, dot), 10);\n" +
  "        if (isNaN(len)) return false;\n" +
  "        const opcode = message.substring(dot + 1, dot + 1 + len);\n" +
  "        return ['mouse', 'key', 'touch', 'size'].includes(opcode);\n" +
  "    }";

if (!clientConnectionContent.includes("isReadOnlyJoin()")) {
  if (!clientConnectionContent.includes(oldSendMessageToGuacd)) {
    console.log(
      "[patch-guacamole-lite] sendMessageToGuacd target not found, skipping read-only patch",
    );
    process.exit(0);
  }
  clientConnectionContent = clientConnectionContent.replace(
    oldSendMessageToGuacd,
    newSendMessageToGuacd,
  );
  patched = true;
}

// Patch 8: mergeConnectionOptions only preserves `join` across the settings
// merge, dropping Termix's `readOnly` flag before sendMessageToGuacd can see it.
const oldPreserveJoin =
  "        // For join connections, preserve the join property\n" +
  "        if (this.connectionSettings.connection.join) {\n" +
  "            compiledSettings.join = this.connectionSettings.connection.join;\n" +
  "        }";
const newPreserveJoin =
  "        // For join connections, preserve the join property\n" +
  "        if (this.connectionSettings.connection.join) {\n" +
  "            compiledSettings.join = this.connectionSettings.connection.join;\n" +
  "            compiledSettings.readOnly = this.connectionSettings.connection.readOnly === true;\n" +
  "        }";

if (!clientConnectionContent.includes("compiledSettings.readOnly")) {
  if (!clientConnectionContent.includes(oldPreserveJoin)) {
    console.log(
      "[patch-guacamole-lite] join-preserve target not found, skipping readOnly propagation patch",
    );
    process.exit(0);
  }
  clientConnectionContent = clientConnectionContent.replace(
    oldPreserveJoin,
    newPreserveJoin,
  );
  patched = true;
}

if (!patched) {
  console.log("[patch-guacamole-lite] Already patched");
  process.exit(0);
}

fs.writeFileSync(guacdClientPath, guacdClientContent);
fs.writeFileSync(cryptPath, cryptContent);
fs.writeFileSync(clientConnectionPath, clientConnectionContent);
console.log(
  "[patch-guacamole-lite] Patched protocol VERSION_1_3_0/1_5_0 support, name handshake, required arguments, UTF-8 token decrypt, and read-only join input filtering",
);
