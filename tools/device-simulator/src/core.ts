import { EventEmitter } from 'node:events';
export type State = Record<string, number | string | boolean>;
export type VirtualDevice = { id: string; type: string; name: string; state: State; online: boolean };
export const home: VirtualDevice[] = [
  {id:'sim_living_room_light',type:'light',name:'客厅主灯',state:{power:false,brightness:70,colorTemperature:3500},online:true},
  {id:'sim_bedroom_light',type:'light',name:'主卧灯',state:{power:false,brightness:70,colorTemperature:3500},online:true},
  {id:'sim_living_room_curtain',type:'cover',name:'客厅窗帘',state:{position:20,target:20},online:true},
  {id:'sim_living_room_environment',type:'environment',name:'客厅环境',state:{temperature:24,humidity:45,pm25:12,co2:650},online:true},
  {id:'sim_living_room_motion',type:'motion',name:'客厅人体',state:{occupancy:false},online:true},
  {id:'sim_bedroom_ac',type:'climate',name:'主卧空调',state:{hvacMode:'off',targetTemperature:23,currentTemperature:27},online:true},
  {id:'sim_entrance_contact',type:'contact',name:'玄关门磁',state:{contact:'closed'},online:true},
  {id:'sim_robot_vacuum',type:'vacuum',name:'扫地机器人',state:{activity:'docked',battery:92},online:true},
];
const ranges: Record<string,number[]>={brightness:[1,100],colorTemperature:[2000,6500],position:[0,100],target:[0,100],temperature:[-50,100],humidity:[0,100],pm25:[0,1000],co2:[0,10000],targetTemperature:[16,30],currentTemperature:[-50,100],battery:[0,100]};
export class Simulator extends EventEmitter {
  devices=structuredClone(home);
  now=0;
  jobs: {at:number;run:()=>void;dock?:string}[]=[];
  get(id:string){const d=this.devices.find(d=>d.id===id);if(!d)throw Error('设备不存在');return d;}
  later(delay:number,run:()=>void){this.jobs.push({at:this.now+delay,run});}
  patch(id:string,input:Record<string,unknown>){
    const d=this.get(id);
    for(const [key,value] of Object.entries(input)){
      if(key==='online'){if(typeof value!=='boolean')throw Error('online 必须为布尔值');continue;}
      if(!(key in d.state))throw Error('不支持的状态字段');
      if(ranges[key]){if(typeof value!=='number'||!Number.isFinite(value)||value<ranges[key][0]||value>ranges[key][1])throw Error('状态数值越界');}
      else if(typeof d.state[key]==='boolean'){if(typeof value!=='boolean')throw Error('状态类型错误');}
      else if(!({hvacMode:['off','cool','heat','auto'],activity:['idle','cleaning','paused','returning','docked'],contact:['open','closed']} as Record<string,string[]>)[key]?.includes(String(value)))throw Error('状态值无效');
    }
    const before=JSON.stringify(d);
    for(const [key,value] of Object.entries(input))if(key==='online')d.online=value as boolean;else d.state[key]=value as State[string];
    if(before!==JSON.stringify(d))this.emit('change',structuredClone(d));
  }
  command(id:string,patch:Record<string,unknown>){
    const d=this.get(id);if(!d.online)return false;
    // Validate before queuing, without changing the device state.
    const previous=structuredClone(d);const probe=new Simulator();probe.devices=[previous];probe.patch(id,patch);
    this.later(d.type==='light'?200:100,()=>{if(this.get(id).online)this.patch(id,patch);});return true;
  }
  advance(ms:number){
    this.now+=ms;
    const ready=this.jobs.filter(j=>j.at<=this.now);this.jobs=this.jobs.filter(j=>j.at>this.now);for(const job of ready)job.run();
    for(const d of this.devices){if(!d.online)continue;const s=d.state;
      const move=(from:number,to:number,rate:number)=>from+Math.sign(to-from)*Math.min(Math.abs(to-from),rate*ms/1000);
      if(d.type==='cover'&&s.position!==s.target)this.patch(d.id,{position:move(Number(s.position),Number(s.target),20)});
      if(d.type==='climate'&&s.hvacMode!=='off'){
        const current=Number(s.currentTemperature),target=Number(s.targetTemperature);
        if(s.hvacMode==='auto'||s.hvacMode==='cool'&&current>target||s.hvacMode==='heat'&&current<target)this.patch(d.id,{currentTemperature:Math.round(move(current,target,.15)*1000)/1000});
      }
      if(d.type==='vacuum'){
        if(s.activity==='returning'&&!this.jobs.some(j=>j.dock===d.id)){const job={at:this.now+3000,run:()=>{if(d.online&&d.state.activity==='returning')this.patch(d.id,{activity:'docked'});},dock:d.id};this.jobs.push(job);}
        if(s.activity==='cleaning'||s.activity==='docked')this.patch(d.id,{battery:Math.max(0,Math.min(100,Number(s.battery)+(s.activity==='cleaning'?-.05:.1)*ms/1000))});
      }
    }
  }
  scenario(name:string,options:Record<string,unknown>={}){
    const env='sim_living_room_environment',motion='sim_living_room_motion';
    if(name==='energy-spike')return {status:'reserved',reason:'powerMeter 尚未定义'};
    if(name==='night-motion'){this.patch(motion,{occupancy:true});this.later(5000,()=>this.patch(motion,{occupancy:false}));return {status:'running',simulatedTime:'23:30',note:'仅事件元数据，不更改系统时钟，不执行自动化'};}
    if(name==='device-offline'){const id=String(options.deviceId??'sim_living_room_light');const duration=Number(options.durationMs??5000);if(!Number.isFinite(duration)||duration<100||duration>3600000)throw Error('durationMs 无效');this.patch(id,{online:false});this.later(duration,()=>this.patch(id,{online:true}));}
    else if(name==='bad-air-quality')for(const [i,co2] of [650,750,850,1000,1200,1400].entries())this.later(i*1000,()=>this.patch(env,{co2}));
    else if(name==='normal-day')for(let i=0;i<60;i++)this.later(i*1000,()=>this.patch(env,{temperature:24+Math.round(Math.sin(i/10)*10)/10,humidity:45+Math.round(Math.sin(i/12)*3)}));
    else throw Error('场景不存在');
    return {status:'running'};
  }
  reset(){this.jobs=[];this.now=0;this.devices=structuredClone(home);for(const d of this.devices)this.emit('change',structuredClone(d));}
}
