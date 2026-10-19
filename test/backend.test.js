import test from 'node:test';
import assert from 'node:assert/strict';
import { Neo4jBrowser, LIMITS, normalize } from '../src/backend.js';
import { registerBackend } from '../src/index.js';
const record = row => ({ keys: Object.keys(row), get: key => row[key] });
function result(rows, queryType = 'r') {
  return { then(resolve, reject) { return Promise.resolve({ summary: { queryType }, records: rows.map(record) }).then(resolve, reject); }, async *[Symbol.asyncIterator]() { for (const row of rows) yield record(row); } };
}
function setup(options = {}) {
  const calls = [], sessions = [], drivers = [], llmCalls = [];
  const neo4j = {
    auth: { basic: (username, password) => ({ username, password }) }, int: n => n,
    isInt: x => x?.tag === 'integer', isNode: x => x?.tag === 'node', isRelationship: x => x?.tag === 'relationship', isPath: x => x?.tag === 'path',
    driver(uri, auth, config) {
      const driver = { closed: false, async verifyConnectivity() { if (options.connectError) throw Error(auth.password); }, async close() { this.closed = true; }, session(config) {
        const session = { config, closed: false, async close() { this.closed = true; }, async beginTransaction(config) {
          let open = true;
          const tx = { config, committed: false, rolledBack: false, isOpen: () => open,
            run(query, parameters) { calls.push({ query, parameters }); if (options.error) throw Error('secret-password'); return result(query.startsWith('EXPLAIN ') ? [] : options.rows?.(query, parameters) ?? [{ value: 1 }], Object.hasOwn(options, 'queryType') ? options.queryType : 'r'); },
            async commit() { this.committed = true; open = false; }, async rollback() { this.rolledBack = true; open = false; },
          }; session.tx = tx; return tx;
        } }; sessions.push(session); return session;
      } }; drivers.push({ driver, uri, auth, config }); return driver;
    },
  };
  const ctx = { agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model' }) }, llm: {
    async resolveModelInfo() { return options.modelInfo ?? {reasoning:{efforts:[{id:'low'},{id:'high'}]}}; },
    async prepareCall(config) { return {config,stream:input=>this.stream(input)}; },
    async *stream(input) { llmCalls.push(input);if(options.chunks){yield* options.chunks;return;} yield { type: 'text-delta', text: options.generated ?? 'MATCH (n) RETURN n LIMIT 10' }; yield { type: 'finish', reason: { kind: options.finish ?? 'stop',...(options.failure?{failure:options.failure}:{}) } }; }
  } };
  const browser = new Neo4jBrowser(ctx, neo4j);
  const connect = () => browser.dispatch({ action: 'connect', uri: 'neo4j://localhost:7687', username: 'neo4j', password: 'secret-password' }, 'ui');
  return { browser, connect, calls, sessions, drivers, neo4j, ctx, llmCalls };
}
const node = (id = 'n1') => ({ tag: 'node', elementId: id, labels: ['Person'], properties: { name: 'Alice' } });
const edge = () => ({ tag: 'relationship', elementId: 'r1', startNodeElementId: 'n1', endNodeElementId: 'n2', type: 'KNOWS', properties: {} });

test('connect is UI-only, credentials never appear in status or safe errors', async () => {
  const f = setup();
  assert.equal((await f.browser.dispatch({ action: 'connect', uri: 'bolt://localhost', username: 'u', password: 'secret-password' })).error.code, 'UI_ONLY');
  assert.equal(f.drivers.length, 0);
  assert.equal((await f.connect()).connected, true);
  assert.ok(!JSON.stringify(await f.browser.dispatch({ action: 'status' })).includes('secret-password'));
  assert.equal(f.drivers[0].auth.password, 'secret-password');
  const broken = setup({ connectError: true });
  assert.ok(!JSON.stringify(await broken.connect()).includes('secret-password'));
  assert.equal(broken.drivers[0].driver.closed, true);
});

test('URI validation rejects embedded credentials, paths, and invalid schemes', async () => {
  const f = setup();
  for (const uri of ['http://localhost', 'bolt://u:p@localhost', 'bolt://localhost/db', 'bolt://localhost?password=p']) {
    assert.equal((await f.browser.dispatch({ action: 'connect', uri, username: 'u', password: 'p' }, 'ui')).error.code, 'INVALID_INPUT');
  }
  assert.equal(f.drivers.length, 0);
});

test('query fails closed unless EXPLAIN reports exactly r', async () => {
  for (const queryType of ['w', 'rw', 's', null]) {
    const f = setup({ queryType }); await f.connect();
    const answer = await f.browser.dispatch({ action: 'query', query: 'CREATE (n)' });
    assert.equal(answer.error.code, 'READ_ONLY'); assert.equal(f.calls.length, 1);
    assert.equal(f.sessions[0].config.defaultAccessMode, 'READ');
  }
  const f = setup(); await f.connect();
  const answer = await f.browser.dispatch({ action: 'query', query: 'RETURN $x', parameters: { x: 1 } });
  assert.equal(answer.ok, true); assert.deepEqual(f.calls.map(c => c.query), ['EXPLAIN RETURN $x', 'RETURN $x']);
  assert.equal(f.sessions[0].tx.rolledBack, true); assert.equal(f.sessions[0].tx.config.timeout, LIMITS.timeoutMs);
});

test('writes require UI authority and exact query confirmation', async () => {
  const f = setup({ queryType: 'w' }); await f.connect();
  const input = { action: 'query', query: 'CREATE (n)', allowWrite: true, confirmedQuery: 'CREATE (n)' };
  assert.equal((await f.browser.dispatch(input)).error.code, 'UI_ONLY');
  assert.equal((await f.browser.dispatch({ ...input, confirmedQuery: 'CREATE (m)' }, 'ui')).error.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await f.browser.dispatch(input, 'ui')).writeExecuted, true);
  assert.equal(f.sessions[0].config.defaultAccessMode, 'WRITE'); assert.equal(f.sessions[0].tx.committed, true);
  assert.equal((await f.browser.dispatch({ ...input, caller: 'ui' })).error.code, 'INVALID_INPUT');
});

test('recursive paths, maps, graph deduplication and integer precision', () => {
  const f = setup(), s = { nodes: new Map(), edges: new Map(), visits: 0, truncated: false };
  const big = { tag: 'integer', inSafeRange: () => false, toString: () => '9223372036854775807' };
  const small = { tag: 'integer', inSafeRange: () => true, toNumber: () => 42 };
  const output = normalize({ nested: [{ tag: 'path', start: node(), end: node('n2'), segments: [{ start: node(), relationship: edge(), end: node('n2') }] }], big, small }, f.neo4j, s);
  assert.equal(output.big, '9223372036854775807'); assert.equal(output.small, 42);
  assert.equal(output.nested[0].kind, 'path'); assert.equal(s.nodes.size, 2); assert.equal(s.edges.size, 1);
});

test('row, normalization and response byte limits are enforced', async () => {
  const f = setup({ rows: () => Array.from({ length: 300 }, () => ({ text: 'x'.repeat(10000), nodes: Array.from({ length: 100 }, (_, i) => node(String(i))) })) });
  await f.connect(); const output = await f.browser.dispatch({ action: 'query', query: 'RETURN 1', limit: 2 });
  assert.equal(output.ok, true); assert.ok(output.rows.length <= 2); assert.equal(output.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= LIMITS.bytes);
});

test('query and neighbor expansion default to 25; explicit larger limits remain available', async () => {
  const f = setup({rows:()=>Array.from({length:100},(_,i)=>({value:i}))}); await f.connect();
  const small=await f.browser.dispatch({action:'query',query:'RETURN 1'});
  assert.equal(small.rows.length,25);assert.equal(small.truncated,true);
  const large=await f.browser.dispatch({action:'query',query:'RETURN 1',limit:100});
  assert.equal(large.rows.length,100);
  await f.browser.dispatch({action:'expand',elementId:'n1'});
  assert.equal(f.calls.at(-1).parameters.limit,25);
  const config=await f.browser.dispatch({action:'config'});assert.ok(config.prompt.includes('LIMIT 25'));
});

test('expand parameterizes IDs and enforces limits', async () => {
  const f = setup(); await f.connect();
  assert.equal((await f.browser.dispatch({ action: 'expand', elementId: "x' RETURN 1 //", limit: 10 })).ok, true);
  assert.equal(f.calls[1].parameters.id, "x' RETURN 1 //"); assert.ok(!f.calls[1].query.includes("x'"));
  assert.equal((await f.browser.dispatch({ action: 'expand', elementId: 'x', limit: 201 })).error.code, 'INVALID_INPUT');
});

test('schema metadata is scoped, bounded and graceful when unavailable', async () => {
  const f = setup({ rows: query => {
    if (query.includes('db.labels')) return [{ label: 'Person' }];
    if (query.includes('db.relationshipTypes')) return [{ relationshipType: 'KNOWS' }];
    if (query.includes('nodeTypeProperties')) return [{ nodeLabels: ['Person'], propertyName: 'name', propertyTypes: ['String'], mandatory: false }];
    if (query.includes('relTypeProperties')) return [{ relType: ':`KNOWS`', propertyName: 'since', propertyTypes: ['Long'], mandatory: false }];
    if (query.includes('visualization')) return [{ nodes: [node(), node('n2')], relationships: [edge()] }];
    return [];
  } }); await f.connect();
  const output = await f.browser.dispatch({ action: 'schema', labels: ['Person'] });
  assert.equal(output.ok, true); assert.equal(output.nodeProperties[0].propertyTypes[0], 'String');
  assert.ok(f.calls.every(c => c.query.startsWith('CALL db.'))); assert.deepEqual(f.calls[0].parameters.labels, ['Person']);
  assert.ok(Buffer.byteLength(JSON.stringify(output)) < LIMITS.schemaBytes);
  const denied = setup({ error: true }); await denied.connect();
  const fallback = await denied.browser.dispatch({ action: 'schema' });
  assert.equal(fallback.ok, true); assert.ok(fallback.omissions.length >= 5); assert.ok(!JSON.stringify(fallback).includes('secret-password'));
});

test('schema is cached per connection and scope; status reuses it; refresh and reconnect invalidate it',async()=>{
  const f=setup({rows:()=>[]});await f.connect();
  const first=await f.browser.dispatch({action:'schema'}),count=f.calls.length;
  assert.equal(first.ok,true);assert.equal(count,5);
  const second=await f.browser.dispatch({action:'schema'});assert.equal(f.calls.length,count);
  assert.deepEqual(second,first);second.labels.push('untrusted mutation');
  assert.equal((await f.browser.dispatch({action:'schema'})).labels.length,0);
  const status=await f.browser.dispatch({action:'status'});assert.equal(status.version,'1.0.0');assert.ok(status.schema);assert.ok(status.schemaCachedAt);
  await f.browser.dispatch({action:'generate',question:'Find people'});assert.equal(f.calls.length,count);
  await f.browser.dispatch({action:'schema',labels:['B','A']});const scopedCount=f.calls.length;
  await f.browser.dispatch({action:'schema',labels:['A','B']});assert.equal(f.calls.length,scopedCount);
  await f.browser.dispatch({action:'schema',refresh:true});assert.equal(f.calls.length,scopedCount+5);
  await f.connect();const after=await f.browser.dispatch({action:'status'});assert.notEqual(after.connectionId,status.connectionId);assert.equal(after.schema,null);
  await f.browser.dispatch({action:'schema'});await f.browser.dispatch({action:'disconnect'});
  assert.equal((await f.browser.dispatch({action:'status'})).schema,null);
  assert.equal((await f.browser.dispatch({action:'schema'})).error.code,'NOT_CONNECTED');
});
test('cached status remains available while a long-running operation holds the queue',async()=>{
  const f=setup();let release;f.browser.queue=new Promise(resolve=>{release=resolve;});
  const status=await f.browser.dispatch({action:'status'});assert.equal(status.ok,true);release();
});
test('write attempts invalidate schema cache even if the write later fails',async()=>{
  const f=setup({rows:()=>[]});await f.connect();await f.browser.dispatch({action:'schema'});
  assert.ok((await f.browser.dispatch({action:'status'})).schema);
  f.browser.execute=async()=>{throw Error('write failed after submission');};
  await f.browser.dispatch({action:'query',query:'CREATE (n)',allowWrite:true,confirmedQuery:'CREATE (n)'},'ui');
  assert.equal((await f.browser.dispatch({action:'status'})).schema,null);
  assert.equal((await f.browser.dispatch({action:'schema',refresh:'yes'})).error.code,'INVALID_INPUT');
});

test('generation uses only separate schema/question messages, default model, no tools/history', async () => {
  const f = setup({ rows: () => [] }); await f.connect();
  const output = await f.browser.dispatch({ action: 'generate', question: 'Find people' });
  assert.equal(output.ok, true); assert.equal(output.executed, false); assert.equal(f.llmCalls[0].provider, 'default-provider');
  assert.equal(f.llmCalls[0].messages.length, 2); assert.equal(f.llmCalls[0].tools, undefined); assert.equal(f.llmCalls[0].sessionId, undefined);
  assert.ok(!JSON.stringify(f.llmCalls).includes('secret-password')); assert.ok(f.calls.every(c => c.query.startsWith('CALL db.')));
  const bad = setup({ rows: () => [], finish: 'max-tokens' }); await bad.connect();
  assert.equal((await bad.browser.dispatch({ action: 'generate', question: 'Find people' })).error.code, 'GENERATION_TRUNCATED');
  assert.equal(f.llmCalls[0].temperature,undefined);assert.equal(f.llmCalls[0].maxTokens,8192);assert.equal(f.llmCalls[0].reasoningEffort,'low');
});

test('generation distinguishes provider errors, quota, authentication and truncation without leaking raw errors', async () => {
  for(const [failure,expected] of [[{code:'INVALID_REQUEST',status:400},'MODEL_REQUEST'],[{code:'INVALID_CREDENTIAL',status:401},'MODEL_AUTH'],[{code:'QUOTA_EXCEEDED',status:429},'MODEL_QUOTA'],[{code:'EMPTY_RESPONSE'},'GENERATION_EMPTY'],[{code:'UNKNOWN'},'MODEL_FAILED']]) {
    const f=setup({rows:()=>[],finish:'error',failure:{...failure,message:'secret-password and private schema'}});await f.connect();
    const result=await f.browser.dispatch({action:'generate',question:'Find people'});
    assert.equal(result.error.code,expected);assert.ok(!JSON.stringify(result).includes('secret-password'));assert.ok(!JSON.stringify(result).includes('private schema'));
  }
});
test('generation consumes final text blocks without duplicate deltas or reasoning',async()=>{
  const query='MATCH (n) RETURN n LIMIT 25';
  for(const chunks of [[{type:'reasoning-delta',index:0,text:'private reasoning'},{type:'block-end',index:1,block:{type:'text',text:query}},{type:'finish',reason:{kind:'stop'}}],[{type:'text-delta',index:0,text:query},{type:'block-end',index:0,block:{type:'text',text:query}},{type:'finish',reason:{kind:'stop'}}]]) {
    const f=setup({rows:()=>[],chunks});await f.connect();const result=await f.browser.dispatch({action:'generate',question:'Find people'});
    assert.equal(result.query,query);assert.equal(result.executed,false);assert.ok(f.calls.every(call=>call.query.startsWith('CALL db.')));
  }
});
test('non-reasoning models receive no invented reasoning setting or forced temperature',async()=>{
  const f=setup({rows:()=>[],modelInfo:{}});await f.connect();
  assert.equal((await f.browser.dispatch({action:'generate',question:'Find people'})).ok,true);
  assert.equal(f.llmCalls[0].reasoningEffort,undefined);assert.equal(f.llmCalls[0].temperature,undefined);
});

test('configuration shared across callers and explicitly memory-only', async () => {
  const f = setup();
  assert.equal((await f.browser.dispatch({ action: 'config', prompt: 'Return read-only Cypher.', provider: 'p', model: 'm' })).ok, true);
  const config = await f.browser.dispatch({ action: 'config' }, 'ui');
  assert.equal(config.prompt, 'Return read-only Cypher.'); assert.equal(config.persistence, 'memory');
  assert.equal((await f.browser.dispatch({ action: 'config', password: 'secret' })).error.code, 'INVALID_INPUT');
});

test('disconnect and replacement close shared drivers', async () => {
  const f = setup(); await f.connect(); await f.connect();
  assert.equal(f.drivers[0].driver.closed, true);
  assert.equal((await f.browser.dispatch({ action: 'disconnect' })).connected, false);
  assert.equal(f.drivers[1].driver.closed, true);
  assert.equal((await f.browser.dispatch({ action: 'query', query: 'RETURN 1' })).error.code, 'NOT_CONNECTED');
});

test('deadline cancels and fails with bounded safe failure; aborted requests never run', async () => {
  const f = setup(); let cancelled = false;
  await assert.rejects(f.browser.deadline(() => new Promise(() => {}), undefined, 5, () => { cancelled = true; }), { code: 'TIMEOUT' });
  assert.equal(cancelled, true);
  const controller = new AbortController(); controller.abort();
  assert.equal((await f.browser.dispatch({ action: 'status' }, 'tool', controller.signal)).error.code, 'ABORTED');
});

test('authenticated fetch validates exact path/method/body and shares tool operations', async () => {
  const f = setup(); let route, tool, rejection;
  const ctx = { effect: fn => fn(), on: () => {}, connection: { requestRejection: () => rejection, fetch: { register: r => { route = r; return () => {}; } } }, tools: { register: t => { tool = t; return () => {}; } } };
  registerBackend(ctx, f.browser);
  const request = (body, path = '/api/neo4j-browser') => new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ui = await (await route.fetch(request({ action: 'status' }))).json();
  const model = await tool.execute({ action: 'status' }, {}); assert.deepEqual(ui, model);
  assert.ok(!Object.hasOwn(tool.parameters.properties, 'password')); assert.ok(!tool.parameters.properties.action.enum.includes('connect'));
  rejection = 403; assert.equal((await route.fetch(request({ action: 'status' }))).status, 403); rejection = undefined;
  assert.equal((await route.fetch(request({}, '/api/neo4j-browser/extra'))).status, 404);
  assert.equal((await route.fetch(request({}, '/api/neo4j-browser?x=1'))).status, 404);
  assert.equal((await route.fetch(request({ action: 'query', query: 'x'.repeat(LIMITS.inputBytes) }))).status, 413);
});
