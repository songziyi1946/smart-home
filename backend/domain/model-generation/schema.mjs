import { z } from 'zod';

export const generationError = (status, message) => Object.assign(Error(message), { status, safeGenerationError: true });
const finite = z.number().finite(), positive = finite.positive().max(100), point=z.tuple([finite,finite]);
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name=z.string().trim().min(1).max(80), color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const planSchema=z.object({
  schemaVersion:z.literal(1),width:positive,depth:positive,height:finite.min(1.8).max(8),
  footprint:z.array(point).min(3).max(64),
  rooms:z.array(z.object({id,name,bounds:z.tuple([finite,finite,finite,finite]),deviceRoomIds:z.array(z.string().min(1).max(160)).max(100),panoramaSceneId:z.string().min(1).max(160).optional()}).strict()).min(1).max(30),
  walls:z.array(z.object({id,from:point,to:point,thickness:finite.min(.04).max(1),openings:z.array(z.object({kind:z.enum(['door','window']),offset:finite.nonnegative(),width:positive,bottom:finite.nonnegative(),height:positive}).strict()).max(10)}).strict()).max(150),
  furniture:z.array(z.object({id,roomId:id,kind:z.enum(['sofa','bed','table','chair','cabinet','desk','toilet','basin','shower','plant']),x:finite,z:finite,width:finite.min(.05).max(10),depth:finite.min(.05).max(10),height:finite.min(.05).max(8),rotation:finite.min(-360).max(360),color,material:z.enum(['wood','fabric','stone','metal','ceramic','glass']),style:z.enum(['straight','rounded'])}).strict()).max(150),
  finishes:z.object({floorColor:color,wallColor:color,floorMaterial:z.enum(['wood','tile'])}).strict(),notes:z.array(z.string().max(300)).max(30),
}).strict();
const EPS=1e-6;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const onSegment=(p,a,b)=>Math.abs(cross(a,b,p))<EPS&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;
function intersects(a,b,c,d){const x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);return (x*y<0&&u*v<0)||onSegment(c,a,b)||onSegment(d,a,b)||onSegment(a,c,d)||onSegment(b,c,d);}
export function insidePolygon(point,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i];if(onSegment(point,a,b))return true;
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
function segmentInside(a,b,polygon){
  if(!insidePolygon(a,polygon)||!insidePolygon(b,polygon))return false;
  const dx=b[0]-a[0],dz=b[1]-a[1],cuts=[0,1];
  for(let i=0;i<polygon.length;i++){
    const c=polygon[i],d=polygon[(i+1)%polygon.length],ex=d[0]-c[0],ez=d[1]-c[1],denominator=dx*ez-dz*ex;
    if(Math.abs(denominator)>EPS){const t=((c[0]-a[0])*ez-(c[1]-a[1])*ex)/denominator,u=((c[0]-a[0])*dz-(c[1]-a[1])*dx)/denominator;if(t>0&&t<1&&u>=-EPS&&u<=1+EPS)cuts.push(t);}
  }
  cuts.sort((x,y)=>x-y);
  return cuts.slice(1).every((t,i)=>insidePolygon([a[0]+dx*(t+cuts[i])/2,a[1]+dz*(t+cuts[i])/2],polygon));
}
const duplicate=values=>new Set(values).size!==values.length;
export function validatePlan(input,{sceneIds=[],deviceRoomIds=[],allowDeviceBindings=true}={}){
  const plan=planSchema.parse(input),fail=message=>{throw generationError(400,message);};
  const polygon=plan.footprint;
  if(polygon.some(([x,z])=>x<0||z<0||x>plan.width||z>plan.depth))fail('户型外轮廓超出总尺寸');
  if(Math.abs(Math.min(...polygon.map(p=>p[0])))>.01||Math.abs(Math.min(...polygon.map(p=>p[1])))>.01||Math.abs(Math.max(...polygon.map(p=>p[0]))-plan.width)>.01||Math.abs(Math.max(...polygon.map(p=>p[1]))-plan.depth)>.01)fail('户型外轮廓必须与总宽、总深及原点一致');
  const area=Math.abs(polygon.reduce((sum,a,i)=>{const b=polygon[(i+1)%polygon.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
  if(area<1)fail('户型外轮廓面积过小');
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<.01)fail('户型外轮廓含重复顶点');
    for(let j=i+1;j<polygon.length;j++){if(j===i+1||(i===0&&j===polygon.length-1))continue;if(intersects(a,b,polygon[j],polygon[(j+1)%polygon.length]))fail('户型外轮廓不能自交');}
  }
  for(const values of [plan.rooms,plan.walls,plan.furniture])if(duplicate(values.map(value=>value.id)))fail('房间、墙体或家具标识重复');
  const scenes=new Set(sceneIds),devices=new Set(deviceRoomIds),inBounds=point=>point[0]>=0&&point[1]>=0&&point[0]<=plan.width&&point[1]<=plan.depth&&insidePolygon(point,polygon);
  for(const room of plan.rooms){
    const [x0,z0,x1,z1]=room.bounds;
    const corners=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
    if(x0<0||z0<0||x1<=x0||z1<=z0||x1>plan.width||z1>plan.depth||!inBounds([(x0+x1)/2,(z0+z1)/2])||corners.some((point,index)=>!segmentInside(point,corners[(index+1)%4],polygon)))fail('房间范围必须位于户型内');
    if(room.panoramaSceneId&&!scenes.has(room.panoramaSceneId))fail('房间对应的全景不属于此任务素材');
    if(duplicate(room.deviceRoomIds)||room.deviceRoomIds.some(value=>!allowDeviceBindings||!devices.has(value)))fail('请选择已有家庭房间进行设备绑定');
  }
  for(const wall of plan.walls){
    const length=Math.hypot(wall.to[0]-wall.from[0],wall.to[1]-wall.from[1]);
    if(length<.05||!inBounds(wall.from)||!inBounds(wall.to))fail('墙体长度或位置无效');
    if(!segmentInside(wall.from,wall.to,polygon))fail('墙体穿出了户型外轮廓');
    const sorted=[...wall.openings].sort((a,b)=>a.offset-b.offset);
    for(let i=0;i<sorted.length;i++){const hole=sorted[i];if(hole.offset+hole.width>length+EPS||hole.bottom+hole.height>plan.height+EPS||(hole.kind==='door'&&hole.bottom!==0)||(i&&sorted[i-1].offset+sorted[i-1].width>hole.offset+EPS))fail('门窗开口尺寸超出墙体或互相重叠');}
  }
  for(const item of plan.furniture){
    const room=plan.rooms.find(value=>value.id===item.roomId);if(!room||item.height>plan.height)fail('家具必须属于有效房间且不能超过层高');
    const angle=item.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(const [dx,dz] of [[-1,-1],[-1,1],[1,-1],[1,1]]){
      const x=item.x+dx*item.width/2*c+dz*item.depth/2*s,z=item.z-dx*item.width/2*s+dz*item.depth/2*c;
      if(!inBounds([x,z])||x<room.bounds[0]-EPS||x>room.bounds[2]+EPS||z<room.bounds[1]-EPS||z>room.bounds[3]+EPS)fail('家具超出了所属房间范围');
    }
  }
  return plan;
}
export const imageInput=z.object({name:z.string().max(120).optional(),mime:z.enum(['image/jpeg','image/png','image/webp']),dataBase64:z.string().max(3*1024*1024)}).strict();
export function imageBytes(input){
  const parsed=imageInput.parse(input),bytes=Buffer.from(parsed.dataBase64,'base64');
  if(bytes.toString('base64')!==parsed.dataBase64)return invalidImage();
  validateImage(bytes,parsed.mime);return {bytes,mime:parsed.mime,name:parsed.name};
}
const invalidImage=()=>{throw generationError(400,'请选择有效的 JPEG、PNG 或 WebP 图片（每张最多 2 MB）');};
export function validateImage(bytes,mime){
  if(!Buffer.isBuffer(bytes)||bytes.length<16||bytes.length>2*1024*1024)invalidImage();
  const valid=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR':mime==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length:false;
  if(!valid)invalidImage();
  let width=0,height=0;
  try{
    if(mime==='image/png'){
      if(bytes.length<45||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')invalidImage();
      width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
    }else if(mime==='image/jpeg'){
      let offset=2;
      while(offset+4<bytes.length){
        if(bytes[offset++]!==255)invalidImage();while(bytes[offset]===255)offset++;
        const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;
        if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
        const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)invalidImage();
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(length<8)invalidImage();height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}offset+=length;
      }
    }else{
      const kind=bytes.toString('ascii',12,16);
      if(kind==='VP8X'){width=bytes.readUIntLE(24,3)+1;height=bytes.readUIntLE(27,3)+1;}
      else if(kind==='VP8L'&&bytes[20]===0x2f){const bits=bytes.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
      else if(kind==='VP8 '&&bytes.subarray(23,26).equals(Buffer.from([0x9d,0x01,0x2a]))){width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;}
    }
  }catch{invalidImage();}
  if(!width||!height||width>8192||height>8192||width*height>25000000)throw generationError(400,'图片像素过大或格式无效，请使用长边不超过 8192 像素的图片');
  return bytes;
}
