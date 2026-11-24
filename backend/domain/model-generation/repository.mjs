import { generationError } from './schema.mjs';

const recordContext=row=>`model-generation:${row.kind}:${row.id}:${row.owner_id}:${row.revision}`;
const assetContext=row=>`model-generation:asset:${row.id}:${row.owner_id}:${row.source_id}:${row.mime}`;
export class GenerationRepository {
  constructor(store){this.store=store;}
  decode(row){return JSON.parse(this.store.encryption.open(row.payload,recordContext(row)));}
  list(kind,ownerId){return this.store.db.prepare('SELECT * FROM model_generation_records WHERE kind=? AND owner_id=? ORDER BY rowid DESC').all(kind,ownerId).map(row=>this.decode(row));}
  get(kind,ownerId,id){const row=this.store.db.prepare('SELECT * FROM model_generation_records WHERE kind=? AND owner_id=? AND id=?').get(kind,ownerId,id);if(!row)throw generationError(404,'生成任务或素材不存在');return this.decode(row);}
  isPublishedSource(id){return !!id&&!!this.store.loadModelLibrary()?.models.some(model=>model.versions.some(version=>version.sourceId===id));}
  source(ownerId,id){
    const row=this.store.db.prepare("SELECT * FROM model_generation_records WHERE kind='source' AND id=?").get(id);
    if(!row||(row.owner_id!==ownerId&&!this.isPublishedSource(id)))throw generationError(404,'全景素材不存在');return this.decode(row);
  }
  save(kind,ownerId,value,{expectedRevision,assets=[]}={}){
    this.store.transaction(()=>{
      const previous=this.store.db.prepare('SELECT * FROM model_generation_records WHERE id=?').get(value.id);
      if(previous&&(previous.owner_id!==ownerId||previous.kind!==kind))throw generationError(404,'生成任务或素材不存在');
      if(expectedRevision!==undefined&&(!previous||previous.revision!==expectedRevision))throw generationError(409,'任务已变化，请刷新后重试');
      if(expectedRevision===undefined&&previous)throw generationError(409,'任务已存在');
      const newBytes=assets.reduce((sum,item)=>sum+item.bytes.length,0);
      const total=this.store.db.prepare('SELECT coalesce(sum(size),0) AS n FROM model_generation_assets').get().n;
      const used=this.store.db.prepare('SELECT coalesce(sum(size),0) AS n FROM model_generation_assets WHERE owner_id=?').get(ownerId).n;
      if(total+newBytes>100*1024*1024||used+newBytes>60*1024*1024)throw generationError(413,'生成素材存储额度已满（个人 60 MB，家庭 100 MB）');
      for(const asset of assets){
        const row={id:asset.id,owner_id:ownerId,source_id:asset.sourceId??'',mime:asset.mime};
        this.store.db.prepare('INSERT INTO model_generation_assets(id,owner_id,source_id,mime,size,payload) VALUES(?,?,?,?,?,?)').run(row.id,row.owner_id,row.source_id,row.mime,asset.bytes.length,this.store.encryption.seal(asset.bytes,assetContext(row)));
      }
      const row={id:value.id,owner_id:ownerId,kind,revision:value.revision??0};
      this.store.db.prepare('INSERT INTO model_generation_records(id,owner_id,kind,revision,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(row.id,row.owner_id,row.kind,row.revision,this.store.encryption.seal(Buffer.from(JSON.stringify(value)),recordContext(row)));
    });return structuredClone(value);
  }
  asset(ownerId,id){const row=this.store.db.prepare('SELECT * FROM model_generation_assets WHERE id=?').get(id);if(!row||(row.owner_id!==ownerId&&!this.isPublishedSource(row.source_id)))throw generationError(404,'素材图片不存在');return {mime:row.mime,bytes:this.store.encryption.open(row.payload,assetContext(row))};}
  recover(){for(const row of this.store.db.prepare("SELECT * FROM model_generation_records WHERE kind='job'").all()){const job=this.decode(row);if(['queued','reading'].includes(job.status)){job.status='interrupted';job.stage='任务已中断';job.error='服务重启中断了任务，请确认后重新生成；不会自动再次调用 AI。';job.revision++;job.updatedAt=new Date().toISOString();this.save('job',row.owner_id,job,{expectedRevision:row.revision});}}}
}
