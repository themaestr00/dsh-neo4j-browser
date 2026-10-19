import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise only the registration contract and storage helpers, not React or DOM rendering.
const source=await readFile(new URL('../src/client.js',import.meta.url),'utf8')+'\n'+await readFile(new URL('../src/workspace-panel.js',import.meta.url),'utf8');
const prelude=source.slice(0,source.indexOf('// Browser editor imports'));
const {register,storageCore}=vm.runInNewContext(prelude+'\n({register:registerNeo4jSidebar,storageCore:createNeo4jStateCore()})',{}, {timeout:1000});

test('Neo4j contributes a new Start entry and matching sidebar body without replacing built-in pages',()=>{
  const owners=[],live={};
  const View=function SidebarView(){},Icon=function SidebarIcon(){};
  const ctx={
    effect(fn){owners.push(fn());},
    sidebarRightTabs:{register(definition){assert.equal(live.type,undefined);live.type=definition;return()=>{delete live.type;};}},
    slots:{inject(name,setup){assert.equal(name,'sidebar.right.pane.tab');owners.push(setup());},register(options,component){live.options=options;live.body=component;return()=>{delete live.options;delete live.body;};}},
  };
  register(ctx,View,Icon,value=>value);
  assert.equal(live.type.id,'@local/neo4j-browser/sidebar');
  assert.equal(live.type.kind,'neo4j-browser');
  assert.equal(live.type.keepMounted,true);
  assert.equal(live.type.multiple,undefined); // Normal page deduplication stays with the Host.
  assert.equal(live.type.patterns,undefined); // No unrelated resources are claimed.
  assert.equal(live.type.title(),'Neo4j Browser');
  assert.equal(live.type.guide.length,1);
  assert.equal(live.type.guide[0].title(),'Neo4j Browser');
  assert.equal(live.type.guide[0].icon,Icon);
  assert.ok(live.type.guide[0].description().includes('beside your conversation'));
  assert.equal(live.options.key,live.type.id);
  assert.equal(live.body,View);
  for(const dispose of owners.reverse())dispose();
  assert.equal(Object.keys(live).length,0);
});

test('new sidebar editors seed from main history but persist without clobbering other views',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const main=storageCore.key('web','/api/neo4j-browser');
  const first=storageCore.key('web','/api/neo4j-browser','sidebar:session-a:tab-a');
  const second=storageCore.key('web','/api/neo4j-browser','sidebar:session-a:tab-b');
  storageCore.save(storage,main,{query:'RETURN 1',history:[{query:'RETURN 1',parameters:{}}]});
  assert.equal(storageCore.load(storage,first,main).query,'RETURN 1');
  storageCore.save(storage,first,{query:'RETURN 2'});
  assert.equal(storageCore.load(storage,first,main).query,'RETURN 2');
  assert.equal(storageCore.load(storage,main).query,'RETURN 1');
  assert.equal(storageCore.load(storage,second,main).query,'RETURN 1');
});

test('sidebar view uses framework tab identity/visibility, pauses hidden simulation and preserves main navigation',()=>{
  assert.ok(source.includes('function SidebarPanel({useTabInfo,sessionId})'));
  assert.ok(source.includes('const {tab}=useTabInfo()'));
  assert.ok(source.includes('active:tab.visible'));
  assert.ok(source.includes('storageId:`sidebar:${sessionId}:${tab.id}`'));
  assert.ok(source.includes('if(!active)return;'));
  assert.ok(source.includes('},[graph,revision,active])'));
  assert.ok(source.includes('cancelAnimationFrame(frame)'));
  assert.ok(source.includes('compact-sidebar'));
  assert.ok(source.includes('showMetadata&&databaseInfo'));
  assert.ok(source.includes("name:'main',key:'neo4j-browser'"));
  assert.ok(source.includes("name:'sidebar.panellist',id:'neo4j-browser'"));
  assert.ok(!source.includes("require('@deepseek-ai/"));
});

test('manifest orders activation after the sidebar provider without bundling Harness Client packages',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'));
  assert.equal(pkg.dependencies['@deepseek-ai/dsh-client-ui-sidebar-right'],undefined);
});
