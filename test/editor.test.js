import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {EditorState} from '@codemirror/state';
import {CompletionContext,acceptCompletion,closeCompletion} from '@codemirror/autocomplete';
import {keymap} from '@codemirror/view';
import {history,undo} from '@codemirror/commands';
import {buildCompletionSchema,completeCypher,highlightCypher,lexCypher,quoteIdentifier} from '../src/cypher-completions.js';
import {completionSource,cypherHighlighting,completionNavigation,completionNavigationKeymap,cypherDiagnostics,setEditorDiagnostic,editorHeight} from '../src/cypher-editor.js';

const metadata={
  labels:['Person','Movie','Employee','Odd label','return','Клиент'],relationshipTypes:['KNOWS','ACTED IN'],
  nodeProperties:[
    {nodeLabels:['Person'],propertyName:'name',propertyTypes:['String']},
    {nodeLabels:['Person'],propertyName:'age',propertyTypes:['Long']},
    {nodeLabels:['Person'],propertyName:'display name',propertyTypes:['String']},
    {nodeLabels:['Person'],propertyName:'a`b',propertyTypes:['String']},
    {nodeLabels:['Movie'],propertyName:'title',propertyTypes:['String']},
    {nodeLabels:['Employee'],propertyName:'salary',propertyTypes:['Float']},
  ],
  relationshipProperties:[{relType:':`KNOWS`',propertyName:'since',propertyTypes:['Date']},{relType:':`ACTED IN`',propertyName:'role',propertyTypes:['String']}],
  samples:['this-private-property-value-must-not-appear'],
};
const schema=buildCompletionSchema(metadata);
const complete=(query,explicit=false)=>completeCypher(query,query.length,schema,{},explicit);
const labels=result=>result?.options.map(option=>option.label)||[];
const apply=(query,result,label)=>query.slice(0,result.from)+result.options.find(option=>option.label===label).apply+query.slice(result.to);

test('keywords and functions work offline and filter case-insensitively',()=>{
  assert.ok(labels(completeCypher('ret',3,buildCompletionSchema(),{},false)).includes('RETURN'));
  assert.ok(labels(complete('co')).includes('count'));
  assert.equal(complete(' '),null);
  assert.ok(labels(complete('',true)).includes('MATCH'));
});
test('node labels and relationship types use different schema domains',()=>{
  assert.ok(labels(complete('MATCH (n:Pe')).includes('Person'));
  assert.ok(!labels(complete('MATCH (n:')).includes('KNOWS'));
  assert.deepEqual(labels(complete('MATCH ()-[r:KN')),['KNOWS']);
  assert.ok(labels(complete('MATCH ()-[r:KNOWS|')).includes('ACTED IN'));
  assert.ok(labels(complete('MATCH (n:Person&')).includes('Employee'));
});
test('property suggestions use the declared node label, including WITH aliases and multiple labels',()=>{
  const person=complete('MATCH (p:Person), (m:Movie) RETURN p.');
  assert.ok(labels(person).includes('name'));assert.ok(!labels(person).includes('title'));assert.ok(!labels(person).includes('since'));
  assert.equal(person.options.find(option=>option.label==='age').detail,'Long');
  assert.deepEqual(labels(complete('MATCH (p:Person) WITH p AS person RETURN person.na')),['name']);
  const multiple=labels(complete('MATCH (p:Person:Employee) RETURN p.'));
  assert.ok(multiple.includes('salary'));assert.ok(multiple.includes('age'));
});
test('relationship properties are selected from relType metadata, not node properties',()=>{
  assert.deepEqual(labels(complete('MATCH ()-[r:KNOWS]->() RETURN r.')),['since']);
  assert.deepEqual(labels(complete('MATCH ()-[r:`ACTED IN`]->() RETURN r.')),['role']);
});
test('node and relationship property maps suggest property keys',()=>{
  assert.deepEqual(labels(complete('MATCH (p:Person {na')),['name']);
  assert.deepEqual(labels(complete('MATCH (:Movie {ti')),['title']);
  assert.deepEqual(labels(complete('MATCH (p:Person) RETURN p { .na')),['name']);
  assert.deepEqual(labels(complete('MATCH ()-[r:KNOWS {si')),['since']);
  assert.ok(!labels(complete('MATCH (p:Person {name: Pe')).includes('Person'));
});
test('quoted identifiers, Unicode and embedded backticks are inserted safely',()=>{
  const query='MATCH (p:`Odd l';const result=complete(query);
  assert.equal(apply(query,result,'Odd label'),'MATCH (p:`Odd label`');
  const property='MATCH (`the person`:Person) RETURN `the person`.`display';
  assert.equal(apply(property,complete(property),'display name'),'MATCH (`the person`:Person) RETURN `the person`.`display name`');
  assert.equal(quoteIdentifier('a`b'),'`a``b`');assert.equal(quoteIdentifier('return'),'`return`');
  assert.equal(quoteIdentifier('Клиент'),'Клиент');
  assert.ok(labels(complete('MATCH (n:Кл')).includes('Клиент'));
});
test('replacement at a cursor in the middle of a property removes the old suffix',()=>{
  const query='MATCH (p:Person) RETURN p.nme',position=query.indexOf('nme')+1;
  const result=completeCypher(query,position,schema);
  assert.equal(apply(query,result,'name'),'MATCH (p:Person) RETURN p.name');
  const atStart=completeCypher(query,query.indexOf('nme'),schema,{},true);
  assert.equal(apply(query,atStart,'name'),'MATCH (p:Person) RETURN p.name');
});
test('strings, escaped strings and comments suppress completion and do not forge variable declarations',()=>{
  for(const query of ["RETURN 'Per",'RETURN "Per','// MATCH (p:Pe','/* MATCH (p:Pe'])assert.equal(complete(query,true),null);
  const query='/* MATCH (p:Movie) */ MATCH (p:Person {name:";"}) RETURN p.';
  assert.ok(labels(complete(query)).includes('age'));assert.ok(!labels(complete(query)).includes('title'));
  assert.equal(lexCypher("RETURN 'a\\\'b'").filter(token=>token.kind==='string').length,1);
});
test('statement boundaries avoid leaking labels from an earlier statement',()=>{
  const result=complete('MATCH (p:Person) RETURN p; MATCH (p:Movie) RETURN p.');
  assert.deepEqual(labels(result),['title']);
});
test('parameters use names only; metadata values are never displayed',()=>{
  const query='RETURN $na';const result=completeCypher(query,query.length,schema,{name:'this-private-parameter-value'});
  assert.deepEqual(labels(result),['name']);
  assert.ok(!JSON.stringify(result).includes('this-private-parameter-value'));
  assert.ok(!JSON.stringify(complete('MATCH (p:Person) RETURN p.')).includes('this-private-property-value'));
});
test('incomplete schema falls back safely, and refreshed/disconnected dictionaries remove old names',()=>{
  assert.ok(labels(complete('RETURN unknown.')).includes('name'));
  assert.equal(completeCypher('MATCH (n:',9,buildCompletionSchema(null)),null);
  assert.equal(completeCypher('RETURN n.',9,buildCompletionSchema({labels:['NewLabel']})),null);
  assert.ok(labels(completeCypher('MATCH (n:N',10,buildCompletionSchema({labels:['NewLabel']}))).includes('NewLabel'));
});
test('highlighting distinguishes keywords, strings, numbers, parameters, comments, labels and properties',()=>{
  const result=highlightCypher('MATCH (p:Person) // RETURN is a comment\nWHERE p.age >= $age AND p.name = \'Hello\\\' world\' RETURN 25');
  assert.equal(result.find(token=>token.value==='MATCH').style,'keyword');
  assert.equal(result.find(token=>token.value==='Person').style,'label');
  assert.equal(result.find(token=>token.value==='age').style,'property');
  assert.ok(result.some(token=>token.style==='parameter'));
  assert.ok(result.some(token=>token.style==='comment'&&token.value.includes('RETURN')));
  assert.ok(result.some(token=>token.style==='string'&&token.value.includes('Hello')));
  assert.equal(result.find(token=>token.value==='25').style,'number');
  assert.ok(highlightCypher('/* block\nMATCH */ RETURN `x-y`').some(token=>token.style==='comment'&&token.value.includes('\n')));
});
test('real CodeMirror state updates highlighting and supports undo-safe completion transactions without a DOM',()=>{
  const state=EditorState.create({doc:'ret',extensions:[cypherHighlighting,history()]});
  const result=completionSource(schema,{})(new CompletionContext(state,3,false));
  const transaction=state.update({changes:{from:result.from,to:result.to,insert:result.options.find(option=>option.label==='RETURN').apply}});
  assert.equal(transaction.state.doc.toString(),'RETURN');
  assert.ok(transaction.state.field(cypherHighlighting).size>0);
  let restored=transaction.state;
  assert.equal(undo({state:restored,dispatch:tr=>{restored=tr.state;}}),true);
  assert.equal(restored.doc.toString(),'ret');
  const readOnly=EditorState.create({doc:'ret',extensions:[EditorState.readOnly.of(true)]});
  assert.equal(completionSource(schema,{})(new CompletionContext(readOnly,3,true)),null);
  const quoted=EditorState.create({doc:'MATCH (p:`Per'});
  const quotedResult=completionSource(schema,{})(new CompletionContext(quoted,quoted.doc.length,false));
  assert.equal(quotedResult.filter,false);assert.ok(labels(quotedResult).includes('Person'));
});
test('query-size bounds prevent unbounded autocomplete work',()=>{
  assert.equal(completeCypher('x'.repeat(16001),16001,schema),null);
  assert.ok(highlightCypher('x'.repeat(18000)).every(token=>token.to<=16000));
});
test('UI mounts one editor per view, updates schema/value without remounting and destroys owned resources',async()=>{
  const client=await readFile(new URL('../src/workspace-panel.js',import.meta.url),'utf8');
  const editor=await readFile(new URL('../src/cypher-editor.js',import.meta.url),'utf8');
  assert.ok(client.includes('h(CypherEditor,{value:query,onChange:setQuery'));
  assert.ok(client.includes('schema,parametersText:params,disabled:busy||!restored,active'));
  assert.ok(editor.includes('view.destroy()'));
  assert.ok(editor.includes('current.completions.reconfigure'));
  assert.ok(editor.includes('annotation(fromReact)'));
  assert.ok(editor.includes("key:'Mod-Enter'"));
});
test('highest-precedence completion navigation precedes editor defaults',()=>{
  const fallback={key:'Enter',run:()=>true};
  const state=EditorState.create({extensions:[keymap.of([fallback]),completionNavigation]});
  const bindings=state.facet(keymap).flat();
  assert.deepEqual(bindings.slice(0,5),completionNavigationKeymap);
  assert.equal(bindings.find(binding=>binding.key==='Enter').run,acceptCompletion);
  assert.equal(bindings.find(binding=>binding.key==='Tab').run,acceptCompletion);
  assert.equal(bindings.find(binding=>binding.key==='Escape').run,closeCompletion);
  assert.ok(bindings.indexOf(fallback)>4);
  for(const binding of completionNavigationKeymap)assert.equal(binding.run({state}),false,'inactive completion falls through: '+binding.key);
});
test('diagnostic StateField marks safe line/position ranges and clears on every edit',()=>{
  let state=EditorState.create({doc:'RETURN 1\nRETURN 2',extensions:[cypherDiagnostics,editorHeight(140)]});
  const mark=diagnostic=>{state=state.update({effects:setEditorDiagnostic.of(diagnostic)}).state;return state.field(cypherDiagnostics);};
  let ranges=mark({query:state.doc.toString(),message:'Syntax error',line:2,column:3});
  assert.equal(ranges.size,2);
  const found=[];ranges.between(0,state.doc.length,(from,to,value)=>found.push({from,to,class:value.spec.class,title:value.spec.attributes.title}));
  assert.deepEqual(found,[{from:9,to:9,class:'n4j-cypher-error-line',title:'Syntax error'},{from:11,to:12,class:'n4j-cypher-error-position',title:'Syntax error'}]);
  state=state.update({changes:{from:0,insert:' '}}).state;
  assert.equal(state.field(cypherDiagnostics).size,0);
  assert.equal(mark({query:'old query',offset:999}).size,0);
  assert.equal(mark({query:state.doc.toString(),line:999,column:999}).size,2);
  assert.equal(mark({query:state.doc.toString(),line:1}).size,1);
  state=state.update({changes:{from:0,to:state.doc.length,insert:''}}).state;
  assert.equal(state.field(cypherDiagnostics).size,0);
  assert.equal(mark({query:'',offset:999,message:'Empty query'}).size,1);
  assert.equal(mark(null).size,0);
});
test('installed autocomplete owns selected-option scrolling and editor uses native commands',async()=>{
  const native=await readFile(new URL('../node_modules/@codemirror/autocomplete/dist/index.js',import.meta.url),'utf8');
  const editor=await readFile(new URL('../src/cypher-editor.js',import.meta.url),'utf8');
  assert.ok(native.includes('updateSelectedOption(selected)'));
  assert.ok(native.includes('opt.setAttribute("aria-selected", "true")'));
  assert.ok(native.includes('scrollIntoView(this.list, set)'));
  assert.ok(native.includes('container.scrollTop'));
  assert.ok(editor.includes("{key:'ArrowDown',run:moveCompletionSelection(true)}"));
  assert.ok(editor.includes("{key:'ArrowUp',run:moveCompletionSelection(false)}"));
  assert.ok(editor.includes('Prec.highest(keymap.of(completionNavigationKeymap))'));
  assert.ok(editor.includes('inset 3px 0 var(--dsw-alias-brand-primary)'));
});
test('compiled Client is standalone and includes third-party license notices',async()=>{
  const artifact=await readFile(new URL('../dist/client.js',import.meta.url),'utf8');
  new vm.Script(artifact); // Syntax only: no fake DOM or fake React rendering.
  assert.ok(artifact.includes('__ModuleLoader__'));
  assert.ok(!artifact.includes('https://cdn.'));
  const notices=await readFile(new URL('../dist/THIRD_PARTY_NOTICES.txt',import.meta.url),'utf8');
  assert.ok(notices.includes('@codemirror/view'));assert.ok(notices.includes('MIT'));
});
