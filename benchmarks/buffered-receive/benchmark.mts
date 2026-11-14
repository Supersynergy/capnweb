import { WebSocketServer } from 'ws';
import { once } from 'node:events';
import { appendFile } from 'node:fs/promises';

type Variant = 'baseline' | 'candidate';
type Mode = 'queued' | 'direct' | 'socket';
type Transport = {receive(): Promise<string>};
type Library = {WebSocketTransport: new (socket: WebSocket) => Transport};
const variants: Record<Variant, Library> = {
  baseline: await import(new URL('./baseline.mjs', import.meta.url).href) as Library,
  candidate: await import(new URL('./candidate.mjs', import.meta.url).href) as Library,
};
const output = process.env.BENCH_OUTPUT;
if (!output) throw Error('BENCH_OUTPUT is required');
const phase = process.env.BENCH_PHASE ?? 'discovery';
const modes = (process.env.BENCH_MODES?.split(',') ?? ['queued', 'direct', 'socket']) as Mode[];
if (modes.some(mode => !['queued', 'direct', 'socket'].includes(mode))) throw Error('Invalid mode');
class Socket extends EventTarget {
  readyState = 1;
  binaryType = '';
  send(): void {}
  close(): void {}
}
let server: WebSocketServer | undefined;
if (modes.includes('socket')) {
  server = new WebSocketServer({port: 0, host: '127.0.0.1'});
  await once(server, 'listening');
  server.on('connection', ws => ws.on('message', data => {
    for (let i = 0, n = Number(String(data)); i < n; i++) ws.send(String(i));
  }));
}
async function run(variant: Variant, mode: Mode, n: number, pair: number, warmup: boolean): Promise<void> {
  const Constructor = variants[variant].WebSocketTransport;
  let socket: Socket | WebSocket;
  let ready: Promise<void> | undefined;
  if (mode === 'socket') {
    const address = server!.address();
    if (typeof address === 'string' || !address) throw Error('Invalid address');
    socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await once(socket, 'open');
  } else socket = new Socket();
  const transport = new Constructor(socket as unknown as WebSocket);
  if (mode === 'socket') {
    let count = 0;
    ready = new Promise(resolve => socket.addEventListener('message', () => {
      if (++count === n) resolve();
    }));
  }
  if (mode === 'queued') for (let i = 0; i < n; i++) {
    socket.dispatchEvent(new MessageEvent('message', {data: String(i)}));
  }
  const start = performance.now(), cpuStart = process.cpuUsage();
  const values: string[] = [];
  if (mode === 'socket') { (socket as WebSocket).send(String(n)); await ready; }
  for (let i = 0; i < n; i++) {
    if (mode === 'direct') socket.dispatchEvent(new MessageEvent('message', {data: String(i)}));
    values.push(await transport.receive());
  }
  const wallMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
  for (let i = 0; i < n; i++) if (values[i] !== String(i)) throw Error('FIFO/data mismatch at ' + i);
  if (mode === 'socket') {
    const closed = once(socket, 'close');
    (socket as WebSocket).close();
    await closed;
  }
  const row = {runtime: process.versions.bun ? 'bun' : 'node', version: process.version, phase,
    variant, mode, n, pair, warmup, wallMs, cpuUs: cpu.user + cpu.system, validated: values.length};
  await appendFile(output!, JSON.stringify(row) + '\n');
  console.log(JSON.stringify(row));
}
try {
  for (const mode of modes) for (const n of mode === 'queued' ? [1000, 16000, 64000] :
      mode === 'direct' ? [16000] : [16000, 64000]) {
    await run('baseline', mode, n, -1, true);
    await run('candidate', mode, n, -1, true);
    for (let pair = 0; pair < 6; pair++) {
      const order: Variant[] = pair % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
      for (const variant of order) await run(variant, mode, n, pair, false);
    }
  }
} finally { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); }
