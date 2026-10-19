import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const panel=await readFile(new URL('../src/workspace-panel.js',import.meta.url),'utf8');
const client=await readFile(new URL('../src/client.js',import.meta.url),'utf8');
const styles=await readFile(new URL('../src/workspace-styles.js',import.meta.url),'utf8');

test('fullscreen query toggle reveals the same mounted editor instead of moving or duplicating it',()=>{
  assert.equal((panel.match(/h\(CypherEditor,/g)||[]).length,1);
  assert.ok(panel.includes("workspace${expanded?' fullscreen-workspace':''}"));
  assert.ok(panel.includes("id:editorId,className:'card editor-card',hidden:expanded&&!fullscreenQueryOpen"));
  assert.ok(panel.includes("'aria-expanded':fullscreenQueryOpen,'aria-controls':editorId"));
  assert.ok(panel.includes("title:t(fullscreenQueryOpen?'Hide query panel':'Show query panel')"));
  assert.ok(panel.includes('active:active&&(!expanded||fullscreenQueryOpen)'));
  assert.ok(panel.includes('if(expanded&&fullscreenQueryOpen)editorActions.current?.focus()'));
  assert.ok(panel.includes('if(expanded)setFullscreenQueryOpen(true);queueMicrotask'));
  assert.ok(!panel.includes('createPortal'));
});
test('fullscreen exit is owned by the workspace in every result mode and respects editing/popup Escape',()=>{
  assert.ok(panel.includes("title:t('Exit fullscreen'),'aria-label':t('Exit fullscreen')"));
  assert.ok(panel.includes("event.key!=='Escape'||event.defaultPrevented||generationOpen"));
  assert.ok(panel.includes("event.target?.closest?.('input,textarea,.cm-editor,[popover],details[open]')"));
  assert.ok(panel.includes('onExpandedChange:changeExpanded'));
  assert.ok(!client.includes("if(e.key==='Escape')onExpandedChange(false)"));
  const change=panel.slice(panel.indexOf('function changeExpanded('),panel.indexOf('function toggleFullscreenQuery('));
  assert.ok(!change.includes('setQuery('));assert.ok(!change.includes('setResult('));assert.ok(!change.includes('setGraphRevision('));
});
test('fullscreen editor and results share one bounded flex surface with legacy fixed positioning overridden',()=>{
  assert.ok(styles.includes('.workspace.fullscreen-workspace{position:fixed;'));
  assert.ok(styles.includes('.fullscreen-workspace>.editor-card[hidden]{display:none}'));
  assert.ok(styles.includes('max-height:55vh;overflow:auto'));
  assert.ok(styles.includes('.fullscreen-workspace>.result-card{display:flex;flex-direction:column;flex:1;'));
  assert.ok(styles.includes('.fullscreen-workspace .workbench.result-layout.is-fullscreen{position:relative;inset:auto;z-index:auto;'));
  assert.ok(styles.includes('grid-template-rows:minmax(180px,1fr) minmax(150px,.7fr)'));
  assert.ok(styles.includes('.fullscreen-workspace .workbench.result-layout.is-fullscreen>.inspector{height:auto;min-height:0}'));
});
