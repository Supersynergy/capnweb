import { createRequire } from 'node:module';
import { once } from 'node:events';
import { appendFile } from 'node:fs/promises';
const require=createRequire(new URL('../../package.json', import.meta.url));
const {WebSocketServer}=require('ws');
const variants={baseline:await import('./baseline.mjs'),candidate:await import('./candidate.mjs')};
const output=process.env.BENCH_OUTPUT;
const phase=process.env.BENCH_PHASE??'discovery';
const modes=process.env.BENCH_MODES?.split(',')??['queued','direct','socket'];
class Socket extends EventTarget {readyState=1;binaryType='';send(){}close(){}}
let server;
if(modes.includes('socket')){
 server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
 server.on('connection',ws=>ws.on('message',data=>{for(let i=0,n=Number(String(data));i<n;i++)ws.send(String(i));}));
}
async function run(variant,mode,n,pair,warmup){
 const Constructor=variants[variant].WebSocketTransport;
 let socket,transport,ready;
 if(mode==='socket'){
  socket=new WebSocket(`ws://127.0.0.1:${server.address().port}`);await once(socket,'open');
  transport=new Constructor(socket);let count=0;
  ready=new Promise(resolve=>socket.addEventListener('message',()=>{if(++count===n)resolve();}));
 }else{socket=new Socket();transport=new Constructor(socket);}
 if(mode==='queued')for(let i=0;i<n;i++)socket.dispatchEvent(new MessageEvent('message',{data:String(i)}));
 const start=performance.now(),cpuStart=process.cpuUsage();
 const values=[];
 if(mode==='socket'){socket.send(String(n));await ready;}
 for(let i=0;i<n;i++){
  if(mode==='direct')socket.dispatchEvent(new MessageEvent('message',{data:String(i)}));
  values.push(await transport.receive());
 }
 const wallMs=performance.now()-start,cpu=process.cpuUsage(cpuStart);
 for(let i=0;i<n;i++)if(values[i]!==String(i))throw Error('FIFO/data mismatch at '+i);
 if(mode==='socket'){const closed=once(socket,'close');socket.close();await closed;}
 const row={runtime:process.versions.bun?'bun':'node',version:process.version,phase,variant,mode,n,pair,warmup,wallMs,cpuUs:cpu.user+cpu.system,validated:values.length};
 await appendFile(output,JSON.stringify(row)+'\n');console.log(JSON.stringify(row));
}
try{
 for(const mode of modes)for(const n of mode==='queued'?[1000,16000,64000]:mode==='direct'?[16000]:[16000,64000]){
  await run('baseline',mode,n,-1,true);await run('candidate',mode,n,-1,true);
  for(let pair=0;pair<6;pair++)for(const variant of pair%2===0?['baseline','candidate']:['candidate','baseline'])await run(variant,mode,n,pair,false);
 }
}finally{if(server)await new Promise(resolve=>server.close(resolve));}
