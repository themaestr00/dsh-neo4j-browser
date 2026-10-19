import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createQueryRunner,describeEntity,executionLabel,historyPreview,resizeValue} from '../src/workspace-core.js';
const source=await readFile(new URL('../src/client.js',import.meta.url),'utf8');
const panel=await readFile(new URL('../src/workspace-panel.js',import.meta.url),'utf8');
const styles=await readFile(new URL('../src/workspace-styles.js',import.meta.url),'utf8');
const prelude=source.slice(0,source.indexOf('// Browser editor imports'));
const {state,graph}=vm.runInNewContext(prelude+'\n({state:createNeo4jStateCore(),graph:createNeo4jGraphCore()})',{}, {timeout:1000});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('query runner records running/completed duration and row count once',async()=>{
  let now=10;const changed=[],finished=[],results=[];
  const runner=createQueryRunner({execute:async()=>({rowCount:6}),now:()=>now,wallNow:()=>123,id:()=> 'run-1',onChange:value=>changed.push(value),onResult:value=>results.push(value),onFinish:value=>finished.push(value)});
  const task=runner.run({query:'RETURN 1',parameters:{}});assert.equal(runner.running,true);assert.equal(changed[0].status,'running');now=52;
  await task;assert.equal(runner.running,false);assert.equal(finished.length,1);assert.equal(results.length,1);assert.equal(finished[0].durationMs,42);assert.equal(executionLabel(finished[0]),'✓ Completed · 42 ms · 6 rows');
});
test('Stop cancels immediately, ignores late success and does not clobber a new run',async()=>{
  const first=deferred(),second=deferred(),finished=[],results=[];let index=0,signals=[];
  const runner=createQueryRunner({execute:(_snapshot,_write,signal)=>{signals.push(signal);return ++index===1?first.promise:second.promise;},id:()=>String(index+1),onResult:value=>results.push(value),onFinish:value=>finished.push(value)});
  const a=runner.run({query:'RETURN 1',parameters:{}});await Promise.resolve();
  assert.equal(runner.cancel(),true);assert.equal(signals[0].aborted,true);assert.equal(runner.running,false);assert.equal(finished[0].status,'cancelled');
  const b=runner.run({query:'RETURN 2',parameters:{}});await Promise.resolve();first.resolve({rowCount:99});await a;
  assert.equal(runner.running,true);assert.equal(results.length,0);second.resolve({rowCount:2});await b;
  assert.equal(results.length,1);assert.equal(results[0].rowCount,2);assert.equal(finished.length,2);assert.equal(runner.cancel(),false);
});
test('cancellation before transport starts never executes; duplicate launches are ignored',async()=>{
  let calls=0;const finished=[];const runner=createQueryRunner({execute:async()=>{calls++;return {};},id:()=> 'early',onFinish:value=>finished.push(value)});
  const a=runner.run({query:'RETURN 1',parameters:{}}),b=runner.run({query:'RETURN 2',parameters:{}});
  runner.cancel();await a;assert.equal(await b,null);assert.equal(calls,0);assert.equal(finished.length,1);
});
test('query failures keep diagnostic details and distinguish cancellation',async()=>{
  let now=0;const finished=[];const error=Object.assign(new Error('Invalid input'),{code:'CYPHER_ERROR',position:{line:2,column:4,offset:10}});
  const runner=createQueryRunner({execute:async()=>{now=120;throw error;},now:()=>now,id:()=> 'error',onFinish:value=>finished.push(value)});
  await runner.run({query:'BAD QUERY',parameters:{}});assert.equal(executionLabel(finished[0]),'Failed · 120 ms');assert.equal(finished[0].error.position.line,2);
});
test('run snapshots are isolated from edits and never persist authorization or errors',async()=>{
  const hold=deferred(),snapshot={query:'RETURN $x',parameters:{x:1}};let received;
  const runner=createQueryRunner({execute:(value,write)=>{received={value,write};return hold.promise;},id:()=> 'snapshot'});
  const task=runner.run(snapshot,true);snapshot.parameters.x=2;await Promise.resolve();assert.equal(received.value.parameters.x,1);assert.equal(received.write,true);runner.cancel();await task;
  const data=state.normalize({history:[{id:'a',query:'RETURN 1',parameters:{},status:'completed',durationMs:42,rows:6,allowWrite:true,error:'secret-error'}],layout:{password:'secret',editorHeight:200},allowWrite:true,result:{}});
  assert.equal(data.history[0].durationMs,42);assert.equal(data.history[0].rows,6);assert.ok(!JSON.stringify(data).includes('secret'));assert.ok(!JSON.stringify(data).includes('allowWrite'));
});
test('layout migration preserves result mode and bounded splitter/section preferences',()=>{
  const data=state.normalize({format:1,tab:'JSON',layout:{editorHeight:99999,graphHeight:12,inspectorHeight:300,inspectorWidth:NaN,inspectorTab:'History',showMetadata:true,showDetails:false,queryOptions:true,generationSettings:true}});
  assert.equal(data.tab,'JSON');assert.equal(data.layout.editorHeight,640);assert.equal(data.layout.graphHeight,240);assert.equal(data.layout.inspectorWidth,280);assert.equal(data.layout.inspectorTab,'History');assert.equal(data.layout.queryOptions,true);assert.equal(data.layout.showDetails,false);
  const store=new Map(),storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)};
  state.save(storage,'key',data);const restored=state.load(storage,'key');assert.deepEqual(JSON.parse(JSON.stringify(restored.layout)),JSON.parse(JSON.stringify(data.layout)));
  assert.equal(state.normalize({history:[{query:'RETURN 1',at:1e99}]}).history[0].at,0);
  state.save(storage,'run',{history:[{query:'RETURN 1',status:'running'}]});assert.equal(state.load(storage,'run').history[0].status,'cancelled');
});
test('adaptive initial camera zooms out monotonically with node count and viewport size',()=>{
  let previous=Infinity;
  for(const count of [1,10,25,100,400]) {
    const points=Object.fromEntries(Array.from({length:count},(_,index)=>[String(index),{x:Math.cos(index*2.4)*126*Math.sqrt(index),y:Math.sin(index*2.4)*126*Math.sqrt(index)}]));
    const camera=graph.initialCamera(points,{width:900,height:650});assert.ok(camera.z<=previous);assert.ok(camera.z>=.02&&camera.z<=1);previous=camera.z;
    const narrow=graph.initialCamera(points,{width:360,height:400});assert.ok(narrow.z<=camera.z);
    const center=graph.centerCamera(points,{width:900,height:650},.37);assert.equal(center.z,.37);
  }
  assert.ok(source.includes('const nextCamera=core.initialCamera(initial,sizeRef.current)'));assert.ok(source.includes('zoomReference.current={count:afterCount,z:nextCamera.z}'));
});
test('entity presentation leads with label/name, keeps UUIDs secondary and history stays one line',()=>{
  const entity=describeEntity({kind:'node',id:'internal-id',labels:['Product'],properties:{id:'uuid',product:'openssl'}});
  assert.equal(entity.title,'Product · openssl');assert.equal(entity.id,'internal-id');assert.ok(entity.identity.some(([key,value])=>key==='ID'&&value==='uuid'));
  assert.equal(describeEntity({kind:'node',id:'uuid',labels:['Product'],properties:{id:'uuid'}}).title,'Product');
  assert.equal(historyPreview('MATCH (n)\n  RETURN n'),'MATCH (n) RETURN n');assert.equal(resizeValue(100,1000,64,640),640);assert.equal(resizeValue(100,-1000,64,640),64);
});
test('workspace source keeps result tabs stable, compact history actions read-only and Stop independently enabled',()=>{
  assert.ok(!panel.includes("setTab('Graph')"));assert.ok(!panel.includes("setNotice(t('Query completed'))"));
  assert.ok(panel.includes("runState.status==='running'?false:busy"));assert.ok(panel.includes('runner.current.cancel()'));
  assert.ok(panel.includes('execute(false,{query:entry.query,parameters:entry.parameters})'));
  assert.ok(panel.includes("const select=value=>{setSelected(value);if(value)openInspector('Properties');}"));
  assert.ok(panel.includes("['Properties','History']"));assert.ok(panel.includes("label:'Resize query editor'"));assert.ok(panel.includes("label:'Resize graph'"));assert.ok(panel.includes("label:'Resize inspector'"));
  assert.ok(panel.includes('diagnostic:errorForEditor,actionsRef:editorActions'));
  assert.ok(panel.includes('const candidate={...(snapshotOverride||{query,parameters}),expectedConnectionId:status.connectionId}'));
  assert.ok(panel.includes('runner.current.run({...snapshot,limit:rowLimit},!!confirmed)'));
  assert.ok(panel.includes('previous.connectionId!==value.connectionId'));
  assert.ok(panel.includes('value.connectionRevision<previous.connectionRevision'));
  assert.ok(styles.includes('.compact-workspace .workbench.result-layout.has-details:not(.is-fullscreen)'));
  assert.ok(!styles.includes('.compact-workspace .workbench.result-layout.has-details{'));
  assert.ok(panel.includes('expectedConnectionId:origin'));
  assert.ok(panel.includes('resultConnection.current!==origin||statusRef.current.connectionId!==origin'));assert.ok(panel.includes("api('databases'"));assert.ok(panel.includes("act('use_database'"));
});
