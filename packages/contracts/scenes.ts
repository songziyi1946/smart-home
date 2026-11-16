import type {DeviceCommand} from './devices';
export type SceneAction={deviceId:string;command:DeviceCommand};
export type Scene={id:string;name:string;description:string;actions:SceneAction[];version:number};
export type SceneRun={id:string;sceneId:string;name:string;actorId?:string;status:'running'|'completed'|'failed';reason?:string;startedAt:string;finishedAt?:string;actions:(SceneAction&{status:'pending'|'executing'|'sent'|'failed'|'skipped';reason?:string;finishedAt?:string})[]};
