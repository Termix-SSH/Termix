const fs = require("node:fs");

const original = `            default: {
              const req = new AgentInboundRequest(msgType);
              this[SYM_REQS].push(req);
              this.failureReply(req);
            }`;
const patched = `            default: {
              const req = new AgentInboundRequest(msgType);
              this[SYM_REQS].push(req);
              this.failureReply(req);
              // Discard the entire unsupported request, including its payload.
              p += this[SYM_MSGLEN] - 1;
            }`;

function patchAgentSource(source) {
  if (source.includes(patched)) return source;
  if (!source.includes(original)) {
    throw new Error(
      "ssh2 agent parser changed; review the unsupported-request patch",
    );
  }
  return source.replace(original, patched);
}

if (require.main === module) {
  const target = require.resolve("ssh2/lib/agent.js");
  const source = fs.readFileSync(target, "utf8");
  const result = patchAgentSource(source);
  if (result !== source) fs.writeFileSync(target, result);
  console.log("[patch-ssh2-agent] Unsupported request payloads are consumed");
}

module.exports = { patchAgentSource };
