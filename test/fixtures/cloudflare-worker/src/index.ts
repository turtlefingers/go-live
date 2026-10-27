// Go Live 예제: Cloudflare Workers (wrangler dev)
// 정적 파일(public/)은 ASSETS 가, /api/* 는 이 Worker 가 처리한다. 카운터는 Durable Object 에 저장된다.
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ASSETS: Fetcher;
  COUNTER: DurableObjectNamespace<Counter>;
}

export class Counter extends DurableObject<Env> {
  async value(): Promise<number> {
    return (await this.ctx.storage.get<number>('n')) ?? 0;
  }
  async increment(): Promise<number> {
    const n = (await this.value()) + 1;
    await this.ctx.storage.put('n', n);
    return n;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/hello') {
      return Response.json({ message: '안녕하세요, Cloudflare Worker 가 보냈어요', time: new Date().toISOString() });
    }
    if (url.pathname === '/api/count') {
      const stub = env.COUNTER.get(env.COUNTER.idFromName('global'));
      const count = request.method === 'POST' ? await stub.increment() : await stub.value();
      return Response.json({ count });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
