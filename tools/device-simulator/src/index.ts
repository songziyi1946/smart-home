import {Simulator} from './core.ts';import {connectSimulator} from './mqtt.ts';import {controlServer} from './control.ts';
const sim=new Simulator();
const adapter=connectSimulator(sim,{url:process.env.MQTT_URL,username:process.env.MQTT_USERNAME,password:process.env.MQTT_PASSWORD,discoveryPrefix:process.env.MQTT_DISCOVERY_PREFIX});
const server=controlServer(sim,()=>adapter.client.connected);server.listen(Number(process.env.SIMULATOR_CONTROL_PORT??8090),'127.0.0.1');
const timer=setInterval(()=>sim.advance(200),200);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(timer);server.closeAllConnections();server.close();void adapter.close();});
