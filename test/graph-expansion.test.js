import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGraphExpansionStore} from '../src/graph-expansion.js';
const node=id=>({id,labels:['Product'],properties:{name:id}});
const edge=(id,source,target)=>({id,source,target,type:'RELATED',properties:{}});
const graph=(nodes,edges=[])=>({nodes:nodes.map(node),edges});
const ids=value=>value.nodes.map(item=>item.id).sort();

test('second toggle removes only added neighbors and restores the immutable base result',()=>{
  const base=graph(['a','b'],[edge('base','a','b')]);const original=JSON.stringify(base);
  Object.freeze(base.nodes);Object.freeze(base.edges);Object.freeze(base);
  const store=createGraphExpansionStore();store.reset(base);
  store.add('a',graph(['a','b','x'],[edge('base','a','b'),edge('ax','a','x')]));
  assert.equal(store.has('a'),true);assert.deepEqual(ids(store.snapshot()),['a','b','x']);
  const collapsed=store.collapse('a');assert.deepEqual(ids(collapsed),['a','b']);assert.deepEqual(collapsed.edges.map(item=>item.id),['base']);
  assert.equal(store.has('a'),false);assert.equal(JSON.stringify(base),original);
});
test('shared neighbors remain while another expanded root owns them',()=>{
  const store=createGraphExpansionStore();store.reset(graph(['a','b']));
  store.add('a',graph(['a','x'],[edge('ax','a','x')]));store.add('b',graph(['b','x'],[edge('bx','b','x')]));
  const one=store.collapse('a');assert.deepEqual(ids(one),['a','b','x']);assert.deepEqual(one.edges.map(item=>item.id),['bx']);assert.equal(store.has('b'),true);
  assert.deepEqual(ids(store.collapse('b')),['a','b']);
});
test('nested expansions and orphan cycles disappear when the parent collapses',()=>{
  const store=createGraphExpansionStore();store.reset(graph(['a']));
  store.add('a',graph(['a','x'],[edge('ax','a','x')]));store.add('x',graph(['x','y'],[edge('xy','x','y')]));store.add('y',graph(['y','x'],[edge('yx','y','x')]));
  assert.deepEqual(ids(store.collapse('a')),['a']);assert.deepEqual([...store.expandedIds],[]);
  store.add('a',graph(['a','x']));assert.deepEqual(ids(store.snapshot()),['a','x']);assert.equal(store.has('x'),false);
});
test('nested expansions survive through a different still-visible shared parent',()=>{
  const store=createGraphExpansionStore();store.reset(graph(['a','b']));
  store.add('a',graph(['a','x']));store.add('x',graph(['x','y']));store.add('b',graph(['b','x']));
  assert.deepEqual(ids(store.collapse('a')),['a','b','x','y']);assert.equal(store.has('x'),true);
  assert.deepEqual(ids(store.collapse('b')),['a','b']);assert.equal(store.has('x'),false);
});
test('empty expansion can collapse, fresh queries clear ownership, and missing roots are ignored',()=>{
  const store=createGraphExpansionStore();store.reset(graph(['a']));store.add('a',graph(['a']));assert.equal(store.has('a'),true);
  store.collapse('a');assert.equal(store.has('a'),false);
  store.add('a',graph(['a','x']));store.reset(graph(['new']));assert.deepEqual([...store.expandedIds],[]);
  assert.deepEqual(ids(store.add('a',graph(['a','lost']))),['new']);
});
test('visible caps and group caps stay bounded and report active truncation only',()=>{
  const store=createGraphExpansionStore({maxNodes:3,maxEdges:2,maxGroups:1});store.reset(graph(['a','b']));
  const expanded=store.add('a',{...graph(['a','x','y'],[edge('ax','a','x'),edge('ay','a','y')]),truncated:true});
  assert.equal(expanded.nodes.length,3);assert.equal(expanded.truncated,true);assert.deepEqual(expanded.edges.map(item=>item.id),['ax']);
  assert.throws(()=>store.add('b',graph(['b','z'])),/Collapse another node/);
  assert.equal(store.collapse('a').truncated,false);
  const edgeOnly=store.reset(graph([],[edge('original','source','target')]));assert.equal(edgeOnly.edges.length,1);
});
test('HUD labels flow in one bounded stack, run/stop icons sit together with AI, collapse precedes any request',async()=>{
  const client=await readFile(new URL('../src/client.js',import.meta.url),'utf8');
  const panel=await readFile(new URL('../src/workspace-panel.js',import.meta.url),'utf8');
  const styles=await readFile(new URL('../src/workspace-styles.js',import.meta.url),'utf8');
  const hud=client.slice(client.indexOf("h('div',{className:'graph-hud'}"),client.indexOf("h('div',{className:'graph-tools'}"));
  assert.ok(hud.includes("className:'graph-status'"));assert.ok(hud.includes("className:'selection-caption'"));
  assert.ok(styles.includes('flex-direction:column;align-items:flex-start;gap:5px'));
  assert.ok(styles.includes('.graph-hud .selection-caption{position:static;inset:auto'));
  const buttons=panel.slice(panel.indexOf("className:'query-action-buttons'"),panel.indexOf('executionLabel(runState,t)'));
  assert.ok(buttons.indexOf('ref:generationTrigger')<buttons.indexOf('className:`query-run'));
  assert.ok(buttons.includes("'aria-label':t(runState.status==='running'?'Stop':'Run query')"));
  assert.ok(buttons.includes("h('rect',{x:6"));assert.ok(buttons.includes("d:'M8 5 L19 12 L8 19 Z'"));
  assert.ok(!buttons.includes("},t(runState.status==='running'?'Stop':'Run query')"));
  const collapse=panel.slice(panel.indexOf('if(expansions.current.has(id))'),panel.indexOf("act('expand'"));
  assert.ok(collapse.includes('expansions.current.collapse(id)'));assert.ok(collapse.includes('return;'));assert.ok(!collapse.includes('api('));
  assert.ok(client.includes("'aria-expanded':Boolean(expandedNodes?.has(node.id))"));
});
