import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDragTicker} from '../src/graph-motion.js';
const client=await readFile(new URL('../src/client.js',import.meta.url),'utf8');
const core=vm.runInNewContext(client.slice(0,client.indexOf('// Browser editor imports'))+'\ncreateNeo4jGraphCore()',{}, {timeout:1000});
const nodes=count=>Array.from({length:count},(_,index)=>({id:String(index)}));
const minimum=points=>{const values=Object.values(points);let distance=Infinity;for(let a=0;a<values.length;a++)for(let b=a+1;b<values.length;b++)distance=Math.min(distance,Math.hypot(values[a].x-values[b].x,values[a].y-values[b].y));return distance;};

test('static initial placement is deterministic, non-overlapping and needs no simulation',()=>{
  for(const count of [1,25,100,400]) {
    const first=core.staticLayout(nodes(count),[]),second=core.staticLayout(nodes(count),[]);
    assert.equal(Object.keys(first).length,count);assert.ok(minimum(first)>=core.separation-1e-6);assert.deepEqual(first,second);
    assert.ok(Object.values(first).every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)));
  }
});
test('static connected layout and expansion preserve old coordinates exactly',()=>{
  const original=core.staticLayout(nodes(20),Array.from({length:19},(_,index)=>({source:'0',target:String(index+1)})));
  const before=JSON.stringify(original);
  const expanded=core.staticLayout(nodes(60),Array.from({length:59},(_,index)=>({source:'0',target:String(index+1)})),original);
  for(const [id,position] of Object.entries(original))assert.deepEqual(expanded[id],position);
  assert.equal(JSON.stringify(original),before);assert.ok(minimum(expanded)>=core.separation-1e-6);
  const collapsed=core.staticLayout(nodes(20),[],expanded);assert.deepEqual(collapsed,original);
});
test('static layout does not repair or move deliberately coincident existing positions',()=>{
  const previous={a:{x:19,y:44},b:{x:19,y:44}};
  const result=core.staticLayout([{id:'a'},{id:'b'},{id:'new'}],[{source:'a',target:'new'}],previous);
  assert.equal(result.a.x,19);assert.equal(result.b.y,44);assert.deepEqual(result.a,result.b);
  assert.ok(Math.hypot(result.new.x-19,result.new.y-44)>=core.separation);
  const special=core.staticLayout([{id:'__proto__'},{id:'constructor'}],[]);assert.equal(Object.keys(special).length,2);assert.ok(minimum(special)>=core.separation);
});
test('expansion scale follows visible count ratio and preserves the viewport center world point',()=>{
  const size={width:800,height:600},camera={x:-210,y:97,z:.8};
  const next=core.expansionCamera(camera,size,25,50);
  assert.ok(Math.abs(next.z-camera.z*Math.sqrt(25/50))<1e-10);
  assert.ok(Math.abs((400-next.x)/next.z-(400-camera.x)/camera.z)<1e-8);
  assert.ok(Math.abs((300-next.y)/next.z-(300-camera.y)/camera.z)<1e-8);
  assert.deepEqual(JSON.parse(JSON.stringify(core.expansionCamera(camera,size,25,25))),camera);assert.deepEqual(JSON.parse(JSON.stringify(core.expansionCamera(camera,size,25,10))),camera);
});
test('collapse/reopen does not compound zoom and manual zoom can establish a new density reference',()=>{
  const size={width:800,height:600},camera={x:400,y:300,z:1},reference={count:2,z:1};
  const first=core.expansionCamera(camera,size,2,20,reference);
  const closed=core.expansionCamera(first,size,20,2,reference);
  const reopened=core.expansionCamera(closed,size,2,20,reference);assert.equal(reopened.z,first.z);
  const more=core.expansionCamera(reopened,size,20,40,reference);assert.ok(Math.abs(more.z-Math.sqrt(2/40))<1e-10);
  const manual={...more,z:.7},afterManual=core.expansionCamera(manual,size,40,80,{count:40,z:.7});assert.ok(Math.abs(afterManual.z-.7*Math.sqrt(.5))<1e-10);
  assert.equal(core.expansionCamera({...camera,z:.02},size,1,500).z,.02);
});
function scheduler(step) {
  let next=0;const callbacks=new Map(),cancelled=[];
  const ticker=createDragTicker({request:fn=>{callbacks.set(++next,fn);return next;},cancel:id=>{cancelled.push(id);callbacks.delete(id);},step});
  const tick=()=>{const [id,callback]=callbacks.entries().next().value;callbacks.delete(id);callback();};
  return {ticker,callbacks,cancelled,tick};
}
test('drag ticker schedules no idle frames, starts once and stops immediately',()=>{
  let steps=0;const s=scheduler(()=>{steps++;return true;});assert.equal(s.callbacks.size,0);assert.equal(s.ticker.running,false);
  s.ticker.start();s.ticker.start();assert.equal(s.callbacks.size,1);s.tick();assert.equal(steps,1);assert.equal(s.callbacks.size,1);
  s.ticker.stop();assert.equal(s.callbacks.size,0);assert.equal(s.ticker.running,false);assert.equal(s.cancelled.length,1);
});
test('late frame from a released drag cannot step or disturb a new drag',()=>{
  let steps=0;const s=scheduler(()=>{steps++;return true;});s.ticker.start();const old=[...s.callbacks.values()][0];s.ticker.stop();s.ticker.start();old();assert.equal(steps,0);assert.equal(s.callbacks.size,1);s.tick();assert.equal(steps,1);s.ticker.stop();
});
test('ticker naturally stops when its gesture disappears',()=>{
  const s=scheduler(()=>false);s.ticker.start();s.tick();assert.equal(s.callbacks.size,0);assert.equal(s.ticker.running,false);
});
test('renderer starts physics only past the node-drag threshold, never in layout or pan paths',()=>{
  const layout=client.slice(client.indexOf('React.useLayoutEffect(()=>{'),client.indexOf('const point=e=>'));
  assert.ok(layout.includes('core.staticLayout(nodes,edges,previous)'));assert.ok(!layout.includes('.step('));assert.ok(!layout.includes('requestAnimationFrame('));assert.ok(!layout.includes('motion.current.start()'));
  const begin=client.slice(client.indexOf('const begin='),client.indexOf('const move='));assert.ok(!begin.includes('motion.current.start()'));assert.ok(!begin.includes('.step('));
  const moveStart=client.indexOf('const move='),move=client.slice(moveStart,client.indexOf('const end=',moveStart));assert.ok(move.includes('Math.hypot(dx,dy)<=3'));assert.ok(move.includes('if(d.id!==null&&d.position)'));assert.ok(move.includes('motion.current.start()'));
  assert.ok(client.includes('onPointerCancel:stopMotion,onLostPointerCapture:stopMotion'));assert.ok(client.includes("window.addEventListener('blur',stopMotion)"));assert.ok(client.includes("document.addEventListener('visibilitychange',hidden)"));
  assert.ok(client.includes('if(!d||d.pointerId!==e.pointerId)return;stopMotion()'));
});
