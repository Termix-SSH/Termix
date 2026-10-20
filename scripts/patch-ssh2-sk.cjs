const fs = require("node:fs");

const SK_ED = "sk-ssh-ed25519@openssh.com";
const SK_EC = "sk-ecdsa-sha2-nistp256@openssh.com";

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first === -1 || source.indexOf(from, first + 1) !== -1) {
    throw new Error(`ssh2 changed (${label}); review the security key patch`);
  }
  return source.replace(from, () => to);
}

function patchKeyParserSource(source) {
  if (source.includes("// termix-sk")) return source;
  let out = replaceOnce(
    source,
    `    case 'ecdsa-sha2-nistp521':
      return true;
    case 'ssh-ed25519':
      if (eddsaSupported)
        return true;`,
    `    case 'ecdsa-sha2-nistp521':
      return true;
    case '${SK_EC}': // termix-sk
      return true;
    case '${SK_ED}':
    case 'ssh-ed25519':
      if (eddsaSupported)
        return true;`,
    "key types",
  );
  out = replaceOnce(
    out,
    `    default:
      return new Error(\`Unsupported OpenSSH public key type: \${baseType}\`);
  }

  return new OpenSSH_Public(`,
    `    case '${SK_ED}':
    case '${SK_EC}': {
      // Public blob only; the security key signs, so there is no private half.
      const rest = data.subarray(data._pos || 0);
      const typeLen = Buffer.byteLength(baseType);
      pubSSH = Buffer.allocUnsafe(4 + typeLen + rest.length);
      writeUInt32BE(pubSSH, typeLen, 0);
      pubSSH.utf8Write(baseType, 4, typeLen);
      pubSSH.set(rest, 4 + typeLen);
      algo = baseType === '${SK_ED}' ? null : 'sha256';
      break;
    }
    default:
      return new Error(\`Unsupported OpenSSH public key type: \${baseType}\`);
  }

  return new OpenSSH_Public(`,
    "parseDER",
  );
  return out;
}

function patchAgentSource(source) {
  if (source.includes("skTrailer")) return source;
  return replaceOnce(
    source,
    `              binaryParser.init(signature, 0);
              binaryParser.readString(true);
              signature = binaryParser.readString();
              binaryParser.clear();`,
    `              binaryParser.init(signature, 0);
              binaryParser.readString(true);
              signature = binaryParser.readString();
              // Security key signatures end with flags and a counter.
              const skTrailer = signature === undefined
                ? undefined
                : binaryParser.readRaw();
              binaryParser.clear();
              if (skTrailer && skTrailer.length)
                signature.skTrailer = Buffer.from(skTrailer);`,
    "agent sign response",
  );
}

function patchProtocolSource(source) {
  if (source.includes("skTrailer")) return source;
  const start = source.indexOf("  authPK(username, pubKey, keyAlgo, cbSign) {");
  const end = source.indexOf("  authHostbased(", start);
  if (start === -1 || end === -1) {
    throw new Error("ssh2 changed (authPK); review the security key patch");
  }
  let region = source.slice(start, end);
  region = replaceOnce(
    region,
    `      signature = convertSignature(signature, keyType);`,
    `      const skTrailer = signature && signature.skTrailer;
      signature = convertSignature(signature, keyType);`,
    "authPK sign",
  );
  region = replaceOnce(
    region,
    `          + 4 + algoLen + 4 + sigLen
      );`,
    `          + 4 + algoLen + 4 + sigLen + (skTrailer ? skTrailer.length : 0)
      );`,
    "authPK alloc",
  );
  region = replaceOnce(
    region,
    `      writeUInt32BE(packet, 4 + algoLen + 4 + sigLen, p += pubKeyLen);`,
    `      writeUInt32BE(
        packet,
        4 + algoLen + 4 + sigLen + (skTrailer ? skTrailer.length : 0),
        p += pubKeyLen
      );`,
    "authPK length",
  );
  region = replaceOnce(
    region,
    `      packet.set(signature, p += 4);`,
    `      packet.set(signature, p += 4);
      if (skTrailer)
        packet.set(skTrailer, p + sigLen);`,
    "authPK copy",
  );
  return source.slice(0, start) + region + source.slice(end);
}

if (require.main === module) {
  const targets = [
    ["ssh2/lib/protocol/keyParser.js", patchKeyParserSource],
    ["ssh2/lib/agent.js", patchAgentSource],
    ["ssh2/lib/protocol/Protocol.js", patchProtocolSource],
  ];
  for (const [id, patch] of targets) {
    const target = require.resolve(id);
    const source = fs.readFileSync(target, "utf8");
    const result = patch(source);
    if (result !== source) fs.writeFileSync(target, result);
  }
  console.log(
    "[patch-ssh2-sk] Security key public keys and signatures enabled",
  );
}

module.exports = {
  patchKeyParserSource,
  patchAgentSource,
  patchProtocolSource,
};
