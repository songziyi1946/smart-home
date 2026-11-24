import { Router } from 'express';
import { z } from 'zod';
import { aiError } from '../providers/ai/transport.mjs';

export function createPersonalAiRouter({service,sessionFor,subscribeAuth,allowCredentials=()=>true}) {
  const router=Router(), pending=new Set();
  const authorized=req=>{
    const current=sessionFor(req);
    return !!current&&current.user.id===req.user?.id&&current.user.id!=='local'&&['admin','member'].includes(current.user.role);
  };
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!authorized(req))return res.status(403).json({message:'请使用个人账号登录后配置 AI 服务'});
    if(!allowCredentials(req))return res.status(403).json({message:'请通过 HTTPS 或本机地址配置 AI 服务'});
    next();
  });
  const route=action=>async(req,res)=>{
    const controller=new AbortController(), entry={controller,authorized:()=>authorized(req)};
    const closed=()=>{if(!res.writableEnded)controller.abort();}; pending.add(entry);res.once('close',closed);
    try {
      const value=await action(req,controller.signal);
      if(!authorized(req))throw aiError(403,'登录已过期或账号权限已失效');
      if(!controller.signal.aborted)res.json(value);
      else if(!res.destroyed)res.status(499).json({message:'AI 请求已取消'});
    }catch(error){
      const status=!authorized(req)?403:error instanceof z.ZodError?400:error.safeAiError?error.status:500;
      const message=status===403?'登录已过期或账号权限已失效':error instanceof z.ZodError?'输入格式有误，请检查后重试':error.safeAiError?error.message:'个人 AI 配置暂时无法读取或保存';
      if(!res.destroyed)res.status(status).json({message});
    }finally{pending.delete(entry);res.off('close',closed);}
  };
  router.get('/connections',route(req=>service.list(req.user.id)));
  router.post('/connections',route(req=>{
    try{return service.create(req.user.id,req.body);}
    finally{if(req.body&&typeof req.body==='object')delete req.body.apiKey;}
  }));
  router.delete('/connections/:id',route(req=>{z.object({}).strict().parse(req.body??{});return service.remove(req.user.id,req.params.id);}));
  router.post('/connections/:id/test',route((req,signal)=>{z.object({}).strict().parse(req.body??{});return service.test(req.user.id,req.params.id,{signal});}));
  const unsubscribe=subscribeAuth?.(()=>{for(const value of pending)if(!value.authorized())value.controller.abort();})??(()=>{});
  return {router,close(){unsubscribe();for(const value of pending)value.controller.abort();pending.clear();}};
}
