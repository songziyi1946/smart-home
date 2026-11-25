import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aiError, normalizeAiBaseUrl, resolvePublic, pinnedHttpsRequest, abortable } from './transport.mjs';

const text = z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/);
const inputSchema = z.object({
  name:text.max(80), baseUrl:z.string().trim().min(1).max(2048), model:text,
  apiKey:z.string().trim().min(1).max(8192).regex(/^[\x21-\x7e]+$/),
  protocol:z.literal('openai-responses').default('openai-responses'),
}).strict();
const safe = ({id,name,baseUrl,model,protocol,createdAt}) => ({id,name,baseUrl,model,protocol,hasKey:true,createdAt});
const owner = id => { if (typeof id !== 'string' || !id || id === 'local') throw aiError(403, '请使用个人账号登录后配置 AI 服务'); return id; };
export class PersonalAiService {
  constructor({vault, resolve, transport=pinnedHttpsRequest, timeoutMs=60000}) { this.vault=vault; this.resolve=resolve; this.transport=transport; this.timeoutMs=timeoutMs; this.inflight=new Map(); }
  list(ownerId) {owner(ownerId);return {connections:this.vault.load().connections.filter(value=>value.ownerId===ownerId).map(safe),configured:true};}
  getForOwner(ownerId,id) {
    owner(ownerId);
    const value=this.vault.load().connections.find(connection=>connection.ownerId===ownerId&&connection.id===id);
    if (!value) throw aiError(404,'AI 连接不存在'); return value;
  }
  create(ownerId,input) {
    owner(ownerId); const parsed=inputSchema.parse(input), state=this.vault.load();
    if (state.connections.filter(value=>value.ownerId===ownerId).length>=10) throw aiError(400,'最多保存 10 个个人 AI 连接');
    const connection={...parsed,baseUrl:normalizeAiBaseUrl(parsed.baseUrl),id:randomUUID(),ownerId,createdAt:new Date().toISOString()};
    state.connections.push(connection); this.vault.save(state); return safe(connection);
  }
  async verify(ownerId,input,{signal}={}) {
    owner(ownerId);
    const parsed=inputSchema.parse(input);
    parsed.baseUrl=normalizeAiBaseUrl(parsed.baseUrl);
    if(this.list(ownerId).connections.length>=10)throw aiError(400,'最多保存 10 个个人 AI 连接');
    // Reuse the same guarded transport without exposing an unverified connection in the real vault.
    const connection={...parsed,id:randomUUID(),ownerId,createdAt:new Date().toISOString()};
    const temporary=new PersonalAiService({vault:{load:()=>({connections:[connection]})},resolve:this.resolve,transport:this.transport,timeoutMs:this.timeoutMs});
    try { await temporary.test(ownerId,connection.id,{signal});return parsed; }
    finally { temporary.close(); }
  }
  remove(ownerId,id) {
    this.getForOwner(ownerId,id); const state=this.vault.load(); state.connections=state.connections.filter(value=>value.id!==id||value.ownerId!==ownerId); this.vault.save(state);
    for (const active of this.inflight.values()) if (active.ownerId===ownerId&&active.connectionId===id) active.controller.abort();
    return {ok:true};
  }
  async call(ownerId,id,endpoint,payload,{signal,maxOutputTokens=6000}={}) {
    if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>12000)throw aiError(400,'AI 输出上限无效');
    const connection=this.getForOwner(ownerId,id), controller=new AbortController();
    const requestId=randomUUID(), abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted)controller.abort();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeoutMs); timer.unref?.();
    this.inflight.set(requestId,{ownerId,connectionId:id,controller});
    try {
      if(controller.signal.aborted)throw aiError(499,'AI 请求已取消');
      const url=new URL(normalizeAiBaseUrl(connection.baseUrl)+'/'+endpoint);
      const addresses=await resolvePublic(url,{resolve:this.resolve,signal:controller.signal});
      if(controller.signal.aborted)throw aiError(499,'AI 请求已取消');
      // Recheck deletion/ownership after asynchronous DNS resolution, before sending credentials.
      this.getForOwner(ownerId,id);
      const body=payload===undefined?undefined:Buffer.from(JSON.stringify({...payload,model:connection.model,store:false,max_output_tokens:maxOutputTokens,reasoning:{effort:'low'}}));
      if(body&&body.length>16*1024*1024)throw aiError(400,'AI 请求内容过大');
      const response=await abortable(this.transport({url,addresses,method:body?'POST':'GET',headers:{Authorization:'Bearer '+connection.apiKey,Accept:'application/json',...(body?{'Content-Type':'application/json','Content-Length':String(body.length)}:{})},body,signal:controller.signal,maxBytes:4*1024*1024}),controller.signal);
      if(controller.signal.aborted)throw aiError(499,'AI 请求已取消');
      this.getForOwner(ownerId,id);
      if(response.status>=300&&response.status<400)throw aiError(502,'AI 服务不允许重定向，请检查接口地址');
      if(response.status===401||response.status===403)throw aiError(502,'AI 服务认证失败，请检查 API Key 和模型权限');
      if(response.status<200||response.status>=300)throw aiError(502,'AI 服务请求失败，请稍后重试');
      if(!Buffer.isBuffer(response.body)||response.body.length>4*1024*1024)throw aiError(502,'AI 服务响应过大');
      let result;try{result=JSON.parse(response.body.toString('utf8'));}catch{throw aiError(502,'AI 服务返回了无效数据');}
      if(!result||typeof result!=='object'||Array.isArray(result))throw aiError(502,'AI 服务返回了无效数据');
      // Check decoded keys and values as well as plain text; escaped credentials must not reach drafts/backups.
      const values=[result];let inspected=0;
      while(values.length){
        if(++inspected>500000)throw aiError(502,'AI 服务返回了过于复杂的数据');
        const value=values.pop();
        if(typeof value==='string'&&value.includes(connection.apiKey))throw aiError(502,'AI 服务返回了不安全的内容，已拒绝保存');
        // Responses output_text can itself contain escaped JSON that the plan parser will decode later.
        if(typeof value==='string'&&/^[\s]*[\[{"]/.test(value)){
          try{const decoded=JSON.parse(value);if(decoded!==value)values.push(decoded);}catch{/* Ordinary prose is not a nested JSON document. */}
        }
        if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){values.push(key,child);}
      }
      return result;
    } catch(error) {
      if(timedOut)throw aiError(504,'AI 服务响应超时');
      if(controller.signal.aborted)throw aiError(499,'AI 请求已取消');
      if(error.safeAiError)throw error;
      throw aiError(502,'无法连接 AI 服务，请检查地址和网络');
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);this.inflight.delete(requestId);}
  }
  async test(ownerId,id,options) {
    const connection=this.getForOwner(ownerId,id), result=await this.call(ownerId,id,'models',undefined,options);
    if(!Array.isArray(result.data)||!result.data.some(value=>value&&value.id===connection.model))throw aiError(400,'服务没有返回所选模型，请检查模型名称和权限');
    return {ok:true};
  }
  requestResponses(ownerId,id,payload,options) {
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw aiError(400,'AI 请求格式无效');
    return this.call(ownerId,id,'responses',payload,options);
  }
  close() {for(const active of this.inflight.values())active.controller.abort();}
}
