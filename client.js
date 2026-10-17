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
    const box = bounds(points), z = fit ? clamp(Math.min((size.width-120)/box.width,(size.height-120)/box.height),.08,1) : 1;
    return {x:size.width/2-box.x*z,y:size.height/2-box.y*z,z};
  }
  function zoomCamera(camera, anchor, factor) {
    const z=clamp(camera.z*factor,.08,4),ratio=z/camera.z;
    return {x:anchor.x-(anchor.x-camera.x)*ratio,y:anchor.y-(anchor.y-camera.y)*ratio,z};
  }
  function simulation(nodes, edges, previous = {}) {
    const points = new Map(nodes.map((node,i)=>{
      const old=previous[node.id], a=i*2.399963229728653, r=separation*.63*Math.sqrt(i);
      return [node.id,{id:node.id,x:old?.x??Math.cos(a)*r,y:old?.y??Math.sin(a)*r,vx:0,vy:0}];
    }));
    const pairs=new Set(),links=[];
    for(const e of edges) {const a=points.get(e.source),b=points.get(e.target);if(!a||!b||a===b)continue;const key=JSON.stringify([a.id,b.id].sort());if(!pairs.has(key)){links.push([a,b]);pairs.add(key);}}
    // Seed expansion near its neighbors. Old nodes are warm-started, never frozen.
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
  return {radius,separation,caption,ellipsis,bounds,fitCamera,zoomCamera,simulation,edgeRoute};
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
      const entry={query:item.query,parameters,at:Number.isFinite(item.at)?item.at:0};
      const length=JSON.stringify(entry).length;if(length>65536||size+length>1000000)continue;
      size+=length;history.push(entry);
    }
    return {format:1,query:string(data.query,16000,defaultQuery),params:string(data.params,65536,'{}'),history,rowLimit:[25,50,100,200].includes(data.rowLimit)?data.rowLimit:25,question:string(data.question,4000),labels:string(data.labels,8000),tab:['Graph','Table','JSON'].includes(data.tab)?data.tab:'Graph'};
  }
  function key(scope,base) {return `neo4j-browser:editor:v1:${encodeURIComponent(scope||'default')}:${encodeURIComponent(base||'/')}`;}
  function load(storage,id) {try{return normalize(JSON.parse(storage.getItem(id)||'null'));}catch{return normalize(null);}}
  function save(storage,id,value) {try{storage.setItem(id,JSON.stringify(normalize(value)));return true;}catch{return false;}}
  function append(history,entry) {return normalize({history:[{...entry,at:Date.now()},...history]}).history;}
  return {normalize,key,load,save,append,defaultQuery};
}
window.__ModuleLoader__.load({
  id: '@local/neo4j-browser',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo } = React;
    const CLIENT_VERSION='1.5.1',stateCore=createNeo4jStateCore();
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const texts = ['Neo4j Browser','Connection','URI','Username','Password','Database','Connect','Disconnect','Connected','Not connected','Use a read-only database account. Credentials stay in Host memory until disconnect or restart.','Cypher','Parameters (JSON)','Run query','Allow writes for this run','Confirm write','Cancel','This query may change your database. Review the exact query before confirming.','Graph','Table','JSON','No results yet. Run a query to explore your graph.','No graph entities in these results. Use RETURN n, r, m to visualize nodes and relationships.','Query assistant','Question','Generate Cypher','Review generated Cypher before running it. Generation never executes a query.','Schema metadata and your question are sent to the selected LLM provider. No property values, credentials or chat history are included.','Schema','Refresh schema','Schema labels (comma-separated, optional)','Generation settings','System prompt','Provider (empty = Harness default)','Model (empty = Harness default)','Save settings','Settings saved','Loading…','Error','Properties','Expand neighbors','Zoom in','Zoom out','Fit graph','Rows','Results truncated','Context preview','History','No query history','Close','Read only','Write confirmation','Database connection is shared across this profile.','Selected','Clear selection','Retry','Limit','Connection settings','AI settings apply to this Host process.','Query completed','Graph browser','Show connection','Hide connection'];
        texts.push('Database Information','Node labels','Relationship types','Property keys','Overview','Use database','No metadata available','Select a node or relationship to inspect its properties.','Property','Value','Metadata may be incomplete. Refresh schema to retry.','Counts refer to the displayed graph, not the entire database.','Search metadata','All nodes','All relationships');
        texts.push('Expand graph','Restore graph','Actual size','Pin node','Unpin node','Drag to pan · Scroll to move · Ctrl/⌘ + scroll to zoom','Show details','Hide details','Row limit','Query options');
        texts.push('Double-click a node to load its relationships.','Shift+Enter','Prompt');
        texts.push('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.','Query text and parameters are stored locally in this browser. Passwords and query results are not stored.','Browser storage is unavailable. Query history will not survive closing this page.','Unknown','Schema cached');
        const labelColor = label => { const palette = ['--dsw-alias-brand-primary','--dsw-alias-state-success-primary','--dsw-alias-state-warn-primary','--dsw-alias-state-error-primary']; let hash = 0; for (const c of label || '') hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return `var(${palette[hash % palette.length]})`; };
        ctx.effect(() => ctx.locale.register('local.neo4j', 'en', Object.fromEntries(texts.map((s,i) => [`s${i}`,s]))));
        const translate = ctx.locale.bind('local.neo4j');
        const t = text => { const i = texts.indexOf(text); return i < 0 ? text : translate(`s${i}`); };
        const css = `.n4j{height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui;padding:24px;box-sizing:border-box}.n4j *{box-sizing:border-box}.n4j h1{font-size:21px;margin:0}.n4j h2{font-size:14px;margin:0 0 12px}.n4j p{margin:8px 0}.n4j .muted{color:var(--dsw-alias-label-secondary);font-size:12px}.n4j .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.n4j .spread{justify-content:space-between}.n4j .card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;background:var(--dsw-alias-bg-layer-1);margin-top:16px}.n4j .grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,340px);gap:16px}.n4j .fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.n4j label{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}.n4j input,.n4j textarea,.n4j select{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:8px;font:inherit}.n4j textarea{resize:vertical;min-height:64px}.n4j .code{font:12px/1.6 ui-monospace,monospace;tab-size:2}.n4j button{cursor:pointer;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:7px 11px;font:inherit}.n4j button:hover{border-color:var(--dsw-alias-brand-primary)}.n4j button:focus-visible,.n4j input:focus-visible,.n4j textarea:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.n4j button:disabled{opacity:.5;cursor:not-allowed}.n4j .primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}.n4j .error{color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}.n4j .success{color:var(--dsw-alias-state-success-primary)}.n4j .warn{color:var(--dsw-alias-state-warn-primary)}.n4j .check{display:flex;flex-direction:row;align-items:center;margin:0;gap:6px}.n4j .check input{width:auto}.n4j pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;max-height:360px;overflow:auto}.n4j .table{overflow:auto;max-height:450px}.n4j table{border-collapse:collapse;width:100%;font:12px ui-monospace,monospace}.n4j td,.n4j th{text-align:left;border-bottom:1px solid var(--dsw-alias-border-l1);padding:8px;max-width:340px;overflow-wrap:anywhere}.n4j th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2)}.n4j .canvas{height:440px;width:100%;touch-action:none;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}.n4j summary{cursor:pointer;font-weight:600}.n4j .tabs [aria-selected=true]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}.n4j .history{max-height:180px;overflow:auto}.n4j .history button{display:block;text-align:left;width:100%;margin:6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:1000px){.n4j .grid{grid-template-columns:1fr}}`;
        const browserCss = `.n4j{padding:16px}.n4j .grid{grid-template-columns:230px minmax(0,1fr)}.n4j .database-info{background:var(--dsw-alias-bg-layer-2);padding:18px;border-radius:10px;min-width:0;align-self:start;margin-top:16px}.n4j .database-info h2{font-size:18px}.n4j .meta-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:18px;margin-top:20px}.n4j .meta-section h3{font-size:13px;margin:0 0 12px}.n4j .chips{display:flex;gap:7px;flex-wrap:wrap}.n4j .chip{border-radius:18px;padding:4px 10px;font-size:12px;overflow-wrap:anywhere;max-width:100%;border-color:var(--n4j-color,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--n4j-color,var(--dsw-alias-bg-layer-2)) 16%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}.n4j .result-layout{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px;margin-top:12px}.n4j .inspector{background:var(--dsw-alias-bg-layer-2);padding:16px;border-radius:8px;min-width:0;max-height:600px;overflow:auto}.n4j .inspector h3{font-size:13px;margin:18px 0 10px}.n4j .workspace{min-width:0}.n4j .canvas{height:clamp(360px,55vh,760px)}.n4j .property-list{margin:12px 0}.n4j .property-list dt{color:var(--dsw-alias-label-secondary);font:12px ui-monospace,monospace;padding-top:10px}.n4j .property-list dd{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace}.n4j .assistant-area{display:grid;grid-template-columns:1fr 1fr;gap:14px}.n4j .assistant-area>div:first-child{grid-row:span 2}@media(max-width:1200px){.n4j .result-layout{grid-template-columns:minmax(0,1fr)}.n4j .inspector{max-height:300px}}@media(max-width:750px){.n4j .grid{grid-template-columns:1fr}.n4j .database-info{max-height:350px;overflow:auto}.n4j .assistant-area{grid-template-columns:1fr}}`;
        const graphCss = `.n4j{padding:12px}.n4j .grid{gap:12px;grid-template-columns:220px minmax(0,1fr)}.n4j .card{border-radius:5px;margin-top:12px;padding:12px}.n4j .database-info{border-radius:5px;position:sticky;top:0;max-height:calc(100vh - 100px);overflow:auto;padding:16px;margin-top:12px}.n4j .database-info h2{font-size:16px}.n4j .result-card{padding:0;overflow:hidden}.n4j .result-header{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}.n4j .result-header button{border:0;border-radius:3px;padding:6px 10px}.n4j .result-layout{display:block;position:relative;margin:0}.n4j .result-layout>.inspector{position:absolute;right:12px;top:12px;bottom:65px;width:220px;max-height:none;border:1px solid var(--dsw-alias-border-l1);border-radius:3px;background:var(--dsw-alias-bg-overlay);padding:14px;opacity:.96}.n4j .graph-stage{position:relative;width:100%;height:clamp(560px,76vh,1050px);overflow:hidden;background:var(--dsw-alias-bg-layer-1)}.n4j .graph-stage.is-expanded{position:fixed;inset:12px;width:auto;height:auto;z-index:1000;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;box-shadow:0 0 0 100vmax color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent)}.n4j .graph-stage .canvas{display:block;width:100%;height:100%;border:0;border-radius:0;background:var(--dsw-alias-bg-layer-1);cursor:grab;touch-action:none;user-select:none}.n4j .graph-stage .canvas:active{cursor:grabbing}.n4j .graph-node,.n4j .graph-edge{cursor:pointer;outline:none}.n4j .node-halo{opacity:0;pointer-events:none}.n4j .graph-node:hover .node-halo,.n4j .graph-node:focus-visible .node-halo{opacity:.22}.n4j .graph-node.selected .node-halo{stroke:var(--dsw-alias-state-warn-primary);opacity:.4}.n4j .edge-caption{fill:var(--dsw-alias-label-secondary);stroke:var(--dsw-alias-bg-layer-1);stroke-width:4;paint-order:stroke;stroke-linejoin:round}.n4j .graph-edge:focus-visible>path{stroke:var(--dsw-alias-brand-primary)}.n4j .graph-tools{position:absolute;bottom:42px;right:12px;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:3px;overflow:hidden}.n4j .has-details .graph-tools{right:246px}.n4j .has-details .is-expanded .graph-tools{right:12px}.n4j .graph-tools button{width:36px;height:36px;padding:0;font-size:21px;border:0;border-radius:0;background:transparent}.n4j .graph-tools button:last-child{font-size:12px}.n4j .graph-tools button:hover{background:var(--dsw-alias-bg-layer-2)}.n4j .graph-status{position:absolute;left:12px;top:12px;pointer-events:none;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);padding:4px 8px;border-radius:3px}.n4j .graph-hint{position:absolute;bottom:12px;left:12px;font-size:11px;color:var(--dsw-alias-label-secondary);pointer-events:none}.n4j .graph-empty{position:absolute;inset:40% 15% auto;text-align:center;color:var(--dsw-alias-label-secondary);pointer-events:none}.n4j .query-editor{display:flex;align-items:flex-start;gap:12px}.n4j .query-editor:before{content:'neo4j$';font:16px/1.6 ui-monospace,monospace;padding-top:7px;color:var(--dsw-alias-label-secondary)}.n4j .query-editor label{flex:1;font-size:0;margin:0}.n4j .query-editor textarea{font-size:14px;min-height:62px;border:0;background:var(--dsw-alias-bg-base)}.n4j .query-editor .primary{margin-top:8px}.n4j .query-options{margin-top:8px}.n4j .query-options summary{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}.n4j .query-options>label{margin-top:10px}.n4j .result-card>.table,.n4j .result-card>pre{padding:12px}.n4j .row-limit{display:flex;flex-direction:row;align-items:center;gap:8px;margin:0}.n4j .row-limit select{width:76px;padding:4px}.n4j .assistant-area{margin-top:12px}.n4j .chip{font-size:11px;padding:4px 9px}.n4j .inspector p{overflow-wrap:anywhere}.n4j .workspace{padding-bottom:16px}@media(max-width:750px){.n4j .grid{grid-template-columns:1fr}.n4j .database-info{position:static;max-height:260px}.n4j .has-details .graph-tools{right:211px}.n4j .result-layout>.inspector{width:185px;max-height:45%;bottom:auto}.n4j .graph-stage{height:70vh;min-height:480px}}`;
        const polishCss = `.n4j h1,.n4j h2,.n4j h3{font-family:system-ui,sans-serif;line-height:1.4}.n4j .grid{margin-top:12px;align-items:start}.n4j .grid>.database-info,.n4j .workspace>.card:first-child{margin-top:0}.n4j .query-editor{align-items:flex-start}.n4j .query-editor .generate-trigger{margin-top:8px;display:flex;align-items:center;justify-content:center;width:38px;min-width:38px;height:38px;padding:7px;color:var(--dsw-alias-brand-primary)}.n4j .query-editor>.primary{height:38px;white-space:nowrap}.n4j .result-layout.has-details{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:0;align-items:stretch}.n4j .result-layout>.inspector{position:static;inset:auto;width:auto;max-height:clamp(560px,76vh,1050px);border:0;border-left:2px solid var(--dsw-alias-border-l2);border-radius:0;background:var(--dsw-alias-bg-base);opacity:1;padding:0;box-shadow:-6px 0 16px color-mix(in srgb,var(--dsw-alias-bg-base) 35%,transparent)}.n4j .inspector>.bar{padding:16px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);position:sticky;top:0;z-index:1}.n4j .inspector h2{font-size:15px;margin:0}.n4j .inspector>p,.n4j .inspector>h3,.n4j .inspector>.chips{margin-left:16px;margin-right:16px}.n4j .inspector>p:first-of-type{font-size:11px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.n4j .property-list{margin:14px 0 0}.n4j .property-row{padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1)}.n4j .property-row:nth-child(odd){background:var(--dsw-alias-bg-layer-1)}.n4j .property-list dt{font-family:system-ui,sans-serif;font-weight:600;font-size:11px;letter-spacing:.025em;padding:0;color:var(--dsw-alias-label-secondary)}.n4j .property-list dd{margin-top:6px;color:var(--dsw-alias-label-primary);line-height:1.6}.n4j .result-layout.has-details .graph-tools{right:12px}.n4j .n4j-generator{margin:auto;width:min(660px,calc(100vw - 32px));max-height:85vh;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 20px 80px color-mix(in srgb,var(--dsw-alias-bg-base) 70%,transparent);font:13px/1.5 system-ui,sans-serif}.n4j .n4j-generator::backdrop{background:color-mix(in srgb,var(--dsw-alias-bg-base) 75%,transparent);backdrop-filter:blur(4px)}.n4j .dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:1}.n4j .dialog-header h2{margin:0;font-size:17px}.n4j .dialog-header button{width:32px;height:32px;padding:0;font-size:22px}.n4j .generator-body{padding:0 20px 20px}.n4j .generator-body>.card{padding:12px 0;border:0;background:transparent;border-radius:0}.n4j .generator-body>details.card{border-top:1px solid var(--dsw-alias-border-l1);margin-top:0}.n4j .generator-body label{margin-top:12px}.n4j .generator-body .primary{margin-top:4px}@media(max-width:900px){.n4j .result-layout.has-details{grid-template-columns:minmax(0,1fr) 220px}}@media(max-width:650px){.n4j .result-layout.has-details{grid-template-columns:1fr}.n4j .result-layout>.inspector{max-height:320px;border-left:0;border-top:2px solid var(--dsw-alias-border-l2)}.n4j .query-editor{gap:6px}.n4j .query-editor:before{display:none}.n4j .query-editor>.primary{padding:7px}}`;
        const interactionCss = `.n4j .edge-halo{opacity:0;transition:opacity .1s ease}.n4j .graph-edge:hover .edge-halo,.n4j .graph-edge:focus-visible .edge-halo{opacity:.26}.n4j .graph-edge.selected .edge-halo{opacity:.18}.n4j .result-layout.is-fullscreen{position:fixed;inset:12px;z-index:1000;width:auto;height:auto;display:grid;grid-template-columns:minmax(0,1fr) minmax(200px,280px);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-base);box-shadow:0 0 0 100vmax color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent)}.n4j .result-layout.is-fullscreen>div{min-height:0;height:100%}.n4j .result-layout.is-fullscreen .graph-stage{height:100%;min-height:0}.n4j .result-layout.is-fullscreen>.inspector{height:100%;max-height:none;border-top:0;border-left:2px solid var(--dsw-alias-border-l2)}.n4j .generation-menu{position:fixed;inset:auto;margin:0;width:min(380px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);font:13px/1.5 system-ui,sans-serif}.n4j .generation-menu::backdrop{background:transparent}.n4j .menu-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.n4j .menu-heading button{width:25px;height:25px;font-size:18px;padding:0;border:0;background:transparent}.n4j .generation-menu>label{font-size:0;margin-bottom:10px}.n4j .generation-menu textarea{font-size:13px;min-height:90px;max-height:240px}.n4j .generation-menu .error{font-size:12px;margin:8px 0}.n4j .generation-menu .primary{padding:6px 11px}`;
        const pretty = value => JSON.stringify(value, null, 2);
        async function api(action, input = {}, signal) {
          if(action==='generate'){
            const running=await api('status',{},signal);
            if(running.version!==CLIENT_VERSION)throw new Error(t('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.'));
          }
          const response = await fetch('api/neo4j-browser', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action,...input}), signal });
          const data = await response.json();
          if(data.error?.message==='The model did not finish a complete query.')throw new Error(t('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.'));
          if (!response.ok || data.ok === false) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || `Request failed (${response.status})`);
          const value = data.value ?? data.result ?? data;
          if (value.nodes || value.edges) value.graph = { nodes:(value.nodes||[]).map(n=>({...n,id:n.id??n.elementId})), edges:(value.edges||[]).map(e=>({...e,id:e.id??e.elementId})) };
          if (action === 'config') return {prompt:value.prompt,provider:value.provider,model:value.model};
          return value;
        }
        function Icon({size=20}) { return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},h('path',{d:'M6 6L19 10L10 19Z'}),...[ [6,6],[19,10],[10,19] ].map(([cx,cy],i)=>h('circle',{key:i,cx,cy,r:3,fill:'var(--dsw-alias-bg-layer-1)'}))); }
        const core = createNeo4jGraphCore();
        function Graph({graph,revision,selected,onSelect,onExpand,busy,expanded,onExpandedChange}) {
          const svg=useRef(null),stage=useRef(null),drag=useRef(null),positionsRef=useRef({}),fixed=useRef({}),engine=useRef(null),lastRevision=useRef(null),sizeRef=useRef({width:900,height:650});
          const [positions,setPositions]=useState({}),[camera,setCamera]=useState({x:450,y:325,z:1}),[size,setSize]=useState(sizeRef.current);

          const nodes=graph?.nodes||[],edges=graph?.edges||[];
          const publish=next=>{positionsRef.current=next;setPositions(next);};
          useEffect(()=>{
            const observer=new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;if(width<1||height<1)return;const old=sizeRef.current,next={width,height};setCamera(c=>({...c,x:c.x+(width-old.width)/2,y:c.y+(height-old.height)/2}));sizeRef.current=next;setSize(next);});
            observer.observe(stage.current);return()=>observer.disconnect();
          },[]);
          useEffect(()=>{
            if(!expanded)return;const close=e=>{if(e.key==='Escape')onExpandedChange(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
          },[expanded]);
          useEffect(()=>{
            const fresh=lastRevision.current!==revision;lastRevision.current=revision;
            const previous=fresh?{}:positionsRef.current;
            fixed.current={};drag.current=null;
            const simulation=core.simulation(nodes,edges,previous);engine.current=simulation;
            for(let i=0;i<(nodes.length>100?2:12);i++)simulation.step();
            const initial=simulation.snapshot();publish(initial);
            if(fresh)setCamera(core.fitCamera(initial,sizeRef.current,false));
            let frame,previousTime=0,disposed=false;
            const update=time=>{
              if(disposed)return;
              if(time-previousTime>=(drag.current?.id!=null?16:nodes.length>100?64:32)){
                previousTime=time;simulation.step(fixed.current);
                const next=simulation.snapshot(),old=positionsRef.current;
                if(drag.current||Object.entries(next).some(([id,p])=>!old[id]||Math.hypot(p.x-old[id].x,p.y-old[id].y)>.15))publish(next);
              }
              // Never freeze a settled graph: collisions and new drags are always processed.
              frame=requestAnimationFrame(update);
            };
            frame=requestAnimationFrame(update);return()=>{disposed=true;cancelAnimationFrame(frame);if(engine.current===simulation)engine.current=null;};
          },[graph,revision]);
          const point=e=>{const rect=svg.current.getBoundingClientRect();return {x:(e.clientX-rect.left)*sizeRef.current.width/rect.width,y:(e.clientY-rect.top)*sizeRef.current.height/rect.height};};
          const begin=(e,id=null)=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();svg.current.focus();const capture=e.currentTarget;capture.setPointerCapture(e.pointerId);if(id!==null)fixed.current[id]=positionsRef.current[id];drag.current={id,capture,start:point(e),camera:{...camera},position:positionsRef.current[id],moved:false};};
          const move=e=>{const d=drag.current;if(!d)return;const p=point(e),dx=p.x-d.start.x,dy=p.y-d.start.y;if(Math.hypot(dx,dy)>3)d.moved=true;if(d.id!==null&&d.position){const next={x:d.position.x+dx/d.camera.z,y:d.position.y+dy/d.camera.z};fixed.current[d.id]=next;if(engine.current){engine.current.step(fixed.current);publish(engine.current.snapshot());}}else setCamera({...d.camera,x:d.camera.x+dx,y:d.camera.y+dy});};
          const end=e=>{const d=drag.current;drag.current=null;if(d?.capture.hasPointerCapture(e.pointerId))d.capture.releasePointerCapture(e.pointerId);if(!d)return;if(d.id!==null){delete fixed.current[d.id];const node=nodes.find(n=>n.id===d.id);if(node&&!d.moved)onSelect({...node,kind:'node'});}else if(!d.moved)onSelect(null);};
          const zoom=(factor,anchor={x:size.width/2,y:size.height/2})=>setCamera(c=>core.zoomCamera(c,anchor,factor));
          useEffect(()=>{const element=svg.current;if(!element)return;const wheel=e=>{e.preventDefault();if(e.ctrlKey||e.metaKey)zoom(Math.exp(-e.deltaY*.008),point(e));else setCamera(c=>({...c,x:c.x-e.deltaX,y:c.y-e.deltaY}));};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[size]);
          const measure=useMemo(()=>{const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(context)context.font='500 13px system-ui';return value=>context?context.measureText(value).width:Array.from(value).length*8;},[]);
          const markerId=React.useId().replace(/:/g,'');
          const toolbarButton=(label,icon,action)=>h('button',{type:'button','aria-label':t(label),title:t(label),onClick:action},icon);
          const keyboard=e=>{if(e.target!==e.currentTarget)return;const deltas={ArrowLeft:[70,0],ArrowRight:[-70,0],ArrowUp:[0,70],ArrowDown:[0,-70]};if(deltas[e.key]){e.preventDefault();const [x,y]=deltas[e.key];setCamera(c=>({...c,x:c.x+x,y:c.y+y}));}if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.2);}if(e.key==='-'){e.preventDefault();zoom(1/1.2);}if(e.key==='0')setCamera(core.fitCamera(positionsRef.current,sizeRef.current,false));};
          const edgeIndex=new Map();
          const renderedEdges=edges.map(edge=>{const a=positions[edge.source],b=positions[edge.target];if(!a||!b)return null;const key=JSON.stringify([edge.source,edge.target].sort()),index=edgeIndex.get(key)||0;edgeIndex.set(key,index+1);const offset=index===0?0:(index%2?1:-1)*Math.ceil(index/2);const route=core.edgeRoute(a,b,offset),active=selected?.kind==='relationship'&&selected.id===edge.id;
            return h('g',{key:edge.id,className:`graph-edge${active?' selected':''}`,tabIndex:0,role:'button','aria-label':edge.type,onPointerDown:e=>e.stopPropagation(),onClick:e=>{e.stopPropagation();onSelect({...edge,kind:'relationship'});},onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect({...edge,kind:'relationship'});}}},h('title',null,edge.type),h('path',{className:'edge-halo',d:route.d,fill:'none',stroke:'var(--dsw-alias-brand-primary)',strokeWidth:22,strokeLinecap:'round',vectorEffect:'non-scaling-stroke',pointerEvents:'stroke'}),h('path',{d:route.d,fill:'none',stroke:active?'var(--dsw-alias-brand-primary)':'var(--dsw-alias-label-secondary)',strokeWidth:active?3:1.7,markerEnd:`url(#${markerId})`,pointerEvents:'none'}),(camera.z>.4||active)&&route.available>35&&h('text',{className:'edge-caption',transform:`translate(${route.x} ${route.y}) rotate(${route.angle})`,dy:-6,textAnchor:'middle',fontSize:12,pointerEvents:'none'},core.ellipsis(edge.type,Math.min(180,route.available),measure)));
          });
          const renderedNodes=nodes.map(node=>{const p=positions[node.id];if(!p)return null;const caption=core.caption(node),color=labelColor(node.labels?.[0]),active=selected?.kind==='node'&&selected.id===node.id;
            const select=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(e.key==='Enter'&&e.shiftKey&&!busy)onExpand(node.id);else onSelect({...node,kind:'node'});}};
            return h('g',{key:node.id,className:`graph-node${active?' selected':''}`,transform:`translate(${p.x} ${p.y})`,tabIndex:0,role:'button','aria-label':caption,onPointerDown:e=>begin(e,node.id),onDoubleClick:e=>{e.stopPropagation();if(!busy)onExpand(node.id);},onKeyDown:select,'aria-keyshortcuts':'Shift+Enter'},h('title',null,caption+'\n'+t('Double-click a node to load its relationships.')),h('circle',{className:'node-halo',r:core.radius+7,fill:'none',stroke:color,strokeWidth:9}),h('circle',{r:core.radius,fill:`color-mix(in srgb, ${color} 72%, var(--dsw-alias-bg-layer-1))`,stroke:color,strokeWidth:2.5}),h('text',{textAnchor:'middle',dy:4.5,fontSize:13,fontWeight:500,fill:'var(--dsw-alias-label-primary)',pointerEvents:'none'},core.ellipsis(caption,core.radius*2-14,measure)));
          });
          return h('div',{ref:stage,className:'graph-stage'},h('svg',{ref:svg,className:'canvas',viewBox:`0 0 ${size.width} ${size.height}`,tabIndex:0,role:'group','aria-label':t('Graph browser'),onKeyDown:keyboard,onPointerDown:e=>begin(e),onPointerMove:move,onPointerUp:end,onPointerCancel:()=>{fixed.current={};drag.current=null;},onLostPointerCapture:()=>{fixed.current={};drag.current=null;}},h('defs',null,h('marker',{id:markerId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto'},h('path',{d:'M 0 1 L 9 5 L 0 9 z',fill:'var(--dsw-alias-label-secondary)'}))),h('g',{transform:`translate(${camera.x} ${camera.y}) scale(${camera.z})`},...renderedEdges,...renderedNodes)),
            !nodes.length&&h('p',{className:'graph-empty'},t('No graph entities in these results. Use RETURN n, r, m to visualize nodes and relationships.')),
            h('div',{className:'graph-status'},`${nodes.length} nodes · ${edges.length} relationships`),
            h('div',{className:'graph-tools'},toolbarButton(expanded?'Restore graph':'Expand graph',expanded?'↙':'⛶',()=>onExpandedChange(!expanded)),toolbarButton('Zoom in','+',()=>zoom(1.2)),toolbarButton('Zoom out','−',()=>zoom(1/1.2)),toolbarButton('Fit graph','⊡',()=>setCamera(core.fitCamera(positionsRef.current,sizeRef.current))),toolbarButton('Actual size','1:1',()=>setCamera(core.fitCamera(positionsRef.current,sizeRef.current,false)))),
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
        function Panel() {
          const [status,setStatus]=useState({connected:false}), [connection,setConnection]=useState({uri:'neo4j://localhost:7687',username:'neo4j',password:'',database:'neo4j'});
          const [showConnection,setShowConnection]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
          const [query,setQuery]=useState('MATCH (n) OPTIONAL MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 25'),[params,setParams]=useState('{}'),[allowWrite,setAllowWrite]=useState(false),[confirm,setConfirm]=useState(null);
          const [result,setResult]=useState(null),[tab,setTab]=useState('Graph'),[selected,setSelected]=useState(null),[history,setHistory]=useState([]);
          const [question,setQuestion]=useState(''),[labels,setLabels]=useState(''),[schema,setSchema]=useState(null),[context,setContext]=useState(null),[config,setConfig]=useState({prompt:'',provider:'',model:''});
          const [metadataSearch,setMetadataSearch]=useState(''),[generationOpen,setGenerationOpen]=useState(false);
          const [rowLimit,setRowLimit]=useState(25),[graphRevision,setGraphRevision]=useState(0),[showDetails,setShowDetails]=useState(true),[expanded,setExpanded]=useState(false);
          const generationTrigger=useRef(null),persistedKey=useRef(null),draftRef=useRef(null);
          const [restored,setRestored]=useState(false),[storageWarning,setStorageWarning]=useState(false);
          draftRef.current={query,params,history,rowLimit,question,labels,tab};
          const browserStorage=()=>{try{return window.localStorage;}catch{return undefined;}};
          useEffect(()=>{
            if(!restored)return;
            const timer=setTimeout(()=>setStorageWarning(!stateCore.save(browserStorage(),persistedKey.current,draftRef.current)),180);
            return()=>clearTimeout(timer);
          },[restored,query,params,history,rowLimit,question,labels,tab]);
          useEffect(()=>{const flush=()=>{if(persistedKey.current)stateCore.save(browserStorage(),persistedKey.current,draftRef.current);};window.addEventListener('pagehide',flush);return()=>{window.removeEventListener('pagehide',flush);flush();};},[]);
          const controller=useRef(null);
          useEffect(()=>{
            if(!status.connected){setSchema(null);return;}
            if(status.schema){setSchema(status.schema);return;}
            const c=new AbortController();
            api('schema',{},c.signal).then(setSchema).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();
          },[status.connected,status.instanceId,status.connectionId,status.connection?.uri,status.connection?.username,status.connection?.database]);
          useEffect(()=>{
            const c=new AbortController();controller.current=c;
            api('status',{},c.signal).then(s=>{
              if(c.signal.aborted)return;
              persistedKey.current=stateCore.key(s.storageScope,new URL('api/neo4j-browser',document.baseURI).pathname);
              const saved=stateCore.load(browserStorage(),persistedKey.current);
              setQuery(saved.query);setParams(saved.params);setHistory(saved.history);setRowLimit(saved.rowLimit);setQuestion(saved.question);setLabels(saved.labels);setTab(saved.tab);
              setStatus(s);setRestored(true);if(s.config)setConfig(s.config);if(s.connected)setShowConnection(false);
            }).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
            return()=>{c.abort();controller.current?.abort();};
          },[]);
          async function act(action,input={},apply=()=>{}) {if(busy)return;const c=new AbortController();controller.current=c;setBusy(true);setError('');setNotice('');try{const value=await api(action,input,c.signal);apply(value);return value;}catch(e){setError(e.name==='AbortError'?'Request cancelled.':e.message);}finally{setBusy(false);}}
          const scope=()=>labels.split(',').map(x=>x.trim()).filter(Boolean);
          function parseParameters(){const p=JSON.parse(params);if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Parameters must be a JSON object.');return p;}
          function execute(confirmed=false){let parameters;try{parameters=parseParameters();}catch(e){setError(e.message);return;}if(allowWrite&&!confirmed){setConfirm({query,parameters});return;}const snapshot=confirmed?confirm:{query,parameters};setConfirm(null);setHistory(old=>stateCore.append(old,{query:snapshot.query,parameters:snapshot.parameters}));act('query',{...snapshot,limit:rowLimit,allowWrite:!!confirmed,...(confirmed?{confirmedQuery:snapshot.query}:{})},v=>{setResult(v);setGraphRevision(r=>r+1);setSelected(null);setAllowWrite(false);setNotice(t('Query completed'));});}
          function expand(id){act('expand',{elementId:id,limit:25},v=>{setResult(old=>{const a=old?.graph||{},b=v.graph||{};return {...v,graph:{nodes:[...new Map([...(a.nodes||[]),...(b.nodes||[])].map(n=>[n.id,n])).values()].slice(0,500),edges:[...new Map([...(a.edges||[]),...(b.edges||[])].map(n=>[n.id,n])).values()].slice(0,1000)}};});});}
          const button=(text,fn,disabled=false,cls='')=>h('button',{type:'button',onClick:fn,disabled:busy||disabled,className:cls},t(text));
          const field=(text,value,onChange,options={})=>h('label',null,t(text),h(options.multiline?'textarea':'input',{value,onChange:e=>onChange(e.target.value),disabled:busy||!restored,...Object.fromEntries(Object.entries(options).filter(([k])=>k!=='multiline'))}));
          const generationSettings=h('details',{className:'query-options',onToggle:e=>{if(e.currentTarget.open&&!config.prompt&&!busy)act('config',{},setConfig);}},h('summary',null,t('Generation settings')),h('p',{className:'muted'},t('AI settings apply to this Host process.')),h('p',{className:'muted'},t('Schema metadata and your question are sent to the selected LLM provider. No property values, credentials or chat history are included.')),field('Schema labels (comma-separated, optional)',labels,setLabels),field('Provider (empty = Harness default)',config.provider||'',value=>setConfig(c=>({...c,provider:value}))),field('Model (empty = Harness default)',config.model||'',value=>setConfig(c=>({...c,model:value}))),field('System prompt',config.prompt||'',value=>setConfig(c=>({...c,prompt:value})),{multiline:true,rows:6}),button('Save settings',()=>act('config',config,v=>{setConfig(v);setNotice(t('Settings saved'));})),h('p',{className:'muted'},t('Review generated Cypher before running it. Generation never executes a query.')));
          const rows=result?.rows||[],columns=result?.columns||[];
          const graphNodes=result?.graph?.nodes||[],graphEdges=result?.graph?.edges||[];
          const labelCounts=new Map(),typeCounts=new Map();
          for(const n of graphNodes)for(const label of n.labels||[])labelCounts.set(label,(labelCounts.get(label)||0)+1);
          for(const e of graphEdges)typeCounts.set(e.type,(typeCounts.get(e.type)||0)+1);
          const propertyNames=[...new Set([...(schema?.nodeProperties||[]),...(schema?.relationshipProperties||[])].map(p=>p.propertyName).filter(Boolean))].sort();
          const quoteIdentifier=value=>'`'+value.replaceAll('`','``')+'`';
          function browse(statement){setQuery(statement);setParams('{}');setAllowWrite(false);setConfirm(null);setTab('Graph');setHistory(old=>stateCore.append(old,{query:statement,parameters:{}}));act('query',{query:statement,parameters:{}},v=>{setResult(v);setGraphRevision(r=>r+1);setSelected(null);});}
          const chips=(items,onClick,counts)=>h('div',{className:'chips'},...items.map(name=>h('button',{key:name,type:'button',className:'chip',style:{'--n4j-color':labelColor(name)},disabled:busy||!status.connected,onClick:()=>onClick(name)},name,counts?.has(name)?` (${counts.get(name)})`:'')));
          const propertyList=properties=>h('dl',{className:'property-list'},...Object.entries(properties||{}).map(([key,value])=>h('div',{key,className:'property-row'},h('dt',null,key),h('dd',null,typeof value==='string'?value:pretty(value)))));
          const metadataSection=(title,items,onClick)=>h('section',{className:'meta-section'},h('h3',null,t(title)),chips(items.filter(name=>name.toLowerCase().includes(metadataSearch.toLowerCase())),onClick),!items.length&&h('p',{className:'muted'},t('No metadata available')));
          const overview=h('aside',{className:'inspector','aria-label':t(selected?'Properties':'Overview')},h('div',{className:'bar spread'},h('h2',null,t(selected?'Properties':'Overview'))),selected?h(React.Fragment,null,h('p',{className:'muted'},selected.kind,' · ',selected.id),chips(selected.labels||[selected.type].filter(Boolean),()=>{}),propertyList(selected.properties)):h(React.Fragment,null,h('h3',null,t('Node labels')),chips([...labelCounts.keys()],label=>browse(`MATCH (n:${quoteIdentifier(label)}) RETURN n LIMIT 25`),labelCounts),h('h3',null,t('Relationship types')),chips([...typeCounts.keys()],type=>browse(`MATCH (n)-[r:${quoteIdentifier(type)}]->(m) RETURN n,r,m LIMIT 25`),typeCounts),h('p',null,`${graphNodes.length} nodes, ${graphEdges.length} relationships`),h('p',{className:'muted'},t('Counts refer to the displayed graph, not the entire database.')),h('p',{className:'muted'},t('Select a node or relationship to inspect its properties.'))));
          const databaseInfo=h('aside',{className:'database-info','aria-label':t('Database Information')},h('h2',null,t('Database Information')),h('p',{className:'muted'},t('Use database')),h('strong',null,status.connection?.database||connection.database||'neo4j'),h('p',{className:'muted'},status.connection?.uri||t('Not connected')),field('Search metadata',metadataSearch,setMetadataSearch),button('Refresh schema',()=>act('schema',status.version===CLIENT_VERSION?{refresh:true}:{},setSchema),!status.connected),metadataSection('Node labels',schema?.labels||[],label=>browse(`MATCH (n:${quoteIdentifier(label)}) RETURN n LIMIT 25`)),button('All nodes',()=>browse('MATCH (n) RETURN n LIMIT 25'),!status.connected),metadataSection('Relationship types',schema?.relationshipTypes||[],type=>browse(`MATCH (n)-[r:${quoteIdentifier(type)}]->(m) RETURN n,r,m LIMIT 25`)),button('All relationships',()=>browse('MATCH (n)-[r]->(m) RETURN n,r,m LIMIT 25'),!status.connected),metadataSection('Property keys',propertyNames,key=>browse(`MATCH (n) WHERE n.${quoteIdentifier(key)} IS NOT NULL RETURN n LIMIT 25`)),schema?.omissions?.length>0&&h('details',{className:'meta-section'},h('summary',null,t('Metadata may be incomplete. Refresh schema to retry.')),h('ul',null,...schema.omissions.map((message,i)=>h('li',{key:i,className:'muted'},message)))));
          return h('section',{className:'n4j','aria-label':t('Neo4j Browser')},h('style',null,css+browserCss+graphCss+polishCss+interactionCss),
            h('div',{className:'bar spread'},h('div',{className:'bar'},h(Icon,{size:26}),h('h1',null,t('Neo4j Browser'))),h('div',{className:'bar'},h('span',{className:status.connected?'success':'muted'},t(status.connected?'Connected':'Not connected')),button(showConnection?'Hide connection':'Show connection',()=>setShowConnection(!showConnection)))),
            h('p',{className:'muted'},t('Database connection is shared across this profile.'),' · ',`UI ${CLIENT_VERSION} / Host ${status.version||t('Unknown')}`),
            restored&&status.version!==CLIENT_VERSION&&h('p',{className:'warn',role:'alert'},t('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.')),
            storageWarning&&h('p',{className:'warn',role:'alert'},t('Browser storage is unavailable. Query history will not survive closing this page.')),
            showConnection&&h('div',{className:'card'},h('h2',null,t('Connection')),h('div',{className:'fields'},...Object.keys(connection).map(key=>h(React.Fragment,{key},field({uri:'URI',username:'Username',password:'Password',database:'Database'}[key],connection[key],value=>setConnection(c=>({...c,[key]:value})),{type:key==='password'?'password':'text',autoComplete:key==='password'?'new-password':'off'})))),h('div',{className:'bar'},button('Connect',()=>act('connect',connection,v=>{setStatus({...v,connected:true});setConnection(c=>({...c,password:''}));setShowConnection(false);setResult(null);setSchema(null);}),false,'primary'),button('Disconnect',()=>act('disconnect',{},v=>{setStatus({...v,connected:false});setResult(null);setSchema(null);setSelected(null);setConnection(c=>({...c,password:''}));}),!status.connected)),h('p',{className:'muted'},t('Use a read-only database account. Credentials stay in Host memory until disconnect or restart.'))),
            h('div',{'aria-live':'polite'},busy&&h('p',null,t('Loading…'),' ',h('button',{onClick:()=>controller.current?.abort()},t('Cancel'))),notice&&h('p',{className:'success'},notice)),error&&h('p',{className:'error',role:'alert'},t('Error'),': ',error),
            h('div',{className:'grid'},databaseInfo,h('div',{className:'workspace'},
              h('div',{className:'card'},h('div',{className:'query-editor'},field('Cypher',query,setQuery,{multiline:true,rows:2,className:'code',spellCheck:false}),h('button',{ref:generationTrigger,type:'button',className:'generate-trigger','aria-label':t('Generate Cypher'),title:t('Generate Cypher'),disabled:busy,onClick:()=>{setError('');setGenerationOpen(true);}},h('svg',{width:21,height:21,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,'aria-hidden':true},h('path',{d:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3zM20 2v5M17.5 4.5h5'}))),button('Run query',()=>execute(),!status.connected||!query.trim(),'primary')),h('details',{className:'query-options'},h('summary',null,t('Query options')),field('Parameters (JSON)',params,setParams,{multiline:true,rows:2,className:'code',spellCheck:false}),h('div',{className:'bar spread'},h('label',{className:'check'},h('input',{type:'checkbox',checked:allowWrite,disabled:busy,onChange:e=>setAllowWrite(e.target.checked)}),t('Allow writes for this run')),h('label',{className:'row-limit'},t('Row limit'),h('select',{value:rowLimit,disabled:busy,onChange:e=>setRowLimit(Number(e.target.value))},...[25,50,100,200].map(value=>h('option',{key:value,value},value)))))),
                generationSettings,confirm&&h('div',{className:'card',role:'group','aria-label':t('Write confirmation')},h('p',{className:'warn'},t('This query may change your database. Review the exact query before confirming.')),h('pre',null,confirm.query),h('pre',null,pretty(confirm.parameters)),h('div',{className:'bar'},button('Confirm write',()=>execute(true)),button('Cancel',()=>setConfirm(null))))),
              h('div',{className:'card result-card'},h('div',{className:'bar spread result-header'},h('div',{className:'bar tabs',role:'tablist'},...['Graph','Table','JSON'].map(name=>h('button',{key:name,role:'tab','aria-selected':tab===name,onClick:()=>setTab(name)},t(name)))),h('div',{className:'bar'},result&&h('span',{className:'muted'},`${rows.length} ${t('Rows')}`),tab==='Graph'&&h('button',{type:'button',onClick:()=>setShowDetails(!showDetails),'aria-expanded':showDetails},t(showDetails?'Hide details':'Show details')))), result?.truncated&&h('p',{className:'warn'},t('Results truncated')),!result?h('p',{className:'muted'},t('No results yet. Run a query to explore your graph.')):tab==='Graph'?h('div',{className:`result-layout${showDetails||expanded?' has-details':''}${expanded?' is-fullscreen':''}`}, h('div',{style:{minWidth:0}},h(Graph,{graph:result.graph,revision:graphRevision,selected,onSelect:value=>{setSelected(value);if(value)setShowDetails(true);},onExpand:expand,busy,expanded,onExpandedChange:setExpanded})),(showDetails||expanded)&&overview):tab==='JSON'?h('pre',null,pretty(result)):h('div',{className:'table'},h('table',null,h('thead',null,h('tr',null,...columns.map(c=>h('th',{key:c},c)))),h('tbody',null,...rows.map((row,i)=>h('tr',{key:i},...columns.map((col,j)=>h('td',{key:col},JSON.stringify(Array.isArray(row)?row[j]:row[col]))))))))),
              selected&&tab!=='Graph'&&h('div',{className:'card'},overview),
              h('details',{className:'card'},h('summary',null,t('History')),h('p',{className:'muted'},t('Query text and parameters are stored locally in this browser. Passwords and query results are not stored.')),h('div',{className:'history'},history.length?history.map((entry,i)=>h('button',{key:i,onClick:()=>{setQuery(entry.query);setParams(pretty(entry.parameters));}},entry.query)):h('p',{className:'muted'},t('No query history')))),
              generationOpen&&h(GeneratorMenu,{anchorRef:generationTrigger,onClose:()=>{if(busy)controller.current?.abort();setGenerationOpen(false);}},
                 h('div',{className:'menu-heading'},h('strong',null,t('Prompt')),h('button',{type:'button','aria-label':t('Close'),onClick:()=>{if(busy)controller.current?.abort();setGenerationOpen(false);}},'×')),
                 field('Prompt',question,setQuestion,{multiline:true,rows:3}),
                 error&&h('p',{className:'error',role:'alert'},error),
                 h('div',{className:'bar spread'},busy?h('span',{'aria-live':'polite'},t('Loading…')):h('span',null),busy?h('button',{type:'button',onClick:()=>controller.current?.abort()},t('Cancel')):button('Generate Cypher',()=>act('generate',{question,labels:scope()},v=>{setQuery(v.cypher??v.query??'');setParams(pretty(v.parameters||{}));setContext(v);setAllowWrite(false);setConfirm(null);setGenerationOpen(false);}),!status.connected||!question.trim(),'primary'))))));
        }
        ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'neo4j-browser',order:40,label:()=>t('Neo4j Browser')},Icon));
        ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'neo4j-browser'},Panel));
      }
    };
  }
});
