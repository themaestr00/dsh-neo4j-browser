// Pure geometry, shared with the headless algorithm tests; no DOM or React needed.
function createNeo4jGraphCore() {
  const radius = 44, separation = 200;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function caption(node) {
    const properties = node.properties || {};
    for (const key of ['name', 'title', 'product', 'displayName', 'cve_id', 'cve', 'id']) {
      const value = properties[key];
      if ((typeof value === 'string' && value.trim()) || typeof value === 'number') return String(value);
    }
    return String(node.labels?.[0] || node.id);
  }
  function ellipsis(value, width, measure) {
    const chars = Array.from(String(value));
    if (measure(chars.join('')) <= width) return chars.join('');
    if (measure('…') > width) return '';
    let lo = 0, hi = chars.length;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (measure(chars.slice(0, mid).join('') + '…') <= width) lo = mid; else hi = mid - 1; }
    return chars.slice(0, lo).join('') + '…';
  }
  function bounds(points) {
    const values = Object.values(points);
    if (!values.length) return {x:0,y:0,width:radius*2,height:radius*2};
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for (const p of values) { left=Math.min(left,p.x-radius);right=Math.max(right,p.x+radius);top=Math.min(top,p.y-radius);bottom=Math.max(bottom,p.y+radius); }
    return {x:(left+right)/2,y:(top+bottom)/2,width:right-left,height:bottom-top};
  }
  function fitCamera(points, size, fit = true) {
    const box = bounds(points), z = fit ? clamp(Math.min((size.width-120)/box.width,(size.height-120)/box.height),.02,1) : 1;
    return {x:size.width/2-box.x*z,y:size.height/2-box.y*z,z};
  }
  function initialCamera(points,size) {
    const count=Object.keys(points).length,box=bounds(points);
    const fit=Math.min((size.width-80)/box.width,(size.height-80)/box.height);
    const z=clamp(Math.min(1,Math.sqrt(10/Math.max(10,count)),fit*.9),.02,1);
    return {x:size.width/2-box.x*z,y:size.height/2-box.y*z,z};
  }
  function centerCamera(points,size,z) {const box=bounds(points);return {x:size.width/2-box.x*z,y:size.height/2-box.y*z,z};}
  function zoomCamera(camera, anchor, factor) {
    const z=clamp(camera.z*factor,.02,4),ratio=z/camera.z;
    return {x:anchor.x-(anchor.x-camera.x)*ratio,y:anchor.y-(anchor.y-camera.y)*ratio,z};
  }
  function expansionCamera(camera,size,beforeCount,afterCount,reference={count:beforeCount,z:camera.z}) {
    if(afterCount<=beforeCount)return {...camera};
    const target=Math.min(camera.z,reference.z*Math.sqrt(Math.max(1,reference.count)/afterCount));
    return zoomCamera(camera,{x:size.width/2,y:size.height/2},target/camera.z);
  }
  function staticLayout(nodes,edges,previous={}) {
    const placed=new Map(),cells=new Map(),adjacent=new Map(nodes.map(node=>[node.id,[]]));
    const cell=(x,y)=>`${Math.floor(x/separation)},${Math.floor(y/separation)}`;
    const put=(id,point)=>{placed.set(id,point);const key=cell(point.x,point.y);if(!cells.has(key))cells.set(key,[]);cells.get(key).push(point);};
    const clear=point=>{const cx=Math.floor(point.x/separation),cy=Math.floor(point.y/separation);for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const other of cells.get(`${x},${y}`)||[])if(Math.hypot(other.x-point.x,other.y-point.y)<separation)return false;return true;};
    for(const node of nodes)if(Object.hasOwn(previous,node.id)){const old=previous[node.id];if(Number.isFinite(old?.x)&&Number.isFinite(old?.y))put(node.id,{x:old.x,y:old.y});}
    for(const edge of edges){if(edge.source===edge.target)continue;adjacent.get(edge.source)?.push(edge.target);adjacent.get(edge.target)?.push(edge.source);}
    for(const [nodeIndex,node] of nodes.entries()) {
      if(placed.has(node.id))continue;
      const neighbors=(adjacent.get(node.id)||[]).map(id=>placed.get(id)).filter(Boolean);
      const anchor=neighbors.length?{x:neighbors.reduce((sum,p)=>sum+p.x,0)/neighbors.length,y:neighbors.reduce((sum,p)=>sum+p.y,0)/neighbors.length}:{x:0,y:0};
      let point=anchor;
      search:if(!clear(point))for(let ring=1;;ring++)for(let index=0;index<6*ring;index++){
        const angle=nodeIndex*2.399963229728653+index*Math.PI*2/(6*ring),distance=separation*1.08*ring;
        const candidate={x:anchor.x+Math.cos(angle)*distance,y:anchor.y+Math.sin(angle)*distance};
        if(clear(candidate)){point=candidate;break search;}
      }
      put(node.id,point);
    }
    return Object.fromEntries(placed);
  }
  function simulation(nodes, edges, previous = {}) {
    const points = new Map(nodes.map((node,i)=>{
      const old=previous[node.id], a=i*2.399963229728653, r=separation*.63*Math.sqrt(i);
      return [node.id,{id:node.id,x:old?.x??Math.cos(a)*r,y:old?.y??Math.sin(a)*r,vx:0,vy:0}];
    }));
    const pairs=new Set(),links=[];
    for(const e of edges) {const a=points.get(e.source),b=points.get(e.target);if(!a||!b||a===b)continue;const key=JSON.stringify([a.id,b.id].sort());if(!pairs.has(key)){links.push([a,b]);pairs.add(key);}}
    // Fallback seeding for the solver; the UI supplies complete static positions
    // and calls step only during an actual node drag.
    for(const p of points.values())if(!previous[p.id]) {const adjacent=links.flatMap(([a,b])=>a===p&&previous[b.id]?[b]:b===p&&previous[a.id]?[a]:[]);if(adjacent.length){const a=Array.from(points.keys()).indexOf(p.id)*2.399963229728653;p.x=adjacent[0].x+Math.cos(a)*330;p.y=adjacent[0].y+Math.sin(a)*330;}}
    const values=[...points.values()];let tick=0;
    function step(fixed = {}) {
      const dragging=Object.keys(fixed).length>0;
      const alpha=Math.max(dragging?.85:.12,1-tick++/180);
      for(const p of values)if(Object.hasOwn(fixed,p.id)){p.x=fixed[p.id].x;p.y=fixed[p.id].y;p.vx=0;p.vy=0;}
      for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++) {
        const a=values[i],b=values[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
        if(d<.001){dx=.01;dy=.01*(j-i);d=Math.hypot(dx,dy);}
        const strength=(d<separation?(separation-d)*.25:Math.min(1.8,2500/(d*d))*alpha),fx=dx/d*strength,fy=dy/d*strength;
        a.vx-=fx;a.vy-=fy;b.vx+=fx;b.vy+=fy;
      }
      for(const [a,b] of links) {const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,f=(d-330)*.12*alpha;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
      for(const p of values) {
        if(Object.hasOwn(fixed,p.id)){p.x=fixed[p.id].x;p.y=fixed[p.id].y;p.vx=0;p.vy=0;continue;}
        p.vx=(p.vx-p.x*.0005*alpha)*.65;p.vy=(p.vy-p.y*.0005*alpha)*.65;
        const speed=dragging?48:24;p.x+=clamp(p.vx,-speed,speed);p.y+=clamp(p.vy,-speed,speed);
      }
      // Position-based collision constraints stay active after cooling and during drag.
      // A spatial grid bounds collision work even for large result sets.
      for(let pass=0;pass<5;pass++) {
        const cells=new Map();let overlaps=0;
        for(const p of values){const key=`${Math.floor(p.x/separation)},${Math.floor(p.y/separation)}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);}
        for(let i=0;i<values.length;i++) {
          const a=values[i],cx=Math.floor(a.x/separation),cy=Math.floor(a.y/separation);
          for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const b of cells.get(`${x},${y}`)||[]) {
            if(a===b||a.id>=b.id)continue;
            let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
            if(d>=separation-.01)continue;
            if(d<.001){const angle=(i+1)*2.399963229728653;dx=Math.cos(angle);dy=Math.sin(angle);d=1;}
            const af=Object.hasOwn(fixed,a.id),bf=Object.hasOwn(fixed,b.id);if(af&&bf)continue;
            const delta=(separation-d+.05)/(af||bf?1:2),fx=dx/d*delta,fy=dy/d*delta;
            if(!af){a.x-=fx;a.y-=fy;}if(!bf){b.x+=fx;b.y+=fy;}overlaps++;
          }
        }
        if(!overlaps)break;
      }
    }
    const snapshot=()=>Object.fromEntries(values.map(p=>[p.id,{x:p.x,y:p.y}]));
    return {step,snapshot};
  }
  function edgeRoute(a,b,index=0) {
    if(a===b || (a.x===b.x&&a.y===b.y)) {const height=100+index*22;return {d:`M ${a.x-28},${a.y-34} C ${a.x-height},${a.y-height-40} ${a.x+height},${a.y-height-40} ${a.x+28},${a.y-34}`,x:a.x,y:a.y-height,angle:0,available:100};}
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length,bend=index*30;
    const cx=(a.x+b.x)/2-uy*bend,cy=(a.y+b.y)/2+ux*bend;
    const startLength=Math.hypot(cx-a.x,cy-a.y)||1,endLength=Math.hypot(b.x-cx,b.y-cy)||1;
    const start={x:a.x+(cx-a.x)/startLength*(radius+2),y:a.y+(cy-a.y)/startLength*(radius+2)};
    const end={x:b.x-(b.x-cx)/endLength*(radius+9),y:b.y-(b.y-cy)/endLength*(radius+9)};
    let angle=Math.atan2(dy,dx)*180/Math.PI;if(angle>90||angle< -90)angle+=180;
    return {d:`M ${start.x},${start.y} Q ${cx},${cy} ${end.x},${end.y}`,x:(start.x+2*cx+end.x)/4,y:(start.y+2*cy+end.y)/4,angle,available:Math.max(0,length-2*radius-35)};
  }
  return {radius,separation,caption,ellipsis,bounds,fitCamera,initialCamera,centerCamera,zoomCamera,expansionCamera,staticLayout,simulation,edgeRoute};
}
// Persist only editor-owned state, never connections, credentials, results or write authority.
function createNeo4jStateCore() {
  const defaultQuery='MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 25';
  const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const string=(value,max,fallback='')=>typeof value==='string'&&value.length<=max?value:fallback;
  function normalize(input) {
    const data=isObject(input)?input:{},history=[];let size=0;
    for(const item of Array.isArray(data.history)?data.history:[]) {
      if(history.length>=100)break;
      if(!isObject(item)||typeof item.query!=='string'||!item.query.trim()||item.query.length>16000)continue;
      const parameters=isObject(item.parameters)?item.parameters:{};
      const entry={id:string(item.id,128),query:item.query,parameters,at:Number.isSafeInteger(item.at)&&item.at>=0&&item.at<=8640000000000000?item.at:0};
      if(['running','completed','failed','cancelled'].includes(item.status))entry.status=item.status;
      if(Number.isFinite(item.durationMs)&&item.durationMs>=0)entry.durationMs=Math.min(86400000,Math.round(item.durationMs));
      if(Number.isInteger(item.rows)&&item.rows>=0)entry.rows=Math.min(item.rows,1000000);
      let length;try{length=JSON.stringify(entry).length;}catch{continue;}if(length>65536||size+length>1000000)continue;
      size+=length;history.push(entry);
    }
    const source=isObject(data.layout)?data.layout:{},number=(key,fallback,min,max)=>Number.isFinite(source[key])?Math.round(Math.max(min,Math.min(max,source[key]))):fallback;
    const layout={editorHeight:number('editorHeight',140,64,640),graphHeight:number('graphHeight',520,240,1600),inspectorHeight:number('inspectorHeight',360,160,1200),inspectorWidth:number('inspectorWidth',280,200,640),inspectorTab:source.inspectorTab==='History'?'History':'Properties',showDetails:source.showDetails!==false,showMetadata:source.showMetadata===true,showConnection:source.showConnection===true,queryOptions:source.queryOptions===true,generationSettings:source.generationSettings===true};
    return {format:2,query:string(data.query,16000,defaultQuery),params:string(data.params,65536,'{}'),history,rowLimit:[25,50,100,200].includes(data.rowLimit)?data.rowLimit:25,question:string(data.question,4000),labels:string(data.labels,8000),tab:['Graph','Table','JSON'].includes(data.tab)?data.tab:'Graph',layout};
  }
  function key(scope,base,surface='') {return `neo4j-browser:editor:v1:${encodeURIComponent(scope||'default')}:${encodeURIComponent(base||'/')}${surface?':'+encodeURIComponent(surface):''}`;}
  function load(storage,id,fallbackId) {try{const raw=storage.getItem(id)??(fallbackId?storage.getItem(fallbackId):null);const saved=normalize(JSON.parse(raw||'null'));saved.history=saved.history.map(entry=>entry.status==='running'?{...entry,status:'cancelled'}:entry);return saved;}catch{return normalize(null);}}
  function save(storage,id,value) {try{storage.setItem(id,JSON.stringify(normalize(value)));return true;}catch{return false;}}
  function append(history,entry) {return normalize({history:[{...entry,at:Date.now()},...history]}).history;}
  return {normalize,key,load,save,append,defaultQuery};
}
// Register a page through the public right-sidebar contract, without replacing Start.
function registerNeo4jSidebar(ctx,View,Icon,t) {
  const id='@local/neo4j-browser/sidebar';
  ctx.effect(()=>ctx.sidebarRightTabs.register({
    id,kind:'neo4j-browser',keepMounted:true,title:()=>t('Neo4j Browser'),
    guide:[{id:'neo4j-browser',order:50,title:()=>t('Neo4j Browser'),description:()=>t('Explore Neo4j graphs and run Cypher beside your conversation.'),icon:Icon}],
  }));
  ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:id},View));
}
// Browser editor imports (pure graph/state prelude above remains independently testable).
import {createCypherEditor} from './cypher-editor.js';
import {describeEntity} from './workspace-core.js';
import {createWorkspacePanel} from './workspace-panel.js';
import {workspaceCss} from './workspace-styles.js';
import {createDragTicker} from './graph-motion.js';
window.__ModuleLoader__.load({
  id: '@local/neo4j-browser',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo } = React;
    const CLIENT_VERSION='1.0.0',stateCore=createNeo4jStateCore();
    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        const texts = ['Neo4j Browser','Connection','URI','Username','Password','Database','Connect','Disconnect','Connected','Not connected','Use a read-only database account. Credentials stay in Host memory until disconnect or restart.','Cypher','Parameters (JSON)','Run query','Allow writes for this run','Confirm write','Cancel','This query may change your database. Review the exact query before confirming.','Graph','Table','JSON','No results yet. Run a query to explore your graph.','No graph entities in these results. Use RETURN n, r, m to visualize nodes and relationships.','Query assistant','Question','Generate Cypher','Review generated Cypher before running it. Generation never executes a query.','Schema metadata and your question are sent to the selected LLM provider. No property values, credentials or chat history are included.','Schema','Refresh schema','Schema labels (comma-separated, optional)','Generation settings','System prompt','Provider (empty = Harness default)','Model (empty = Harness default)','Save settings','Settings saved','Loading…','Error','Properties','Expand neighbors','Zoom in','Zoom out','Fit graph','Rows','Results truncated','Context preview','History','No query history','Close','Read only','Write confirmation','Database connection is shared across this profile.','Selected','Clear selection','Retry','Limit','Connection settings','AI settings apply to this Host process.','Query completed','Graph browser','Show connection','Hide connection'];
        texts.push('Database Information','Node labels','Relationship types','Property keys','Overview','Use database','No metadata available','Select a node or relationship to inspect its properties.','Property','Value','Metadata may be incomplete. Refresh schema to retry.','Counts refer to the displayed graph, not the entire database.','Search metadata','All nodes','All relationships');
        texts.push('Expand graph','Restore graph','Actual size','Pin node','Unpin node','Drag to pan · Scroll to move · Ctrl/⌘ + scroll to zoom','Show details','Hide details','Row limit','Query options');
        texts.push('Double-click a node to load its relationships.','Shift+Enter','Prompt');
        texts.push('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.','Query text and parameters are stored locally in this browser. Passwords and query results are not stored.','Browser storage is unavailable. Query history will not survive closing this page.','Unknown','Schema cached');
        texts.push('Explore Neo4j graphs and run Cypher beside your conversation.','Show database info','Hide database info');
        texts.push('Ctrl+Space: suggestions · Tab/Enter: accept · Ctrl/⌘+Enter: run','Cypher keyword','Function','Variable','Parameter','Node label','Relationship type');
        texts.push('Stop','Completed','Running…','Failed','Cancelled','Run again','Edit','Copy','Copied','Clipboard is unavailable.','Format query','Clear','Editor actions','Connection menu','Database','Other database…','Apply','Refresh databases','Database list unavailable','Fit to screen','Reset zoom','Center graph','Inspecting','Resize query editor','Resize graph','Resize inspector','Resize inspector width','Open History','Close inspector','Query cancelled. A write may already have committed; check database state before retrying.','Operation in progress','Show database info','Hide database info','Hide connection','Query error');
        texts.push('Default','Query','Result view','Node','rows','Database list is truncated. Use Other database… for another name.');
        texts.push('Double-click to hide added neighbors.');
        texts.push('Query panel','Show query panel','Hide query panel','Exit fullscreen');
        const labelColor = label => { const palette = ['--dsw-alias-brand-primary','--dsw-alias-state-success-primary','--dsw-alias-state-warn-primary','--dsw-alias-state-error-primary']; let hash = 0; for (const c of label || '') hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return `var(${palette[hash % palette.length]})`; };
        ctx.effect(() => ctx.locale.register('local.neo4j', 'en', Object.fromEntries(texts.map((s,i) => [`s${i}`,s]))));
        const translate = ctx.locale.bind('local.neo4j');
        const t = text => { const i = texts.indexOf(text); return i < 0 ? text : translate(`s${i}`); };
        const CypherEditor=createCypherEditor(React,t);
        const editorCss=`.n4j .cypher-editor{flex:1;min-width:0;overflow:visible;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base)}.n4j .cypher-editor:focus-within{border-color:var(--dsw-alias-brand-primary)}.n4j .cypher-editor-host{min-width:0}.n4j .cypher-editor-hint{padding:3px 8px 5px;color:var(--dsw-alias-label-secondary);font:10px/1.4 system-ui}.n4j.compact-sidebar .cypher-editor-hint{font-size:9px}`;
        const css = `.n4j{height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui;padding:24px;box-sizing:border-box}.n4j *{box-sizing:border-box}.n4j h1{font-size:21px;margin:0}.n4j h2{font-size:14px;margin:0 0 12px}.n4j p{margin:8px 0}.n4j .muted{color:var(--dsw-alias-label-secondary);font-size:12px}.n4j .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.n4j .spread{justify-content:space-between}.n4j .card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1);margin-top:16px}.n4j .grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,340px);gap:16px}.n4j .fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.n4j label{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}.n4j input,.n4j textarea,.n4j select{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:8px;font:inherit}.n4j textarea{resize:vertical;min-height:64px}.n4j .code{font:12px/1.6 ui-monospace,monospace;tab-size:2}.n4j button{cursor:pointer;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:7px 11px;font:inherit}.n4j button:hover{border-color:var(--dsw-alias-brand-primary)}.n4j button:focus-visible,.n4j input:focus-visible,.n4j textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.n4j button:disabled{opacity:.5;cursor:not-allowed}.n4j .primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}.n4j .error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}.n4j .success{color:var(--dsw-alias-state-success-primary)}.n4j .warn{color:var(--dsw-alias-state-warn-primary)}.n4j .check{display:flex;flex-direction:row;align-items:center;margin:0;gap:6px}.n4j .check input{width:auto}.n4j pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;max-height:360px;overflow:auto}.n4j .table{overflow:auto;max-height:450px}.n4j table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace}.n4j td,.n4j th{text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px;max-width:340px;overflow-wrap:anywhere}.n4j th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2)}.n4j .canvas{height:440px;width:100%;touch-action:none;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}.n4j summary{cursor:pointer;font-weight:600}.n4j .tabs [aria-selected=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.n4j .history{max-height:180px;overflow:auto}.n4j .history button{display:block;text-align:left;width:100%;margin:6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:1000px){.n4j .grid{grid-template-columns:1fr}}`;
        const browserCss = `.n4j{padding:16px}.n4j .grid{grid-template-columns:230px minmax(0,1fr)}.n4j .database-info{background:var(--dsw-alias-bg-layer-2);padding:18px;border-radius:10px;min-width:0;align-self:start;margin-top:16px}.n4j .database-info h2{font-size:18px}.n4j .meta-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:18px;margin-top:20px}.n4j .meta-section h3{font-size:13px;margin:0 0 12px}.n4j .chips{display:flex;gap:7px;flex-wrap:wrap}.n4j .chip{border-radius:18px;padding:4px 10px;font-size:12px;overflow-wrap:anywhere;max-width:100%;border-color:var(--n4j-color,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--n4j-color,var(--dsw-alias-bg-layer-2)) 16%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}.n4j .result-layout{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px;margin-top:12px}.n4j .inspector{background:var(--dsw-alias-bg-layer-2);padding:16px;border-radius:8px;min-width:0;max-height:600px;overflow:auto}.n4j .inspector h3{font-size:13px;margin:18px 0 10px}.n4j .workspace{min-width:0}.n4j .canvas{height:clamp(360px,55vh,760px)}.n4j .property-list{margin:12px 0}.n4j .property-list dt{color:var(--dsw-alias-label-secondary);font:12px ui-monospace,monospace;padding-top:10px}.n4j .property-list dd{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}.n4j .assistant-area{display:grid;grid-template-columns:1fr 1fr;gap:14px}.n4j .assistant-area>div:first-child{grid-row:span 2}@media(max-width:1200px){.n4j .result-layout{grid-template-columns:minmax(0,1fr)}.n4j .inspector{max-height:300px}}@media(max-width:750px){.n4j .grid{grid-template-columns:1fr}.n4j .database-info{max-height:350px;overflow:auto}.n4j .assistant-area{grid-template-columns:1fr}}`;
        const graphCss = `.n4j{padding:12px}.n4j .grid{gap:12px;grid-template-columns:220px minmax(0,1fr)}.n4j .card{border-radius:5px;margin-top:12px;padding:12px}.n4j .database-info{border-radius:5px;position:sticky;top:0;max-height:calc(100vh - 100px);overflow:auto;padding:16px;margin-top:12px}.n4j .database-info h2{font-size:16px}.n4j .result-card{padding:0;overflow:hidden}.n4j .result-header{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}.n4j .result-header button{border:0;border-radius:3px;padding:6px 10px}.n4j .result-layout{display:block;position:relative;margin:0}.n4j .result-layout>.inspector{position:absolute;right:12px;top:12px;bottom:65px;width:220px;max-height:none;border:1px solid var(--dsw-alias-border-l1);border-radius:3px;background:var(--dsw-alias-bg-overlay);padding:14px;opacity:.96}.n4j .graph-stage{position:relative;width:100%;height:clamp(560px,76vh,1050px);overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.n4j .graph-stage.is-expanded{position:fixed;inset:12px;width:auto;height:auto;z-index:1000;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;box-shadow:0 0 0 100vmax color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent)}.n4j .graph-stage .canvas{display:block;width:100%;height:100%;border:0;border-radius:0;background:var(--dsw-alias-bg-layer-1);cursor:grab;touch-action:none;user-select:none}.n4j .graph-stage .canvas:active{cursor:grabbing}.n4j .graph-node,.n4j .graph-edge{cursor:pointer;outline:none}.n4j .node-halo{opacity:0;pointer-events:none}.n4j .graph-node:hover .node-halo,.n4j .graph-node:focus-visible .node-halo{opacity:.22}.n4j .graph-node.selected .node-halo{stroke:var(--dsw-alias-state-warn-primary);opacity:.4}.n4j .edge-caption{fill:var(--dsw-alias-label-secondary);stroke:var(--dsw-alias-bg-layer-1);stroke-width:4;paint-order:stroke;stroke-linejoin:round}.n4j .graph-edge:focus-visible>path{stroke:var(--dsw-alias-brand-primary)}.n4j .graph-tools{position:absolute;bottom:42px;right:12px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:3px;overflow:hidden}.n4j .has-details .graph-tools{right:246px}.n4j .has-details .is-expanded .graph-tools{right:12px}.n4j .graph-tools button{width:36px;height:36px;padding:0;font-size:21px;border:0;border-radius:0;background:transparent}.n4j .graph-tools button:last-child{font-size:12px}.n4j .graph-tools button:hover{background:var(--dsw-alias-bg-layer-2)}.n4j .graph-status{position:absolute;left:12px;top:12px;pointer-events:none;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);padding:4px 8px;border-radius:3px}.n4j .graph-hint{position:absolute;bottom:12px;left:12px;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none}.n4j .graph-empty{position:absolute;inset:40% 15% auto;text-align:center;color:var(--dsw-alias-label-secondary);pointer-events:none}.n4j .query-editor{display:flex;align-items:flex-start;gap:12px}.n4j .query-editor:before{content:'neo4j$';font:16px/1.6 ui-monospace,monospace;padding-top:7px;color:var(--dsw-alias-label-secondary)}.n4j .query-editor label{flex:1;font-size:0;margin:0}.n4j .query-editor textarea{font-size:14px;min-height:62px;border:0;background:var(--dsw-alias-bg-base)}.n4j .query-editor .primary{margin-top:8px}.n4j .query-options{margin-top:8px}.n4j .query-options summary{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}.n4j .query-options>label{margin-top:10px}.n4j .result-card>.table,.n4j .result-card>pre{padding:12px}.n4j .row-limit{display:flex;flex-direction:row;align-items:center;gap:8px;margin:0}.n4j .row-limit select{width:76px;padding:4px}.n4j .assistant-area{margin-top:12px}.n4j .chip{font-size:11px;padding:4px 9px}.n4j .inspector p{overflow-wrap:anywhere}.n4j .workspace{padding-bottom:16px}@media(max-width:750px){.n4j .grid{grid-template-columns:1fr}.n4j .database-info{position:static;max-height:260px}.n4j .has-details .graph-tools{right:211px}.n4j .result-layout>.inspector{width:185px;max-height:45%;bottom:auto}.n4j .graph-stage{height:70vh;min-height:480px}}`;
        const polishCss = `.n4j h1,.n4j h2,.n4j h3{font-family:system-ui,sans-serif;line-height:1.4}.n4j .grid{margin-top:12px;align-items:start}.n4j .grid>.database-info,.n4j .workspace>.card:first-child{margin-top:0}.n4j .query-editor{align-items:flex-start}.n4j .query-editor .generate-trigger{margin-top:8px;display:flex;align-items:center;justify-content:center;width:38px;min-width:38px;height:38px;padding:7px;color:var(--dsw-alias-brand-primary)}.n4j .query-editor>.primary{height:38px;white-space:nowrap}.n4j .result-layout.has-details{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:0;align-items:stretch}.n4j .result-layout>.inspector{position:static;inset:auto;width:auto;max-height:clamp(560px,76vh,1050px);border:0;border-left:2px solid var(--dsw-alias-border-l2);border-radius:0;background:var(--dsw-alias-bg-base);opacity:1;padding:0;box-shadow:-6px 0 16px color-mix(in srgb,var(--dsw-alias-bg-base) 35%,transparent)}.n4j .inspector>.bar{padding:16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);position:sticky;top:0;z-index:1}.n4j .inspector h2{font-size:15px;margin:0}.n4j .inspector>p,.n4j .inspector>h3,.n4j .inspector>.chips{margin-left:16px;margin-right:16px}.n4j .inspector>p:first-of-type{font-size:11px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.n4j .property-list{margin:14px 0 0}.n4j .property-row{padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1)}.n4j .property-row:nth-child(odd){background:var(--dsw-alias-bg-layer-1)}.n4j .property-list dt{font-family:system-ui,sans-serif;font-weight:600;font-size:11px;letter-spacing:.025em;padding:0;color:var(--dsw-alias-label-secondary)}.n4j .property-list dd{margin-top:6px;color:var(--dsw-alias-label-primary);line-height:1.6}.n4j .result-layout.has-details .graph-tools{right:12px}.n4j .n4j-generator{margin:auto;width:min(660px,calc(100vw - 32px));max-height:85vh;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 20px 80px color-mix(in srgb,var(--dsw-alias-bg-base) 70%,transparent);font:13px/1.5 system-ui,sans-serif}.n4j .n4j-generator::backdrop{background:color-mix(in srgb,var(--dsw-alias-bg-base) 75%,transparent);backdrop-filter:blur(4px)}.n4j .dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:1}.n4j .dialog-header h2{margin:0;font-size:17px}.n4j .dialog-header button{width:32px;height:32px;padding:0;font-size:22px}.n4j .generator-body{padding:0 20px 20px}.n4j .generator-body>.card{padding:12px 0;border:0;background:transparent;border-radius:0}.n4j .generator-body>details.card{border-top:1px solid var(--dsw-alias-border-l1);margin-top:0}.n4j .generator-body label{margin-top:12px}.n4j .generator-body .primary{margin-top:4px}@media(max-width:900px){.n4j .result-layout.has-details{grid-template-columns:minmax(0,1fr) 220px}}@media(max-width:650px){.n4j .result-layout.has-details{grid-template-columns:1fr}.n4j .result-layout>.inspector{max-height:320px;border-left:0;border-top:2px solid var(--dsw-alias-border-l2)}.n4j .query-editor{gap:6px}.n4j .query-editor:before{display:none}.n4j .query-editor>.primary{padding:7px}}`;
        const interactionCss = `.n4j .edge-halo{opacity:0;transition:opacity .1s ease}.n4j .graph-edge:hover .edge-halo,.n4j .graph-edge:focus-visible .edge-halo{opacity:.26}.n4j .graph-edge.selected .edge-halo{opacity:.18}.n4j .result-layout.is-fullscreen{position:fixed;inset:12px;z-index:1000;width:auto;height:auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,280px);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 100vmax color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent)}.n4j .result-layout.is-fullscreen>div{min-height:0;height:100%}.n4j .result-layout.is-fullscreen .graph-stage{height:100%;min-height:0}.n4j .result-layout.is-fullscreen>.inspector{height:100%;max-height:none;border-top:0;border-left:2px solid var(--dsw-alias-border-l2)}.n4j .generation-menu{position:fixed;inset:auto;margin:0;width:min(380px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);font:13px/1.5 system-ui,sans-serif}.n4j .generation-menu::backdrop{background:transparent}.n4j .menu-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.n4j .menu-heading button{width:25px;height:25px;font-size:18px;padding:0;border:0;background:transparent}.n4j .generation-menu>label{font-size:0;margin-bottom:10px}.n4j .generation-menu textarea{font-size:13px;min-height:90px;max-height:240px}.n4j .generation-menu .error{font-size:12px;margin:8px 0}.n4j .generation-menu .primary{padding:6px 11px}`;
        const sidebarCss = `.n4j .grid.no-metadata{grid-template-columns:minmax(0,1fr)}.n4j.sidebar-page{padding:10px;min-width:0;height:100%}.n4j.sidebar-page h1{font-size:16px}.n4j.sidebar-page .query-editor label{min-width:0}.n4j.compact-sidebar .grid{grid-template-columns:minmax(0,1fr)}.n4j.compact-sidebar .database-info{position:static;max-height:280px}.n4j.compact-sidebar .query-editor{gap:6px}.n4j.compact-sidebar .query-editor:before{display:none}.n4j.compact-sidebar .query-editor>.primary{padding:7px 9px}.n4j.compact-sidebar .result-layout.has-details:not(.is-fullscreen){grid-template-columns:minmax(0,1fr)}.n4j.compact-sidebar .result-layout:not(.is-fullscreen)>.inspector{max-height:260px;border-left:0;border-top:2px solid var(--dsw-alias-border-l2)}.n4j.compact-sidebar .graph-stage{height:480px;min-height:320px}.n4j.compact-sidebar .result-layout.is-fullscreen .graph-stage{height:100%;min-height:0}.n4j.sidebar-page .graph-hint{right:52px;line-height:1.4}.n4j.sidebar-page .fields{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}`;
        const pretty = value => JSON.stringify(value, null, 2);
        async function api(action, input = {}, signal) {
          if(action==='generate'){
            const running=await api('status',{},signal);
            if(running.version!==CLIENT_VERSION)throw new Error(t('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.'));
          }
          const response = await fetch('api/neo4j-browser', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,...input}), signal });
          const data = await response.json();
          if(data.error?.message==='The model did not finish a complete query.')throw new Error(t('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.'));
          if (!response.ok || data.ok === false) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Request failed (${response.status})`),{code:data.error?.code,position:data.error?.position});
          const value = data.value ?? data.result ?? data;
          if (value.nodes || value.edges) value.graph = { nodes:(value.nodes||[]).map(n=>({...n,id:n.id??n.elementId})), edges:(value.edges||[]).map(e=>({...e,id:e.id??e.elementId})) };
          if (action === 'config') return {prompt:value.prompt,provider:value.provider,model:value.model};
          return value;
        }
        function Icon({size=20}) { return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},h('path',{d:'M6 6L19 10L10 19Z'}),...[ [6,6],[19,10],[10,19] ].map(([cx,cy],i)=>h('circle',{key:i,cx,cy,r:3,fill:'var(--dsw-alias-bg-layer-1)'}))); }
        const core = createNeo4jGraphCore();
        function Graph({graph,revision,selected,onSelect,onExpand,busy,expanded,onExpandedChange,active=true,inspectorId,expandedNodes}) {
          const svg=useRef(null),stage=useRef(null),drag=useRef(null),positionsRef=useRef({}),fixed=useRef({}),engine=useRef(null),lastRevision=useRef(null),sizeRef=useRef({width:900,height:650});
          const cameraManual=useRef(false),measured=useRef(false),motion=useRef(null),zoomReference=useRef(null);
          const [positions,setPositions]=useState({}),[camera,setCamera]=useState({x:450,y:325,z:1}),[size,setSize]=useState(sizeRef.current);

          const nodes=graph?.nodes||[],edges=graph?.edges||[];
          const publish=next=>{positionsRef.current=next;setPositions(next);};
          if(!motion.current)motion.current=createDragTicker({request:callback=>requestAnimationFrame(callback),cancel:frame=>cancelAnimationFrame(frame),step:()=>{
            const gesture=drag.current;if(!gesture||gesture.id===null||!gesture.moved||!engine.current)return false;
            engine.current.step(fixed.current);publish(engine.current.snapshot());return true;
          }});
          function stopMotion() {
            motion.current.stop();const gesture=drag.current;drag.current=null;fixed.current={};engine.current=null;
            if(gesture?.capture.hasPointerCapture(gesture.pointerId))gesture.capture.releasePointerCapture(gesture.pointerId);
          }
          useEffect(()=>{
            const hidden=()=>{if(document.hidden)stopMotion();};window.addEventListener('blur',stopMotion);document.addEventListener('visibilitychange',hidden);
            return()=>{window.removeEventListener('blur',stopMotion);document.removeEventListener('visibilitychange',hidden);stopMotion();};
          },[]);
          useEffect(()=>{
            const observer=new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width<1||height<1)return;const old=sizeRef.current,next={width,height},first=!measured.current;setCamera(c=>{if(first&&!cameraManual.current){const nextCamera=core.initialCamera(positionsRef.current,next);zoomReference.current={count:Object.keys(positionsRef.current).length,z:nextCamera.z};return nextCamera;}return {...c,x:c.x+(width-old.width)/2,y:c.y+(height-old.height)/2};});measured.current=true;sizeRef.current=next;setSize(next);});
            observer.observe(stage.current);return()=>observer.disconnect();
          },[]);
          React.useLayoutEffect(()=>{
            stopMotion();if(!active)return;
            const fresh=lastRevision.current!==revision;lastRevision.current=revision;
            const previous=fresh?{}:positionsRef.current;
            const beforeCount=Object.keys(previous).length,afterCount=nodes.length;
            const added=nodes.some(node=>!Object.hasOwn(previous,node.id));
            const initial=core.staticLayout(nodes,edges,previous);publish(initial);
            if(fresh){
              cameraManual.current=false;
              const box=stage.current.getBoundingClientRect();if(box.width>0&&box.height>0){sizeRef.current={width:box.width,height:box.height};measured.current=true;setSize(sizeRef.current);}
              const nextCamera=core.initialCamera(initial,sizeRef.current);zoomReference.current={count:afterCount,z:nextCamera.z};setCamera(nextCamera);
            }
            else if(added&&afterCount>beforeCount)setCamera(current=>core.expansionCamera(current,sizeRef.current,beforeCount,afterCount,zoomReference.current||undefined));
            // No simulation steps or animation frames run for loading/expansion.
            return stopMotion;
          },[graph,revision,active]);
          const point=e=>{const rect=svg.current.getBoundingClientRect();return {x:(e.clientX-rect.left)*sizeRef.current.width/rect.width,y:(e.clientY-rect.top)*sizeRef.current.height/rect.height};};
          const begin=(e,id=null)=>{if(!active||drag.current||e.button!==0)return;cameraManual.current=true;e.preventDefault();e.stopPropagation();svg.current.focus();const capture=e.currentTarget;capture.setPointerCapture(e.pointerId);drag.current={id,capture,pointerId:e.pointerId,start:point(e),camera:{...camera},position:positionsRef.current[id],moved:false};};
          const move=e=>{
            const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;
            const p=point(e),dx=p.x-d.start.x,dy=p.y-d.start.y;
            if(!d.moved&&Math.hypot(dx,dy)<=3)return;d.moved=true;
            if(d.id!==null&&d.position){
              if(!engine.current)engine.current=core.simulation(nodes,edges,positionsRef.current);
              fixed.current[d.id]={x:d.position.x+dx/d.camera.z,y:d.position.y+dy/d.camera.z};
              engine.current.step(fixed.current);publish(engine.current.snapshot());motion.current.start();
            }else setCamera({...d.camera,x:d.camera.x+dx,y:d.camera.y+dy});
          };
          const end=e=>{const d=drag.current;if(!d||d.pointerId!==e.pointerId)return;stopMotion();if(d.id!==null){const node=nodes.find(n=>n.id===d.id);if(node&&!d.moved)onSelect({...node,kind:'node'});}else if(!d.moved)onSelect(null);};
          const zoom=(factor,anchor={x:size.width/2,y:size.height/2})=>{cameraManual.current=true;setCamera(c=>{const next=core.zoomCamera(c,anchor,factor);zoomReference.current={count:Object.keys(positionsRef.current).length,z:next.z};return next;});};
          const resetZoom=()=>{cameraManual.current=true;setCamera(c=>{const next=core.zoomCamera(c,{x:sizeRef.current.width/2,y:sizeRef.current.height/2},1/c.z);zoomReference.current={count:Object.keys(positionsRef.current).length,z:next.z};return next;});};
          useEffect(()=>{const element=svg.current;if(!element)return;const wheel=e=>{cameraManual.current=true;e.preventDefault();if(e.ctrlKey||e.metaKey)zoom(Math.exp(-e.deltaY*.008),point(e));else setCamera(c=>({...c,x:c.x-e.deltaX,y:c.y-e.deltaY}));};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[size]);
          const measure=useMemo(()=>{const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(context)context.font='500 13px system-ui';return value=>context?context.measureText(value).width:Array.from(value).length*8;},[]);
          const markerId=React.useId().replace(/:/g,'');
          const toolbarButton=(label,icon,action)=>h('button',{type:'button','aria-label':t(label),title:t(label),onClick:action},icon);
          const keyboard=e=>{if(e.target!==e.currentTarget)return;const deltas={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};if(deltas[e.key]){cameraManual.current=true;e.preventDefault();const [x,y]=deltas[e.key];setCamera(c=>({...c,x:c.x+x,y:c.y+y}));}if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.2);}if(e.key==='-'){e.preventDefault();zoom(1/1.2);}if(e.key==='0'){e.preventDefault();resetZoom();}};
          const edgeIndex=new Map();
          const renderedEdges=edges.map(edge=>{const a=positions[edge.source],b=positions[edge.target];if(!a||!b)return null;const key=JSON.stringify([edge.source,edge.target].sort()),index=edgeIndex.get(key)||0;edgeIndex.set(key,index+1);const offset=index===0?0:(index%2?1:-1)*Math.ceil(index/2);const route=core.edgeRoute(a,b,offset),active=selected?.kind==='relationship'&&selected.id===edge.id;
            return h('g',{key:edge.id,className:`graph-edge${active?' selected':''}`,tabIndex:0,role:'button','aria-label':edge.type,onPointerDown:e=>e.stopPropagation(),onClick:e=>{e.stopPropagation();onSelect({...edge,kind:'relationship'});},onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect({...edge,kind:'relationship'});}}},h('title',null,edge.type),h('path',{className:'edge-halo',d:route.d,fill:'none',stroke:'var(--dsw-alias-brand-primary)',strokeWidth:22,strokeLinecap:'round',vectorEffect:'non-scaling-stroke',pointerEvents:'stroke'}),h('path',{d:route.d,fill:'none',stroke:active?'var(--dsw-alias-brand-primary)':'var(--dsw-alias-label-secondary)',strokeWidth:active?3:1.7,markerEnd:`url(#${markerId})`,pointerEvents:'none'}),(camera.z>.4||active)&&route.available>35&&h('text',{className:'edge-caption',transform:`translate(${route.x} ${route.y}) rotate(${route.angle})`,dy:-6,textAnchor:'middle',fontSize:12,pointerEvents:'none'},core.ellipsis(edge.type,Math.min(180,route.available),measure)));
          });
          const renderedNodes=nodes.map(node=>{const p=positions[node.id];if(!p)return null;const caption=core.caption(node),color=labelColor(node.labels?.[0]),active=selected?.kind==='node'&&selected.id===node.id;
            const select=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(e.key==='Enter'&&e.shiftKey&&!busy)onExpand(node.id);else onSelect({...node,kind:'node'});}};
            return h('g',{key:node.id,className:`graph-node${active?' selected':''}`,transform:`translate(${p.x} ${p.y})`,tabIndex:0,role:'button','aria-label':caption,'aria-pressed':active,'aria-expanded':Boolean(expandedNodes?.has(node.id)),'aria-describedby':active?inspectorId:undefined,onPointerDown:e=>begin(e,node.id),onDoubleClick:e=>{e.stopPropagation();if(!busy)onExpand(node.id);},onKeyDown:select,'aria-keyshortcuts':'Shift+Enter'},h('title',null,caption+'\n'+t(expandedNodes?.has(node.id)?'Double-click to hide added neighbors.':'Double-click a node to load its relationships.')),h('circle',{className:'node-halo',r:core.radius+7,fill:'none',stroke:color,strokeWidth:9}),active&&h('circle',{className:'selected-shape',r:core.radius+13,fill:'none',stroke:'var(--dsw-alias-brand-primary)',strokeWidth:3,strokeDasharray:'7 4',vectorEffect:'non-scaling-stroke'}),h('circle',{className:'node-body',r:core.radius,fill:`color-mix(in srgb, ${color} 72%, var(--dsw-alias-bg-layer-1))`,stroke:color,strokeWidth:2.5}),h('text',{textAnchor:'middle',dy:4.5,fontSize:13,fontWeight:500,fill:'var(--dsw-alias-label-primary)',pointerEvents:'none'},core.ellipsis(caption,core.radius*2-14,measure)));
          });
          return h('div',{ref:stage,className:'graph-stage'},h('svg',{ref:svg,className:'canvas',viewBox:`0 0 ${size.width} ${size.height}`,tabIndex:0,role:'group','aria-label':t('Graph browser'),onKeyDown:keyboard,onPointerDown:e=>begin(e),onPointerMove:move,onPointerUp:end,onPointerCancel:stopMotion,onLostPointerCapture:stopMotion},h('defs',null,h('marker',{id:markerId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto'},h('path',{d:'M 0 1 L 9 5 L 0 9 z',fill:'var(--dsw-alias-label-secondary)'}))),h('g',{transform:`translate(${camera.x} ${camera.y}) scale(${camera.z})`},...renderedEdges,...renderedNodes)),
            !nodes.length&&h('p',{className:'graph-empty'},t('No graph entities in these results. Use RETURN n, r, m to visualize nodes and relationships.')),
            h('div',{className:'graph-hud'},
              h('div',{className:'graph-status',title:`${nodes.length} nodes · ${edges.length} relationships`},`${nodes.length} nodes · ${edges.length} relationships`),
              selected&&h('div',{className:'selection-caption',title:describeEntity(selected).title},t('Inspecting'),': ',describeEntity(selected).title)),
            h('div',{className:'graph-tools'},toolbarButton(expanded?'Restore graph':'Expand graph',expanded?'↙':'⛶',()=>onExpandedChange(!expanded)),toolbarButton('Zoom in','+',()=>zoom(1.2)),toolbarButton('Zoom out','−',()=>zoom(1/1.2)),toolbarButton('Fit to screen','⊡',()=>{cameraManual.current=true;const next=core.fitCamera(positionsRef.current,sizeRef.current);zoomReference.current={count:Object.keys(positionsRef.current).length,z:next.z};setCamera(next);}),toolbarButton('Reset zoom','1:1',resetZoom),toolbarButton('Center graph','⌖',()=>{cameraManual.current=true;setCamera(c=>core.centerCamera(positionsRef.current,sizeRef.current,c.z));})),
            h('div',{className:'graph-hint'},t('Drag to pan · Scroll to move · Ctrl/⌘ + scroll to zoom')));
        }
        function GeneratorMenu({onClose,anchorRef,children}) {
          const ref=useRef(null),closeRef=useRef(onClose);closeRef.current=onClose;
          useEffect(()=>{
            const element=ref.current,opener=anchorRef.current;
            const position=()=>{
              const anchor=opener.getBoundingClientRect(),box=element.getBoundingClientRect(),width=document.documentElement.clientWidth,height=document.documentElement.clientHeight;
              element.style.left=`${Math.max(8,Math.min(anchor.right-box.width,width-box.width-8))}px`;
              element.style.top=`${Math.max(8,Math.min(anchor.bottom+8,height-box.height-8))}px`;
            };
            const toggle=e=>{if(e.newState==='closed')closeRef.current();};
            element.addEventListener('toggle',toggle);element.showPopover();position();element.querySelector('textarea')?.focus();
            const observer=new ResizeObserver(position);observer.observe(element);
            window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
            return()=>{observer.disconnect();element.removeEventListener('toggle',toggle);window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);const restore=element.contains(document.activeElement);element.hidePopover();if(restore&&opener?.isConnected)opener.focus();};
          },[]);
          return h('div',{ref,popover:'auto',className:'generation-menu',role:'dialog','aria-label':t('Generate Cypher')},children);
        }
        const Panel=createWorkspacePanel(React,{t,api,core,Icon,Graph,GeneratorMenu,CypherEditor,stateCore,version:CLIENT_VERSION,styles:css+browserCss+graphCss+polishCss+interactionCss+sidebarCss+editorCss+workspaceCss,labelColor});
        function SidebarPanel({useTabInfo,sessionId}) {
          const {tab}=useTabInfo();
          return h(Panel,{sidebar:true,active:tab.visible,storageId:`sidebar:${sessionId}:${tab.id}`});
        }
        registerNeo4jSidebar(ctx,SidebarPanel,Icon,t);
        ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'neo4j-browser',order:40,label:()=>t('Neo4j Browser')},Icon));
        ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'neo4j-browser'},Panel));
      }
    };
  }
});
