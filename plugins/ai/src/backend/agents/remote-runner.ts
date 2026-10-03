/** Runs on the selected SSH host. Only a session-scoped proxy token reaches it. */
export const REMOTE_RUNNER = String.raw`
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {spawn} = require('node:child_process'), readline = require('node:readline');
let config, child, nativeId, turnId, serverUrl, serverAuth, ready = false, running = false, rpcId = 0;
const pending = new Map(), approvals = new Map();
const emit = (kind, text, extra = {}) => process.stdout.write(JSON.stringify({kind,text,...extra})+'\n');
const send = value => child.stdin.write(JSON.stringify(value)+'\n');
const request = (method, params) => new Promise((resolve,reject) => {
  const id=++rpcId, timer=setTimeout(()=>{pending.delete(id);reject(Error('Agent request timed out: '+method));},60000);
  pending.set(id,{resolve,reject,timer}); send({id,method,params});
});
function fail(error) { emit('error',error.message || String(error)); if(!ready) { if(child?.pid) {try{process.kill(-child.pid,'SIGTERM');}catch{}} process.stdin.destroy(); } }
function done(initial=false) { if(!initial && !running) return; running=false; emit('status','ready'); }
async function launch(args, env) {
  const managed=path.join(os.homedir(),'.local','share','termix-agent-runtime','agents',config.agent,'node_modules','.bin',config.agent);
  const executable=(!config.executable || config.executable===config.agent) && fs.existsSync(managed)?managed:(config.executable || config.agent);
  child=spawn(executable,args,{cwd:config.cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],detached:true});
  child.on('error',fail);
  child.on('exit',(code)=>{emit('status','stopped');process.exitCode=code||0;process.stdin.destroy();});
  child.stderr.on('data',d=>emit('tool',d.toString().slice(0,8000)));
  readline.createInterface({input:child.stdout}).on('line',line=>{
    try { receive(JSON.parse(line)); } catch { /* CLI startup chatter is not protocol. */ }
  });
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
}
function receive(m) {
  if(config.agent==='pi') {
    if(m.type==='response' && pending.has(m.id)) {const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.success?p.resolve(m.data):p.reject(Error(m.error));return;}
    if(m.type==='assistant_message_event' || m.type==='message_update') {
      const e=m.assistantMessageEvent || m.event;
      if(e?.type==='text_delta') emit('text',e.delta);
    }
    if(m.type==='tool_execution_start') emit('tool',m.toolName+' '+JSON.stringify(m.args));
    if(m.type==='tool_execution_end') emit('tool',JSON.stringify(m.result));
    if(m.type==='agent_end') done();
    if(m.type==='response' && m.success===false) {fail(Error(m.error || 'Pi request failed'));done();}
    if(m.type==='extension_ui_request' && ['select','confirm','input','editor'].includes(m.method)) {
      approvals.set(m.id,m); emit('permission',m.title || m.message || m.method,{requestId:m.id,choices:m.options});
    }
    return;
  }
  if(config.agent==='claude') {
    if(m.type==='system' && m.session_id) {nativeId=m.session_id;emit('native','',{nativeId});}
    if(m.type==='stream_event' && m.event?.type==='content_block_delta' && m.event.delta?.type==='text_delta') emit('text',m.event.delta.text);
    if(m.type==='stream_event' && m.event?.type==='content_block_start' && m.event.content_block?.type==='tool_use') emit('tool',m.event.content_block.name);
    if(m.type==='control_request') {
      if(m.request?.subtype==='can_use_tool') {
        approvals.set(m.request_id,m);emit('permission',m.request.tool_name+' '+JSON.stringify(m.request.input),{requestId:m.request_id});
      } else send({type:'control_response',response:{subtype:'error',request_id:m.request_id,error:'Unsupported control request'}});
    }
    if(m.type==='result') {if(m.is_error) fail(Error(m.result || m.errors?.join('\n') || 'Claude turn failed'));done();}
    return;
  }
  if(config.agent==='codex') {
    if(m.id!==undefined && !m.method && pending.has(m.id)) {
      const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);return;
    }
    if(m.id!==undefined && m.method) {
      approvals.set(String(m.id),m);emit('permission',m.method+' '+JSON.stringify(m.params),{requestId:String(m.id)});return;
    }
    if(m.method==='item/agentMessage/delta') emit('text',m.params.delta);
    if(m.method==='item/started' && m.params.item?.type!=='agentMessage') emit('tool',JSON.stringify(m.params.item));
    if(m.method==='turn/started') turnId=m.params.turn.id;
    if(m.method==='turn/completed') {if(m.params.turn.status==='failed') fail(Error(m.params.turn.error?.message || 'Codex turn failed'));done();}
    return;
  }
}
async function oc(method, route, body) {
  const r=await fetch(serverUrl+route,{method,headers:{'Content-Type':'application/json','x-opencode-directory':config.cwd,authorization:serverAuth},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  if(!r.ok) throw Error('OpenCode '+route+' returned '+r.status);
  return r.status===204?null:r.json();
}
async function ocEvents() {
  const response=await fetch(serverUrl+'/event',{headers:{'x-opencode-directory':config.cwd,authorization:serverAuth}});
  if(!response.ok || !response.body) throw Error('OpenCode event stream unavailable');
  let buffer='';const decoder=new TextDecoder(),partTypes=new Map();
  for await(const chunk of response.body) {
    buffer+=decoder.decode(chunk,{stream:true});
    let end;
    while((end=buffer.indexOf('\n\n'))>=0) {
      const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
      const data=frame.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');
      if(!data) continue;
      let e;try{e=JSON.parse(data);}catch{continue;}const p=e.properties||{};
      const sessionId=p.sessionID || p.part?.sessionID || p.info?.sessionID;
      if(sessionId!==nativeId) continue;
      if(e.type==='message.part.updated') partTypes.set(p.part.id,p.part.type);
      if(e.type==='message.part.delta' && p.field==='text' && partTypes.get(p.partID)==='text') emit('text',p.delta);
      if(e.type==='message.part.updated' && p.part?.type==='tool') emit('tool',JSON.stringify(p.part));
      if(e.type==='session.idle' || (e.type==='session.status' && p.status?.type==='idle')) done();
      if(e.type==='session.error') {fail(Error(JSON.stringify(p.error)));done();}
      if(e.type==='permission.asked' || e.type==='question.asked') {approvals.set(p.id,{...p,event:e.type});emit('permission',JSON.stringify(p),{requestId:p.id});}
    }
  }
  throw Error('OpenCode event stream closed');
}
async function start(c) {
  config=c;
  emit('tool','Starting '+c.agent+' in '+c.cwd);
  if(!fs.statSync(c.cwd).isDirectory()) throw Error('Working directory does not exist');
  const dir=path.join(os.homedir(),'.local','state','termix-agents',c.id);
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const base=c.proxyUrl, token=c.token;
  if(c.agent==='pi') {
    const agentDir=path.join(dir,'config');
    fs.mkdirSync(agentDir,{recursive:true,mode:0o700});
    fs.writeFileSync(path.join(agentDir,'models.json'),JSON.stringify({providers:{termix:{baseUrl:base+'/v1',api:c.providerType==='anthropic'?'anthropic-messages':'openai-completions',apiKey:token,models:[{id:c.model,name:c.model,reasoning:false,input:['text','image'],contextWindow:131072,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}),{mode:0o600});
    await launch(['--mode','rpc','--provider','termix','--model',c.model,'--session',path.join(dir,'session.jsonl')],{PI_CODING_AGENT_DIR:agentDir});
    const state=await new Promise((resolve,reject)=>{const id=String(++rpcId),timer=setTimeout(()=>{pending.delete(id);reject(Error('Pi startup timed out'));},60000);pending.set(id,{resolve,reject,timer});send({id,type:'get_state'});});
    nativeId=state.sessionId;emit('native','',{nativeId});
    emit('tool','Loaded '+state.messageCount+' messages from the Pi session');
  }
  if(c.agent==='claude') {
    const args=['--print','--verbose','--input-format','stream-json','--output-format','stream-json','--include-partial-messages','--permission-prompt-tool','stdio','--model',c.model];
    if(c.nativeId) args.push('--resume',c.nativeId);
    await launch(args,{ANTHROPIC_BASE_URL:base,ANTHROPIC_API_KEY:token,ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CONFIG_DIR:dir,DISABLE_UPDATES:'1',DISABLE_AUTOUPDATER:'1'});
  }
  if(c.agent==='codex') {
    await launch(['app-server','-c','model_provider="termix"','-c','model_providers.termix.name="Termix"','-c','model_providers.termix.base_url='+JSON.stringify(base+'/v1'),'-c','model_providers.termix.env_key="TERMIX_AGENT_TOKEN"','-c','model_providers.termix.wire_api="responses"'],{CODEX_HOME:dir,TERMIX_AGENT_TOKEN:token});
    await request('initialize',{clientInfo:{name:'termix',version:'1.0.0'}});send({method:'initialized'});
    const result=await request(c.nativeId?'thread/resume':'thread/start',{...(c.nativeId?{threadId:c.nativeId}:{}),cwd:c.cwd,model:c.model,approvalPolicy:'untrusted',sandbox:'workspace-write'});
    nativeId=result.thread.id;emit('native','',{nativeId});
  }
  if(c.agent==='opencode') {
    const net=require('node:net');const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
    serverUrl='http://127.0.0.1:'+port;
    // Loopback is shared with every local account; the password keeps them off the agent.
    const password=require('node:crypto').randomBytes(32).toString('hex');serverAuth='Basic '+Buffer.from('opencode:'+password).toString('base64');
    const settings={autoupdate:false,model:'termix/'+c.model,provider:{termix:{npm:c.providerType==='anthropic'?'@ai-sdk/anthropic':'@ai-sdk/openai-compatible',name:'Termix',options:{baseURL:base+'/v1',apiKey:token},models:{[c.model]:{name:c.model}}}},permission:'ask'};
    emit('tool','Starting OpenCode server');
    await launch(['serve','--hostname','127.0.0.1','--port',String(port)],{OPENCODE_CONFIG_CONTENT:JSON.stringify(settings),OPENCODE_SERVER_USERNAME:'opencode',OPENCODE_SERVER_PASSWORD:password,XDG_DATA_HOME:dir,XDG_CONFIG_HOME:dir});
    emit('tool','Waiting for OpenCode health');
    let available=false;for(let i=0;i<100;i++){try{await oc('GET','/global/health');available=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
    if(!available) throw Error('OpenCode startup timed out');
    emit('tool','Opening OpenCode session');
    nativeId=c.nativeId || (await oc('POST','/session',{})).id;emit('native','',{nativeId});
    void ocEvents().catch(fail);
  }
  ready=true;done(true);
}
async function handle(m) {
  if(m.type==='start') return start(m.config);
  if(m.type==='stop') {if(child?.pid) {try{process.kill(-child.pid,'SIGTERM');}catch{}};setTimeout(()=>process.exit(0),1500).unref();return;}
  if(!ready) throw Error('Agent is not ready');
  if(m.type==='prompt') {
    running=true;
    emit('status','running');
    try {
      const attachments=m.attachments||[],images=[];
      let text=m.text;
      for(const a of attachments) {
        if(a.mime.startsWith('image/')) {
          const fd=fs.openSync(a.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
          try {
            const stat=fs.fstatSync(fd);if(!stat.isFile() || stat.size>1024*1024) throw Error('Image exceeds 1 MiB or is no longer a regular file');
            const data=Buffer.alloc(stat.size),size=fs.readSync(fd,data,0,data.length,0);
            images.push({type:'image',data:data.subarray(0,size).toString('base64'),mimeType:a.mime});
          } finally {fs.closeSync(fd);}
        } else text+='\nAttached file on this host: '+JSON.stringify(a.path);
      }
      if(config.agent==='pi') send({type:'prompt',message:text,images});
      if(config.agent==='claude') send({type:'user',message:{role:'user',content:[{type:'text',text:text||'Please inspect the attached images.'},...images.map(i=>({type:'image',source:{type:'base64',media_type:i.mimeType,data:i.data}}))]},parent_tool_use_id:null,session_id:nativeId||''});
      if(config.agent==='codex') await request('turn/start',{threadId:nativeId,input:[{type:'text',text},...images.map(i=>({type:'image',url:'data:'+i.mimeType+';base64,'+i.data}))]});
      if(config.agent==='opencode') await oc('POST','/session/'+nativeId+'/prompt_async',{model:{providerID:'termix',modelID:config.model},parts:[{type:'text',text},...images.map(i=>({type:'file',mime:i.mimeType,url:'data:'+i.mimeType+';base64,'+i.data}))]});
    } catch(error) {fail(error);done();}
  }
  if(m.type==='cancel') {
    if(config.agent==='pi') send({type:'abort'});
    if(config.agent==='claude') send({type:'control_request',request_id:String(++rpcId),request:{subtype:'interrupt'}});
    if(config.agent==='codex' && turnId) await request('turn/interrupt',{threadId:nativeId,turnId});
    if(config.agent==='opencode') await oc('POST','/session/'+nativeId+'/abort',{});
  }
  if(m.type==='answer') {
    const a=approvals.get(m.requestId);if(!a) throw Error('Approval request expired');
    if(config.agent==='pi') send({type:'extension_ui_response',id:m.requestId,...(a.method==='confirm'?{confirmed:m.allow}:{value:m.value,cancelled:!m.allow})});
    if(config.agent==='claude') send({type:'control_response',response:{subtype:'success',request_id:m.requestId,response:m.allow?{behavior:'allow',updatedInput:a.request.input}:{behavior:'deny',message:'Denied in Termix'}}});
    if(config.agent==='codex') {
      let result={decision:m.allow?'accept':'decline'};
      if(a.method==='item/tool/requestUserInput') {if(!m.value) throw Error('Provide JSON answers for this question');result={answers:JSON.parse(m.value)};}
      else if(!a.method.endsWith('/requestApproval')) throw Error('Unsupported Codex request; stop the session');
      send({id:a.id,result});
    }
    if(config.agent==='opencode') {
      if(a.event==='question.asked') await oc('POST','/question/'+m.requestId+(m.allow?'/reply':'/reject'),m.allow?{answers:JSON.parse(m.value||'[]')}:{});
      else await oc('POST','/permission/'+m.requestId+'/reply',{reply:m.allow?'once':'reject'});
    }
    approvals.delete(m.requestId);
  }
}
readline.createInterface({input:process.stdin}).on('line',line=>{try{Promise.resolve(handle(JSON.parse(line))).catch(fail);}catch(e){fail(e);}}).on('close',()=>{if(child?.pid) {try{process.kill(-child.pid,'SIGTERM');}catch{}};});
`;
