import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  compatible,
  shellQuote,
  validStart,
} from "../../../src/backend/agents/types.js";
import { providerPath } from "../../../src/backend/agents/routes.js";
import { REMOTE_RUNNER } from "../../../src/backend/agents/remote-runner.js";

// These run sh, git and agent binaries the way a remote Linux host does.
const posix = it.skipIf(process.platform === "win32");

describe("remote agent boundaries", () => {
  it("rejects shell syntax and invalid targets", () => {
    const start = {
      agent: "pi",
      hostId: 1,
      providerId: 1,
      model: "glm",
      cwd: "/tmp",
    };
    expect(validStart(start)).toBe(true);
    for (const patch of [
      { cwd: "relative" },
      { hostId: -1 },
      { agent: "shell" },
      { executable: "pi; id" },
      { cwd: "/tmp\0" },
    ])
      expect(validStart({ ...start, ...patch })).toBe(false);
    expect(shellQuote("it's $(secret)")).toBe("'it'\\''s $(secret)'");
  });
  it("keeps model protocols explicit", () => {
    expect(compatible("claude", "openai_compatible")).toBe(false);
    expect(compatible("pi", "openai_compatible")).toBe(true);
    expect(compatible("codex", "gemini")).toBe(false);
  });
  it("limits the reverse proxy to inference endpoints", () => {
    expect(providerPath("/v1/chat/completions")).toBe("/chat/completions");
    expect(providerPath("/v1/responses")).toBe("/responses");
    expect(providerPath("/v1/files")).toBeNull();
    expect(providerPath("/v1/../admin")).toBeNull();
    expect(providerPath("//evil.test/secrets")).toBeNull();
  });
});

const fake = String.raw`#!/usr/bin/env node
const fs=require('fs'),http=require('http'),rl=require('readline');
const emit=m=>console.log(JSON.stringify(m));
const args=process.argv.slice(2);
if(args.includes('--session') && require('path').dirname(args[args.indexOf('--session')+1])===process.env.PI_CODING_AGENT_DIR) {console.error('Pi migrates session files from its config root');process.exit(1);}
if(args[0]==='serve') {
 let stream;const port=Number(args[args.indexOf('--port')+1]);
 http.createServer(async(q,r)=>{
   if(!process.env.OPENCODE_SERVER_PASSWORD || q.headers.authorization!=='Basic '+Buffer.from('opencode:'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64')){r.statusCode=401;r.end();return;}
   if(q.url==='/event'){r.writeHead(200,{'Content-Type':'text/event-stream'});r.write(': hello\n\n');stream=r;return;}
   r.setHeader('Content-Type','application/json');
   if(q.url==='/session')return r.end(JSON.stringify({id:'oc-session'}));
   if(q.url.includes('prompt_async')){let body='';for await(const d of q)body+=d;const parsed=JSON.parse(body);if(!parsed.parts.some(p=>p.type==='file' && p.mime==='image/png' && p.url==='data:image/png;base64,aW1hZ2U=')){r.statusCode=400;r.end('{}');return;}r.statusCode=204;r.end();setTimeout(()=>{stream.write('data: '+JSON.stringify({type:'message.part.updated',properties:{part:{id:'text-1',type:'text',sessionID:'oc-session'}}})+'\n\n');stream.write('data: '+JSON.stringify({type:'message.part.delta',properties:{sessionID:'oc-session',partID:'text-1',field:'text',delta:'verified'}})+'\n\n');stream.write('data: '+JSON.stringify({type:'session.idle',properties:{sessionID:'oc-session'}})+'\n\n');},30);return;}
   r.end('{}');
 }).listen(port,'127.0.0.1');
} else rl.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(args[0]==='app-server') {
  if(m.method==='initialize')emit({id:m.id,result:{}});
  if(m.method==='thread/start'||m.method==='thread/resume')emit({id:m.id,result:{thread:{id:'codex-thread'}}});
  if(m.method==='turn/start'){if(!m.params.input.some(i=>i.type==='image' && i.url==='data:image/png;base64,aW1hZ2U='))throw Error('Missing Codex image');emit({id:m.id,result:{}});emit({method:'item/agentMessage/delta',params:{delta:'verified'}});emit({method:'turn/completed',params:{turn:{status:'completed'}}});}
 } else if(args.includes('--input-format')) {
  if(m.type==='user'){if(!m.message.content.some(i=>i.type==='image' && i.source.media_type==='image/png' && i.source.data==='aW1hZ2U='))throw Error('Missing Claude image');}if(m.type==='user')emit({type:'control_request',request_id:'approval',request:{subtype:'can_use_tool',tool_name:'Read',input:{path:'/tmp'}}});
  if(m.type==='control_response'){emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'verified'}}});emit({type:'result',is_error:false});}
 } else if(m.type==='get_state') {emit({type:'response',id:m.id,success:true,data:{sessionId:'pi-session'}});
 } else if(m.type==='prompt') {
  if(m.images?.[0]?.data!=='aW1hZ2U=' || m.images?.[0]?.mimeType!=='image/png')throw Error('Missing Pi image');
  emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'verified'}});emit({type:'agent_end'});
 }
});
`;
for (const agent of ["pi", "claude", "codex", "opencode"] as const) {
  posix(
    `${agent}: native protocol streams a turn and returns to ready`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "termix-agent-test-"));
      const executable = join(dir, "fake-agent");
      const image = join(dir, "image.png");
      await writeFile(image, "image");
      await writeFile(executable, fake, { mode: 0o700 });
      const child = spawn(process.execPath, ["-e", REMOTE_RUNNER], {
        env: { ...process.env, HOME: dir },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const events: Record<string, unknown>[] = [];
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("timeout " + stderr + JSON.stringify(events))),
            12000,
          );
          let prompted = false;
          createInterface({ input: child.stdout }).on("line", (line) => {
            const m = JSON.parse(line);
            events.push(m);
            if (m.kind === "error") {
              clearTimeout(timer);
              reject(Error(m.text));
            }
            if (m.kind === "permission")
              send({ type: "answer", requestId: m.requestId, allow: true });
            if (m.kind === "status" && m.text === "ready") {
              if (!prompted) {
                prompted = true;
                send({
                  type: "prompt",
                  text: "hello",
                  attachments: [{ path: image, mime: "image/png" }],
                });
              } else {
                clearTimeout(timer);
                resolve();
              }
            }
          });
          send({
            type: "start",
            config: {
              agent,
              id: "test-session",
              cwd: dir,
              executable,
              model: "test-model",
              proxyUrl: "http://127.0.0.1:1",
              token: "temporary-token",
              providerType:
                agent === "claude" ? "anthropic" : "openai_compatible",
            },
          });
        });
        expect(
          events.some((e) => e.kind === "text" && e.text === "verified"),
        ).toBe(true);
        if (agent === "claude")
          expect(events.some((e) => e.kind === "permission")).toBe(true);
      } finally {
        send({ type: "stop" });
        await new Promise((resolve) => child.once("exit", resolve));
        await rm(dir, { recursive: true, force: true });
      }
    },
    15000,
  );
}
