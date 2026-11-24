import express from 'express';
import { z } from 'zod';
import { generationError } from '../domain/model-generation/schema.mjs';

export function createGenerationRouter({service,sessionFor,subscribeAuth}){
  const router=express.Router();
  const current=req=>{const value=sessionFor(req);return value&&value.user.id===req.user?.id&&value.user.id!=='local'&&['admin','member'].includes(value.user.role)?value.user:undefined;};
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!current(req))return res.status(403).json({message:'请使用个人账号登录后生成模型'});next();});
  const large=express.json({limit:'35mb'}),small=express.json({limit:'512kb'});
  router.use((req,res,next)=>(req.method==='POST'&&['/sources','/jobs'].includes(req.path)?large:small)(req,res,next));
  const route=(action,status=200)=>async(req,res)=>{
    try{const result=await action(req);if(!current(req))throw generationError(403,'登录已过期或账号权限已失效');if(result?.bytes){res.type(result.mime).send(result.bytes);}else res.status(status).json(result);}
    catch(error){if(!res.destroyed)res.status(error instanceof z.ZodError?400:error.safeGenerationError||error.safeAiError?error.status:500).json({message:error instanceof z.ZodError?'户型或素材格式有误，请检查后重试':error.safeGenerationError||error.safeAiError?error.message:'生成任务暂时无法处理，请稍后重试'});}
  };
  router.get('/sources',route(req=>service.listSources(req.user.id)));
  router.get('/sources/:id',route(req=>service.source(req.user.id,req.params.id)));
  router.post('/sources',route(req=>service.addSource(req.user.id,req.body),201));
  router.get('/assets/:id',route(req=>service.asset(req.user.id,req.params.id)));
  router.get('/jobs',route(req=>service.listJobs(req.user.id)));
  router.post('/jobs',route(req=>service.createJob(req.user.id,req.body),202));
  router.post('/jobs/from-model',route(req=>service.fromModel(req.user.id,req.body),201));
  router.get('/jobs/:id',route(req=>service.job(req.user.id,req.params.id)));
  router.get('/jobs/:id/preview.glb',route(async req=>({mime:'model/gltf-binary',bytes:await service.preview(req.user.id,req.params.id)})));
  router.post('/jobs/:id/cancel',route(req=>{z.object({}).strict().parse(req.body??{});return service.cancel(req.user.id,req.params.id);}));
  router.put('/jobs/:id/plan',route(req=>service.updatePlan(req.user.id,req.params.id,req.body)));
  router.post('/jobs/:id/revise',route(req=>service.revise(req.user.id,req.params.id,req.body),202));
  router.post('/jobs/:id/publish',route(req=>service.publish(req.user.id,req.params.id,req.body,{authorized:()=>current(req)?.role==='admin'})));
  const unsubscribe=subscribeAuth?.(()=>service.revokeInactive())??(()=>{});
  return {router,close(){unsubscribe();service.close();}};
}
