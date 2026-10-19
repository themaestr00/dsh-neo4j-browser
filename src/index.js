import { Neo4jBrowser, LIMITS } from './backend.js';
export { Neo4jBrowser } from './backend.js';
export const inject = ['connection', 'tools', 'llm', 'agentDefaultModel'];
export const name = 'neo4j-browser';
const PATH = '/api/neo4j-browser';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const rejected = (message, status = 400) => json({ ok: false, error: { code: 'REQUEST_REJECTED', message } }, status);

export function registerBackend(ctx, browser) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: PATH, methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      // Connection admission is enforced by its router, and repeated defensively here.
      const rejection = ctx.connection.requestRejection(request);
      if (rejection) return rejected('Authentication or origin check failed.', rejection);
      const url = new URL(request.url);
      if (url.pathname !== PATH || url.search || request.method !== 'POST') return rejected('Unknown route or method.', 404);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return rejected('Use application/json.', 415);
      let reader;
      try {
        reader = request.body?.getReader();
        if (!reader) return rejected('JSON body required.');
        let size = 0; const chunks = [];
        const oversized = await browser.deadline(async () => {
          for (;;) {
            const { done, value } = await reader.read(); if (done) return false;
            size += value.byteLength;
            if (size > LIMITS.inputBytes) { await reader.cancel(); return true; }
            chunks.push(value);
          }
        }, request.signal, LIMITS.timeoutMs, () => reader.cancel());
        if (oversized) return rejected('Request body too large.', 413);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return json(await browser.dispatch(body, 'ui', request.signal));
      } catch { return rejected('Invalid request body.'); }
      finally { reader?.releaseLock(); }
    },
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'neo4j_browser',
    description: 'Inspect schema, generate Cypher, read/query or expand a Neo4j graph using the UI-established connection. List/select accessible databases. Generated queries are not executed. Credentials and writes are UI-only. Config is memory-only; database selection and disconnect affect all profile sessions.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['action'],
      properties: {
        action: { type: 'string', enum: ['status', 'disconnect', 'schema', 'query', 'expand', 'generate', 'config', 'databases', 'use_database'] },
        query: { type: 'string', description: 'For query: a single read-only Cypher statement, verified with EXPLAIN.' },
        parameters: { type: 'object', additionalProperties: true, description: 'Cypher parameters for query.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'For schema/generate: optional label scope, at most 30 labels.' },
        refresh: { type: 'boolean', description: 'For schema/databases: bypass the metadata cache; default false.' },
        question: { type: 'string', description: 'For generate: a question, at most 4000 characters; only it and metadata are sent to the model.' },
        expectedConnectionId:{type:'string',maxLength:128,description:'For query/expand: connectionId from status; reject if another session changed the database or connection.'},
        database: { type: 'string', maxLength:256, description: 'For use_database: accessible database name; empty selects the user default. Reuses current credentials.' },
        elementId: { type: 'string', description: 'For expand: a node elementId from query results.' },
        limit: { type: 'integer', description: 'For query/expand: row cap 1–200; defaults to 25.' },
        prompt: { type: 'string', description: 'For config: replacement English generation instruction, at most 8000 characters.' },
        provider: { type: 'string', description: 'For config: provider override; set with model, or clear both to use the default selection.' },
        model: { type: 'string', description: 'For config: model override.' },
      },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    timeoutMs: 120000,
    async execute(args, exec) { return browser.dispatch(args, 'tool', exec.signal); },
  }));
  ctx.on('dispose', () => browser.dispatch({ action: 'disconnect' }, 'ui'));
  return browser;
}

export async function apply(ctx, config = {}) {
  const module = await import('neo4j-driver');
  registerBackend(ctx, new Neo4jBrowser(ctx, module.default ?? module, config));
}
