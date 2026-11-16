import {createServer} from 'node:http';import type {Simulator} from './core.ts';
export function controlServer(sim:Simulator,connected:()=>boolean){return createServer(async(req,res)=>{
 const reply=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return reply(403,{error:'Cross-origin request denied'});
 try{const path=new URL(req.url??'/', 'http://localhost').pathname;
 if(req.method==='GET'){if(path==='/health')return reply(200,{ok:true,mqttConnected:connected()});if(path==='/devices')return reply(200,sim.devices);const m=path.match(/^\/devices\/([^/]+)$/);if(m)return reply(200,sim.get(decodeURIComponent(m[1])));}
 if(req.method==='POST'){
 if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'application/json required'});
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)return reply(413,{error:'Body too large'});}const body=JSON.parse(raw||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Object required');
 const device=path.match(/^\/devices\/([^/]+)\/state$/);if(device){const id=decodeURIComponent(device[1]);sim.patch(id,body);return reply(200,sim.get(id));}
 const scenario=path.match(/^\/scenarios\/([^/]+)\/run$/);if(scenario)return reply(200,sim.scenario(scenario[1],body));
 if(path==='/reset'){sim.reset();return reply(200,{ok:true});}}
 reply(404,{error:'Not found'});
 }catch(error){reply(400,{error:error instanceof Error?error.message:'Invalid request'});}
});}
