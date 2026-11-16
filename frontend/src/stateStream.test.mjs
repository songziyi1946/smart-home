import test from 'node:test';import assert from 'node:assert/strict';import {subscribeState} from './stateStream.ts';
test('SSE applies initial/resync snapshots, signals auth expiry and cleans up old sessions',t=>{
 class FakeSource {listeners={};closed=false;constructor(url){assert.equal(url,'/api/events');FakeSource.instance=this;}addEventListener(name,fn){this.listeners[name]=fn;}close(){this.closed=true;}send(data){this.listeners.snapshot({data:JSON.stringify(data)});}}
 const previous=globalThis.EventSource;globalThis.EventSource=FakeSource;t.after(()=>{if(previous===undefined)delete globalThis.EventSource;else globalThis.EventSource=previous;});let values=[],expired=0,errors=0;const stop=subscribeState(s=>values.push(s),()=>expired++,()=>errors++),source=FakeSource.instance;
 source.send({devices:[1]});source.onerror();source.send({devices:[2]});assert.equal(errors,1);assert.deepEqual(values.map(v=>v.devices),[[1],[2]]);
 source.listeners['auth-expired']();assert.equal(expired,1);assert.equal(source.closed,true);stop();source.send({devices:[3]});assert.equal(values.length,2);
});
