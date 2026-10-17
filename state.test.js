import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const client=await readFile(new URL('./client.js',import.meta.url),'utf8');
const prelude=client.slice(0,client.indexOf('window.__ModuleLoader__.load('));
const core=vm.runInNewContext(prelude+'\ncreateNeo4jStateCore()',{}, {timeout:1000});
function memory(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};}
test('draft, parameters, history and preferences survive new browser-state instances',()=>{
  const storage=memory(),key=core.key('web','/api/neo4j-browser');
  const original={query:'MATCH (n:Product) RETURN n LIMIT 25',params:'{"name":"openssl"}',history:[{query:'RETURN $x',parameters:{x:3},at:123}],rowLimit:50,question:'Find products',labels:'Product',tab:'Table'};
  assert.equal(core.save(storage,key,original),true);
  const reopened=vm.runInNewContext(prelude+'\ncreateNeo4jStateCore()',{}, {timeout:1000});
  assert.equal(JSON.stringify(reopened.load(storage,key)),JSON.stringify(core.normalize(original)));
});
test('credentials, results, configuration and write authorization never enter persistence',()=>{
  const storage=memory();core.save(storage,'key',{query:'RETURN 1',password:'connection-password',connection:{password:'connection-password'},config:{prompt:'private config'},allowWrite:true,confirmedQuery:'secret confirmation',result:{rows:['private-result']}});
  const serialized=storage.getItem('key');
  for(const secret of ['connection-password','private config','secret confirmation','private-result','allowWrite','confirmedQuery'])assert.ok(!serialized.includes(secret));
});
test('corrupt records, malformed history and denied storage recover safely',()=>{
  const storage=memory();storage.setItem('bad','not json');assert.equal(core.load(storage,'bad').query,core.defaultQuery);
  storage.setItem('bad',JSON.stringify({history:[null,{},42,{query:'RETURN 1',parameters:null}],rowLimit:1000}));
  const restored=core.load(storage,'bad');assert.equal(restored.history.length,1);assert.equal(restored.rowLimit,25);
  const denied={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};
  assert.equal(core.load(denied,'key').query,core.defaultQuery);assert.equal(core.save(denied,'key',{}),false);
});
test('history is bounded, preserves newest entries, and profile keys are distinct',()=>{
  const normalized=core.normalize({history:Array.from({length:200},(_,i)=>({query:`RETURN ${i}`,parameters:{}}))});
  assert.equal(normalized.history.length,100);assert.equal(normalized.history[0].query,'RETURN 0');
  const next=core.append(normalized.history,{query:'RETURN 999',parameters:{}});
  assert.equal(next.length,100);assert.equal(next[0].query,'RETURN 999');
  assert.notEqual(core.key('web','/'),core.key('other','/'));assert.notEqual(core.key('web','/'),core.key('web','/nested/api'));
});
test('draft flush hooks and cached-schema/version guards exist in the UI',()=>{
  assert.ok(client.includes("window.addEventListener('pagehide',flush)"));
  assert.ok(client.includes("window.removeEventListener('pagehide',flush);flush()"));
  assert.ok(client.includes('if(status.schema){setSchema(status.schema);return;}'));
  assert.ok(client.includes('running.version!==CLIENT_VERSION'));
  assert.ok(client.includes('UI ${CLIENT_VERSION} / Host ${status.version'));
  assert.ok(client.includes('status.version===CLIENT_VERSION?{refresh:true}:{}'));
});
