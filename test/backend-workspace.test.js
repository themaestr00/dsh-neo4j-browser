import test from 'node:test';
import assert from 'node:assert/strict';
import {Neo4jBrowser} from '../src/backend.js';
import {queryDiagnostic} from '../src/query-errors.js';
import {registerBackend} from '../src/index.js';
function fixture(handler=()=>[]) {
  const calls=[],sessions=[],drivers=[];
  const neo4j={auth:{basic:(username,password)=>({username,password})},driver(uri,auth){const driver={async verifyConnectivity(){},async close(){},session(config){let open=true;const tx={isOpen:()=>open,async rollback(){open=false;},async commit(){open=false;},run(query,parameters){calls.push({query,parameters,config});const rows=handler(query,parameters,config);return {then:resolve=>Promise.resolve({summary:{queryType:'r'}}).then(resolve),async *[Symbol.asyncIterator](){for(const row of await rows)yield {keys:Object.keys(row),get:key=>row[key]};}};}};const session={config,async beginTransaction(){return tx;},async close(){this.closed=true;},tx};sessions.push(session);return session;}};drivers.push({driver,auth});return driver;}};
  const browser=new Neo4jBrowser({},neo4j);
  return {browser,calls,sessions,drivers,connect:()=>browser.dispatch({action:'connect',uri:'neo4j://localhost:7687',username:'reader',password:'connection-secret',database:'first'},'ui')};
}
test('database listing is bounded, cached, read-only and shared by UI/tool callers',async()=>{
  const f=fixture(query=>query.startsWith('SHOW DATABASES')?[{name:'first'},{name:'second'}]:[]);await f.connect();
  const first=await f.browser.dispatch({action:'databases'},'tool');assert.deepEqual(first.databases,['first','second']);assert.equal(f.calls.length,1);assert.equal(f.sessions[0].config.database,'system');assert.equal(f.sessions[0].config.defaultAccessMode,'READ');
  first.databases.push('mutation');assert.deepEqual((await f.browser.dispatch({action:'databases'},'ui')).databases,['first','second']);assert.equal(f.calls.length,1);
  await f.browser.dispatch({action:'databases',refresh:true});assert.equal(f.calls.length,2);
  assert.equal((await f.browser.dispatch({action:'databases',refresh:'yes'})).error.code,'INVALID_INPUT');
});
test('switching database verifies access before changing shared context and reuses credentials',async()=>{
  const f=fixture((_query,_parameters,config)=>{if(config.database==='forbidden')throw new Error('connection-secret');return [{connected:1}];});await f.connect();f.browser.schemaCache.set('[]',{value:{labels:['Old']},at:1});
  const before=f.browser.status();const changed=await f.browser.dispatch({action:'use_database',database:'second'},'tool');assert.equal(changed.connection.database,'second');assert.notEqual(changed.connectionId,before.connectionId);assert.equal(changed.connectionRevision,before.connectionRevision+1);assert.equal(changed.schema,null);assert.equal(f.drivers.length,1);assert.equal(f.drivers[0].auth.password,'connection-secret');
  assert.equal(f.sessions[0].config.database,'second');assert.equal(f.sessions[0].config.defaultAccessMode,'READ');
  const failed=await f.browser.dispatch({action:'use_database',database:'forbidden'},'ui');assert.equal(failed.ok,false);assert.ok(!JSON.stringify(failed).includes('connection-secret'));assert.equal(f.browser.status().connection.database,'second');
  const defaulted=await f.browser.dispatch({action:'use_database',database:''});assert.equal(defaulted.connection.database,null);assert.equal(f.sessions.at(-1).config.database,undefined);
});
test('Cypher diagnostics are UI-only and translate EXPLAIN coordinates to the original query',async()=>{
  const failure=Object.assign(new Error('Invalid input RETRN (line 1, column 9 (offset: 8))\nEXPLAIN RETRN 1'),{code:'Neo.ClientError.Statement.SyntaxError'});
  const f=fixture(()=>{throw failure;});await f.connect();
  const ui=await f.browser.dispatch({action:'query',query:'RETRN 1'},'ui');assert.equal(ui.error.code,'CYPHER_ERROR');assert.equal(ui.error.message,'Invalid input RETRN');assert.deepEqual(ui.error.position,{offset:0,line:1,column:1});
  const tool=await f.browser.dispatch({action:'query',query:'RETRN 1'},'tool');assert.equal(tool.error.code,'OPERATION_FAILED');assert.equal(tool.error.position,undefined);
  assert.equal(f.sessions[0].closed,true);
});
test('diagnostics clamp multiline positions and redact parameter/credential-looking data',()=>{
  const error=Object.assign(new Error('Variable private-value is not defined (line 2, column 3 (offset: 20))\nraw record'),{code:'Neo.ClientError.Statement.SemanticError'});
  const info=queryDiagnostic(error,'MATCH (n)\nBAD',8,{p:'private-value'});assert.equal(info.position.offset,12);assert.equal(info.position.line,2);assert.equal(info.position.column,3);assert.ok(!info.message.includes('private-value'));assert.ok(!info.message.includes('raw record'));
  const unknown=queryDiagnostic(Object.assign(new Error('password=secret'),{code:'Neo.ClientError.Security.Unauthorized'}),'RETURN 1');assert.equal(unknown,null);
  const structured=queryDiagnostic(Object.assign(new Error('Invalid input'),{code:'Neo.ClientError.Statement.SyntaxError',diagnosticRecord:{_position:{line:1,column:10,offset:9}}}),'BAD',8);assert.equal(structured.position.offset,1);
});
test('aborting a running query closes its read transaction and returns bounded cancellation',async()=>{
  let resolveRows;const waiting=new Promise(resolve=>{resolveRows=resolve;});
  const f=fixture(query=>query.startsWith('EXPLAIN')?[]:waiting);await f.connect();const controller=new AbortController();
  const pending=f.browser.dispatch({action:'query',query:'RETURN 1'},'ui',controller.signal);
  await new Promise(resolve=>setImmediate(resolve));controller.abort();const result=await pending;assert.equal(result.error.code,'ABORTED');
  await Promise.resolve();assert.equal(f.sessions[0].closed,true);assert.equal(f.sessions[0].tx.isOpen(),false);resolveRows([{value:1}]);
});
test('stale UI connection IDs reject queries before opening a transaction',async()=>{
  const f=fixture(()=>[{value:1}]);await f.connect();const old=f.browser.status().connectionId;
  await f.browser.dispatch({action:'use_database',database:'second'});const count=f.calls.length;
  const rejected=await f.browser.dispatch({action:'query',query:'RETURN 1',expectedConnectionId:old},'ui');assert.equal(rejected.error.code,'STALE_CONNECTION');assert.equal(f.calls.length,count);
  const expansion=await f.browser.dispatch({action:'expand',elementId:'old-node',expectedConnectionId:old},'ui');assert.equal(expansion.error.code,'STALE_CONNECTION');assert.equal(f.calls.length,count);
  const write=await f.browser.dispatch({action:'query',query:'CREATE (n)',allowWrite:true,confirmedQuery:'CREATE (n)',expectedConnectionId:old},'ui');assert.equal(write.error.code,'STALE_CONNECTION');assert.equal(f.calls.length,count);
  assert.equal((await f.browser.dispatch({action:'query',query:'RETURN 1',expectedConnectionId:f.browser.status().connectionId},'ui')).ok,true);
});
test('database actions share the exact authenticated UI and agent-tool backend',async()=>{
  const f=fixture(query=>query.startsWith('SHOW DATABASES')?[{name:'first'},{name:'second'}]:[{connected:1}]);await f.connect();let route,tool;
  registerBackend({effect:fn=>fn(),on:()=>{},connection:{requestRejection:()=>null,fetch:{register:value=>{route=value;return()=>{};}}},tools:{register:value=>{tool=value;return()=>{};}}},f.browser);
  const listed=await tool.execute({action:'databases'},{});assert.deepEqual(listed.databases,['first','second']);
  await tool.execute({action:'use_database',database:'second'},{});
  const response=await route.fetch(new Request('http://localhost/api/neo4j-browser',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'use_database',database:'first'})}));
  assert.equal((await response.json()).connection.database,'first');assert.equal(f.drivers.length,1);
});
