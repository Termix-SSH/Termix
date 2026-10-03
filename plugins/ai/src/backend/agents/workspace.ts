import type { Client, ClientChannel } from "ssh2";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { shellQuote, type AgentSession } from "./types.js";

/** Fixed operations; all paths and content arrive as JSON on stdin, never shell source. */
export const REMOTE_WORKSPACE = String.raw`
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const MAX=1024*1024;
function imageMime(data) {
  if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(data[0]===255 && data[1]===216 && data[2]===255) return 'image/jpeg';
  if(['GIF87a','GIF89a'].includes(data.subarray(0,6).toString())) return 'image/gif';
  if(data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP') return 'image/webp';
  return 'application/octet-stream';
}
function main(m) {
  const cwd=fs.realpathSync(m.cwd), body=m.body;
  const inside=(value,missing=false)=>{
    if(typeof value!=='string' || value.includes('\0')) throw Error('Invalid path');
    const requested=path.resolve(cwd,value);
    let ancestor=requested;
    if(missing) while(!fs.existsSync(ancestor) && path.dirname(ancestor)!==ancestor) ancestor=path.dirname(ancestor);
    const p=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,requested));
    const relative=path.relative(cwd,p);
    if(relative==='..' || relative.startsWith('../') || path.isAbsolute(relative)) throw Error('Choose a file inside the working directory');
    return p;
  };
  function file(p) {
    const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const stat=fs.fstatSync(fd);
      if(!stat.isFile() || stat.size>MAX) throw Error('Choose a regular file no larger than 1 MiB');
      const data=Buffer.alloc(stat.size), size=fs.readSync(fd,data,0,data.length,0);
      return data.subarray(0,size);
    } finally {fs.closeSync(fd);}
  }
  function git(args) {
    return execFileSync('git',['--no-pager','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd,encoding:'utf8',maxBuffer:2*MAX,timeout:20000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}});
  }
  if(body.operation==='upload' || body.operation==='reference') {
    let p,data;
    if(body.operation==='reference') {p=inside(body.path);data=file(p);}
    else {
      if(typeof body.name!=='string' || !body.name || body.name.length>255 || body.name.includes('\0') || typeof body.data!=='string' || body.data.length>Math.ceil(MAX/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw Error('Invalid upload (maximum 1 MiB)');
      data=Buffer.from(body.data,'base64');
      if(data.length>MAX) throw Error('Upload exceeds 1 MiB');
      const dir=path.join(os.homedir(),'.local','state','termix-agents',m.id,'attachments');
      fs.mkdirSync(dir,{recursive:true,mode:0o700});
      p=path.join(dir,require('node:crypto').randomUUID()+'-'+path.basename(body.name).replace(/[^\p{L}\p{N}._-]/gu,'_'));
      fs.writeFileSync(p,data,{mode:0o600,flag:'wx'});
    }
    return {id:require('node:crypto').randomUUID(),name:body.operation==='upload'?path.basename(body.name):path.basename(p),path:p,mime:imageMime(data),size:data.length};
  }
  if(body.operation==='status') {
    const root=git(['rev-parse','--show-toplevel']).trim();
    const records=git(['status','--porcelain=v1','-z','--untracked-files=all']).split('\0'),files=[];
    for(let i=0;i<records.length;i++){const row=records[i];if(!row) continue;const rel=path.relative(cwd,path.join(root,row.slice(3)));if(rel!=='..' && !rel.startsWith('../')) files.push({status:row.slice(0,2),path:rel});if(/[RC]/.test(row.slice(0,2))) i++;}
    return {files,branch:git(['branch','--show-current']),diff:git(['diff','--no-ext-diff','--no-textconv','--stat'])+git(['diff','--cached','--no-ext-diff','--no-textconv','--stat'])};
  }
  if(body.operation==='diff') {
    const p=inside(body.path,true),rel=path.relative(cwd,p);if(fs.existsSync(p)) file(p);
    let tracked=true;try{git(['ls-files','--error-unmatch','--',rel]);}catch{tracked=false;}
    if(!tracked) {
      const data=file(p);
      return {diff:data.includes(0)?'Binary untracked file':data.toString('utf8').split('\n').map(l=>'+'+l).join('\n')};
    }
    return {diff:'--- Unstaged ---\n'+git(['diff','--no-ext-diff','--no-textconv','--',rel])+'\n--- Staged ---\n'+git(['diff','--cached','--no-ext-diff','--no-textconv','--',rel])};
  }
  if(body.operation==='worktree') {
    if(typeof body.branch!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(body.branch)) throw Error('Invalid branch name');
    git(['check-ref-format','--branch',body.branch]);
    const dir=path.join(os.homedir(),'.local','state','termix-agents','worktrees');fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const target=path.join(dir,require('node:crypto').randomUUID());
    git(['worktree','add','-b',body.branch,'--',target,'HEAD']);
    return {path:target,branch:body.branch};
  }
  throw Error('Unknown workspace operation');
}
let input='';process.stdin.on('data',d=>{input+=d;if(input.length>2*MAX) {process.stderr.write('Request too large');process.exit(1);}});
process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(main(JSON.parse(input))));}catch(e){process.stderr.write(e.message);process.exitCode=1;}});
`;

export async function workspaceOperation(
  ctx: PluginContext,
  s: AgentSession,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (
    !["upload", "reference", "status", "diff", "worktree"].includes(
      String(body.operation),
    )
  )
    throw Error("Unknown workspace operation");
  if (JSON.stringify(body).length > 1500000)
    throw Error("Upload exceeds 1 MiB");
  const connection = await ctx.ssh.connect<Client>(s.hostId, {
    purpose: "ai-agent-workspace",
    profile: "session",
    timeoutMs: 15000,
  });
  let channel: ClientChannel | undefined;
  try {
    const command =
      'export PATH="$HOME/.local/share/termix-agent-runtime/node/bin:$PATH"; exec node -e ' +
      shellQuote(REMOTE_WORKSPACE);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        channel?.close();
        reject(Error("Workspace operation timed out"));
      }, 30000);
      connection.client.exec("sh -lc " + shellQuote(command), (error, ch) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        channel = ch;
        let output = "",
          stderr = "";
        ch.on("data", (d: Buffer) => {
          output += d.toString();
          if (output.length > 3 * 1024 * 1024) {
            ch.close();
            reject(Error("Result exceeds 3 MiB; choose a smaller file"));
          }
        });
        ch.stderr.on("data", (d: Buffer) => {
          stderr = (stderr + d.toString()).slice(-8000);
        });
        ch.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        ch.on("close", (code: number) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(Error(stderr || "Workspace operation failed"));
            return;
          }
          try {
            resolve(JSON.parse(output));
          } catch {
            reject(Error("Invalid workspace response"));
          }
        });
        ch.end(JSON.stringify({ id: s.id, cwd: s.cwd, body }));
      });
    });
  } finally {
    connection.dispose();
  }
}
