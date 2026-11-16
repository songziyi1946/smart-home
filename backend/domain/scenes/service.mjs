import {z} from 'zod';import {randomUUID} from 'node:crypto';import {DeviceCommand,deviceError} from '../devices/model.mjs';
export const SceneInput=z.object({name:z.string().trim().min(1).max(80),description:z.string().trim().max(200).default(''),actions:z.array(z.object({deviceId:z.string().min(1).max(200),command:DeviceCommand}).strict()).min(1).max(100)}).strict();
export function validateScene(input,devices){const parsed=SceneInput.parse(input);for(const action of parsed.actions){const d=devices.find(d=>d.id===action.deviceId);if(!d)throw deviceError(400,'场景引用的设备不存在');if(!d.capabilities.includes(action.command.capability))throw deviceError(400,`${d.name}不支持此能力`);}return parsed;}
export function initializeScenes(store){
 if(!store.scenes){store.scenes=['home','away','sleep'].map(id=>{
  const actions=[];for(const d of store.devices){const add=(capability,value)=>actions.push({deviceId:d.id,command:{capability,value}});
   if(d.capabilities.includes('brightness')&&d.capabilities.includes('power'))add('power',id==='home'?d.roomId==='living':id==='sleep'&&d.id==='bed');
   else if(id==='away'&&d.capabilities.includes('power'))add('power',false);
   if(d.capabilities.includes('position'))add('position',id==='home'?'open':'closed');
  }
  return {id,name:{home:'回家',away:'离家',sleep:'睡眠'}[id],description:{home:'亮起客厅灯光 · 打开窗帘',away:'关闭灯光 · 关闭空调',sleep:'留盏床头灯 · 合上窗帘'}[id],actions,version:1};
 });}
 store.sceneRuns??=[];
 // A process restart cannot safely retry physical commands.
 for(const run of store.sceneRuns)if(run.status==='running'){run.status='failed';run.reason='服务重启，执行已中断；请核对设备状态';run.finishedAt=new Date().toISOString();for(const action of run.actions){if(action.status==='executing')Object.assign(action,{status:'failed',reason:'服务中断，命令结果未知，请核对设备状态'});if(action.status==='pending')Object.assign(action,{status:'skipped',reason:'服务重启，未自动重试'});}}
 return store;
}
export function createRun(scene,actorId){return {id:randomUUID(),sceneId:scene.id,name:scene.name,actorId,status:'running',startedAt:new Date().toISOString(),actions:scene.actions.map(action=>({...structuredClone(action),status:'pending'}))};}
export async function executeRun(run,{execute,authorized,save}){
 let failed=false;
 for(const action of run.actions){
  if(failed){Object.assign(action,{status:'skipped',reason:'前序动作失败，未执行'});continue;}
  try{if(!authorized())throw deviceError(403,'会话已失效，停止场景执行');action.status='executing';save(run);await execute(action.deviceId,action.command);action.status='sent';action.finishedAt=new Date().toISOString();}
  catch(error){failed=true;action.status='failed';action.reason=error.status>=400&&error.status<=502?error.message:'命令执行或保存失败，请核对设备状态';run.reason=action.reason;}
  save(run);
 }
 run.status=failed?'failed':'completed';run.finishedAt=new Date().toISOString();save(run);return run;
}
