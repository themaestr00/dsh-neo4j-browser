import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Evaluate only the pure geometry prelude, never the React factory or DOM.
const client = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')+'\n'+await readFile(new URL('../src/workspace-panel.js',import.meta.url),'utf8');
const prelude = client.slice(0, client.indexOf('// Browser editor imports'));
const core = vm.runInNewContext(prelude + '\ncreateNeo4jGraphCore()', {}, {timeout:1000});
const nodes = count => Array.from({length:count}, (_,i)=>({id:String(i),labels:['Product'],properties:{name:`Product ${i}`}}));
const settle = (count,edges=[],previous={}) => { const s=core.simulation(nodes(count),edges,previous);for(let i=0;i<180;i++)s.step(previous);return s.snapshot(); };
function minimumDistance(positions) {const values=Object.values(positions);let distance=Infinity;for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)distance=Math.min(distance,Math.hypot(values[i].x-values[j].x,values[i].y-values[j].y));return distance;}

test('25, 100 and 400 disconnected nodes spread without overlap in an unbounded world',()=>{
  for(const count of [25,100,400]) {
    const positions=settle(count),box=core.bounds(positions);
    assert.equal(Object.keys(positions).length,count);
    assert.ok(Object.values(positions).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    assert.ok(minimumDistance(positions)>core.radius*2+20,`overlapping ${count} nodes`);
    if(count>=100)assert.ok(box.width>1000&&box.height>1000,'world should grow beyond viewport');
  }
});
test('connected star keeps large node bodies separated',()=>{
  const positions=settle(100,Array.from({length:99},(_,i)=>({source:'0',target:String(i+1)})));
  assert.ok(minimumDistance(positions)>core.radius*2+10);
});
test('expansion warm-starts existing coordinates without freezing old nodes',()=>{
  const previous=settle(25),expanded=core.simulation(nodes(50),[{source:'0',target:'25'}],previous);
  assert.equal(expanded.snapshot()['0'].x,previous['0'].x);
  assert.equal(expanded.snapshot()['1'].y,previous['1'].y);
  for(let i=0;i<200;i++)expanded.step();
  assert.ok(minimumDistance(expanded.snapshot())>=core.separation-1);
  assert.ok(Object.entries(previous).some(([id,p])=>Math.hypot(expanded.snapshot()[id].x-p.x,expanded.snapshot()[id].y-p.y)>1));
  const simulation=core.simulation([{id:'__proto__'},{id:'constructor'}],[]);
  simulation.step();assert.equal(Object.keys(simulation.snapshot()).length,2);
});
test('drag solver retains collision separation when explicitly stepped',()=>{
  const simulation=core.simulation(nodes(30),[]);
  for(let i=0;i<240;i++)simulation.step();
  const target=simulation.snapshot()['1'];
  for(let i=0;i<20;i++)simulation.step({'0':target});
  const duringDrag=simulation.snapshot();
  assert.equal(duringDrag['0'].x,target.x);assert.equal(duringDrag['0'].y,target.y);
  assert.ok(Math.hypot(duringDrag['1'].x-target.x,duringDrag['1'].y-target.y)>=core.separation-1);
  assert.ok(minimumDistance(duringDrag)>=core.separation-1);
  for(let i=0;i<50;i++)simulation.step();
  assert.ok(minimumDistance(simulation.snapshot())>=core.separation-1);
});
test('coincident expansion nodes resolve with only the dragged node fixed',()=>{
  const previous=Object.fromEntries(nodes(25).map(n=>[n.id,{x:0,y:0}]));
  const simulation=core.simulation(nodes(25),[],previous);
  for(let i=0;i<100;i++)simulation.step({'0':{x:0,y:0}});
  assert.ok(minimumDistance(simulation.snapshot())>=core.separation-1);
});
test('drag solver retains gentle attraction without renderer warm-up steps',()=>{
  const simulation=core.simulation([{id:'solo'}],[],{solo:{x:1000,y:0}});
  simulation.step();
  assert.ok(Math.abs(simulation.snapshot().solo.x-999.675)<1e-9);
  for(let i=0;i<239;i++)simulation.step();
  assert.ok(simulation.snapshot().solo.x>850,'attraction must stay gentle');
  assert.ok(client.includes('Math.max(dragging?.85:.12,1-tick++/180)'));
  assert.ok(!client.includes('nodes.length>100?2:12'));assert.ok(client.includes('core.staticLayout(nodes,edges,previous)'));
  assert.ok(!client.includes('if(nodes.length<=100&&!drag.current)simulation.step'));
});
test('text uses true ellipsis, honors measured width, and preserves full short names',()=>{
  const measure=value=>Array.from(value).length*8;
  assert.equal(core.ellipsis('Short',74,measure),'Short');
  assert.equal(core.ellipsis('known_product_with_a_very_long_name',74,measure),'known_pr…');
  const label=core.ellipsis('😀'.repeat(30),74,measure);
  assert.ok(label.endsWith('…'));assert.ok(!label.includes('\ufffd'));assert.ok(measure(label)<=74);
  assert.equal(core.caption({id:'1',labels:['Product'],properties:{name:'Long full product name'}}),'Long full product name');
});
test('explicit reset supports actual size and fit accounts for world bounds',()=>{
  const positions=settle(100),size={width:900,height:650};
  assert.equal(core.fitCamera(positions,size,false).z,1);
  const fit=core.fitCamera(positions,size);assert.ok(fit.z<1);
  for(const p of Object.values(positions)) {const x=p.x*fit.z+fit.x,y=p.y*fit.z+fit.y;assert.ok(x>=0&&x<=size.width&&y>=0&&y<=size.height);}
});
test('zoom preserves the world point under cursor and permits unbounded panning',()=>{
  const camera={x:-8000,y:20000,z:.8},anchor={x:317,y:280};
  const next=core.zoomCamera(camera,anchor,1.2);
  assert.ok(Math.abs((anchor.x-next.x)/next.z-(anchor.x-camera.x)/camera.z)<1e-8);
  assert.ok(Math.abs((anchor.y-next.y)/next.z-(anchor.y-camera.y)/camera.z)<1e-8);
});
test('edge endpoints clear larger circles; loops and parallel edges have distinct routes',()=>{
  const a={x:0,y:0},b={x:230,y:0};
  const route=core.edgeRoute(a,b);assert.ok(route.d.startsWith('M 46,0'));assert.ok(!route.d.includes('NaN'));
  assert.notEqual(core.edgeRoute(a,b,1).d,core.edgeRoute(a,b,-1).d);
  assert.notEqual(core.edgeRoute(a,a,0).d,core.edgeRoute(a,a,1).d);
});
test('linked nodes quickly follow a dragged node even after the graph cooled',()=>{
  const simulation=core.simulation(nodes(2),[{source:'0',target:'1'}],{'0':{x:0,y:0},'1':{x:330,y:0}});
  for(let i=0;i<240;i++)simulation.step();
  const fixed={'0':{x:-900,y:0}};
  for(let i=0;i<25;i++)simulation.step(fixed);
  const result=simulation.snapshot(),distance=Math.hypot(result['0'].x-result['1'].x,result['0'].y-result['1'].y);
  assert.ok(distance<440,`linked node lagged: ${distance}`);assert.ok(distance>=core.separation-1);
});
test('UI removes expansion buttons and uses a compact native prompt popover beside the editor',()=>{
  assert.ok(!client.includes("button('Clear selection'"));
  assert.ok(!client.includes("button('Expand neighbors'"));
  assert.ok(!client.includes("className:'node-actions'"));
  assert.ok(client.includes('generationOpen&&h(GeneratorMenu'));
  assert.ok(client.includes('element.showPopover()'));
  const menu=client.slice(client.indexOf('generationOpen&&h(GeneratorMenu'));
  assert.ok(!menu.includes("field('Schema labels"));assert.ok(!menu.includes("field('Provider"));assert.ok(!menu.includes("field('System prompt"));
  assert.ok(client.includes("className:'generate-trigger'"));
  assert.ok(!client.includes("h('aside',{className:'assistant-area'}"));
  assert.ok(client.includes('onDoubleClick:e=>{e.stopPropagation();if(!busy)onExpand(node.id);}'));
  assert.ok(client.includes('const capture=e.currentTarget;capture.setPointerCapture'));
  assert.ok(!client.includes('ticks<180'));
  assert.ok(client.includes("className:'property-row'"));
});
test('edge halo is a wide hoverable hit region and fullscreen retains the inspector',()=>{
  assert.ok(client.includes("className:'edge-halo'"));
  assert.ok(client.includes("vectorEffect:'non-scaling-stroke',pointerEvents:'stroke'"));
  assert.ok(client.includes('.graph-edge:hover .edge-halo'));
  assert.ok(client.includes("onSelect({...edge,kind:'relationship'})"));
  assert.ok(client.includes('const visibleInspector=showDetails||expanded'));assert.ok(client.includes('visibleInspector&&inspector'));
  assert.ok(client.includes("const select=value=>{setSelected(value);if(value)openInspector('Properties');}"));
  assert.ok(client.includes('.result-layout.is-fullscreen>.inspector'));
});
test('captions prefer a meaningful product name over an opaque ID',()=>{
  assert.equal(core.caption({id:'node',properties:{id:'uuid',product:'image_processing'}}),'image_processing');
});
test('UI query templates and expansion use 25, not 100 or 50',()=>{
  assert.ok(!client.includes('LIMIT 100'));assert.ok(client.includes('limit:25'));
  assert.ok(client.includes('[rowLimit,setRowLimit]=useState(25)'));
});
