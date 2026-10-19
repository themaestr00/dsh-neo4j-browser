import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {formatCypher,createEditorActions,diagnosticPosition} from '../src/editor-actions.js';
import {lexCypher} from '../src/cypher-completions.js';

const tokens=query=>lexCypher(query).map(token=>[token.kind,query.slice(token.from,token.to)]);
test('format lays out top-level clauses without changing any token bytes',()=>{
  const cases=[
    'MATCH (n:Person) WHERE n.age > $age RETURN n ORDER BY n.name LIMIT 5',
    'optional match (n) with n return n',
    'MATCH (`return`:X {s:"MATCH RETURN", a:[x IN [1,2] WHERE x > 1]}) RETURN `return`',
    "MATCH (n) /* block MATCH\nRETURN */ WHERE n.name = 'a\\\'b' RETURN n",
    'MATCH (n) // WHERE false\nRETURN n',
    'CALL { MATCH (n) RETURN n } RETURN n',
    'MERGE (n:X) ON CREATE SET n.x=1 ON MATCH SET n.x=2 RETURN n',
    'MATCH (n) WHERE n.name STARTS WITH "A" RETURN n',
    'RETURN CASE WHEN true THEN "WITH" ELSE "RETURN" END AS x',
    'RETURN 1 UNION ALL RETURN 2; MATCH (n) RETURN n',
    'RETURN n.return, n.with, $return',
  ];
  for(const query of cases) {
    const formatted=formatCypher(query);
    assert.deepEqual(tokens(formatted),tokens(query),query);
    assert.equal(formatCypher(formatted),formatted,'idempotent: '+query);
  }
  assert.equal(formatCypher(cases[0]),'MATCH (n:Person)\nWHERE n.age > $age\nRETURN n\nORDER BY n.name\nLIMIT 5');
  assert.ok(formatCypher(cases[6]).includes('ON CREATE SET'));
  assert.ok(formatCypher(cases[7]).includes('STARTS WITH'));
  assert.ok(formatCypher(cases[5]).includes('{ MATCH (n) RETURN n }'));
});
test('format preserves unterminated strings, identifiers, block comments and bounded lexing',()=>{
  for(const query of ["MATCH (n) RETURN 'unterminated",'MATCH (n) RETURN `unterminated','MATCH (n) /* no close', 'x '.repeat(12001),'x'.repeat(160001)])assert.equal(formatCypher(query),query);
  assert.equal(formatCypher('MATCH (n) // trailing RETURN'), 'MATCH (n) // trailing RETURN');
});
test('diagnostic coordinates clamp and require the exact original query',()=>{
  const query='RETURN 1\nRETURN 2',doc=EditorState.create({doc:query}).doc;
  const position=details=>diagnosticPosition(doc,{query,...details});
  assert.deepEqual(position({line:2,column:3}),{line:2,offset:11});
  assert.deepEqual(position({line:2}),{line:2,offset:null});
  assert.deepEqual(position({offset:0,line:2,column:8}),{line:1,offset:0});
  assert.deepEqual(position({offset:999}),{line:2,offset:doc.length});
  assert.deepEqual(position({offset:-5}),{line:1,offset:0});
  assert.deepEqual(position({line:-5,column:-3}),{line:1,offset:0});
  assert.deepEqual(position({line:999,column:999}),{line:2,offset:doc.length});
  assert.deepEqual(position({line:2,column:NaN}),{line:2,offset:null});
  assert.equal(position({offset:Infinity}),null);
  assert.equal(position({line:NaN}),null);
  assert.equal(position({}),null);
  assert.equal(diagnosticPosition(doc,{query:'EXPLAIN '+query,offset:8}),null);
  assert.equal(diagnosticPosition(doc,{offset:0}),null);
  const empty=EditorState.create().doc;
  assert.deepEqual(diagnosticPosition(empty,{query:'',offset:30}),{line:1,offset:0});
});
test('imperative edits are normal undoable state transactions and respect read-only/disposal',()=>{
  // A CodeMirror command target using real EditorState, not an emulated DOM/view.
  let state=EditorState.create({doc:'MATCH (n) RETURN n',extensions:[history()]});
  let disabled=false,disposed=false;
  const target={get state(){return state;},dispatch(spec){state=spec.state||state.update(spec).state;}};
  const actions=createEditorActions(()=>disposed?null:target,()=>disabled);
  assert.deepEqual(Object.keys(actions),['format','clear','focus']);
  assert.equal(actions.format(),true);assert.equal(state.doc.toString(),'MATCH (n)\nRETURN n');
  assert.equal(actions.format(),false);
  assert.equal(undo(target),true);assert.equal(state.doc.toString(),'MATCH (n) RETURN n');
  disabled=true;assert.equal(actions.clear(),false);assert.equal(actions.format(),false);
  disabled=false;assert.equal(actions.clear(),true);assert.equal(state.doc.length,0);
  assert.equal(actions.clear(),false);
  state=EditorState.create({doc:'RETURN 1',extensions:[EditorState.readOnly.of(true)]});
  assert.equal(actions.clear(),false);assert.equal(actions.format(),false);
  disposed=true;for(const method of Object.values(actions))assert.equal(method(),false);
});
test('actions lifecycle and controlled height are source contracts without React/DOM emulation',async()=>{
  const editor=await readFile(new URL('../src/cypher-editor.js',import.meta.url),'utf8');
  const actions=await readFile(new URL('../src/editor-actions.js',import.meta.url),'utf8');
  assert.ok(editor.includes('height,diagnostic,actionsRef'));
  assert.ok(editor.includes('actionsRef.current=actions'));
  assert.ok(editor.includes('actionsRef.current=null'));
  assert.ok(editor.includes('current.sizing.reconfigure(editorHeight(height))'));
  assert.ok(editor.includes('setEditorDiagnostic.of(diagnostic)'));
  assert.ok(editor.includes('view.requestMeasure()'));
  assert.ok(actions.includes('view.focus()'));
  assert.ok(!actions.includes('onRun'));
  assert.ok(!editor.includes('querySelector'));
  assert.ok(!editor.includes('scrollTop'));
});
