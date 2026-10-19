import {createQueryRunner,describeEntity,executionLabel,historyPreview,resizeValue} from './workspace-core.js';
import {createGraphExpansionStore} from './graph-expansion.js';

export function createWorkspacePanel(React,{t,api,core,Icon,Graph,GeneratorMenu,CypherEditor,stateCore,version,styles,labelColor}) {
  const h=React.createElement,{useState,useEffect,useRef}=React;
  const pretty=value=>JSON.stringify(value,null,2);
  const quoteIdentifier=value=>'`'+value.replaceAll('`','``')+'`';
  const time=new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'});
  function ResizeHandle({axis='y',label,value,min,max,onChange,reverse=false}) {
    const drag=useRef(null);
    const finish=(event,cancel=false)=>{const start=drag.current;drag.current=null;if(!start)return;if(cancel)onChange(start.value);if(start.target.hasPointerCapture(start.pointerId))start.target.releasePointerCapture(start.pointerId);};
    return h('div',{className:`resize-handle ${axis}`,role:'separator',tabIndex:0,'aria-label':t(label),'aria-orientation':axis==='y'?'horizontal':'vertical','aria-valuenow':value,'aria-valuemin':min,'aria-valuemax':max,title:t(label),
      onPointerDown:event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={pointerId:event.pointerId,target:event.currentTarget,start:axis==='y'?event.clientY:event.clientX,value};},
      onPointerMove:event=>{const start=drag.current;if(!start)return;const position=axis==='y'?event.clientY:event.clientX;onChange(resizeValue(start.value,(position-start.start)*(reverse?-1:1),min,max));},
      onPointerUp:finish,onPointerCancel:event=>finish(event,true),onLostPointerCapture:()=>{drag.current=null;},
      onKeyDown:event=>{if(event.key==='Escape'){finish(event,true);return;}let delta=0;if(event.key==='Home'){event.preventDefault();onChange(min);return;}if(event.key==='End'){event.preventDefault();onChange(max);return;}if(event.key===(axis==='y'?'ArrowDown':'ArrowRight'))delta=event.shiftKey?50:10;if(event.key===(axis==='y'?'ArrowUp':'ArrowLeft'))delta=event.shiftKey?-50:-10;if(delta){event.preventDefault();onChange(resizeValue(value,delta*(reverse?-1:1),min,max));}},
    });
  }
  function tabsKey(event,names,current,choose) {
    let index=names.indexOf(current);
    if(event.key==='ArrowRight')index=(index+1)%names.length;else if(event.key==='ArrowLeft')index=(index+names.length-1)%names.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=names.length-1;else return;
    event.preventDefault();choose(names[index]);event.currentTarget.parentElement.querySelectorAll('[role=tab]')[index]?.focus();
  }
  return function Panel({sidebar=false,active=true,storageId=''}={}) {
    const [status,setStatus]=useState({connected:false}),[connection,setConnection]=useState({uri:'neo4j://localhost:7687',username:'neo4j',password:'',database:'neo4j'});
    const [busy,setBusy]=useState(false),[activity,setActivity]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const [query,setQuery]=useState(stateCore.defaultQuery),[params,setParams]=useState('{}'),[allowWrite,setAllowWrite]=useState(false),[confirm,setConfirm]=useState(null);
    const [expandedNodes,setExpandedNodes]=useState(()=>new Set());
    const [fullscreenQueryOpen,setFullscreenQueryOpen]=useState(false);
    const queryToggle=useRef(null);
    const [result,setResult]=useState(null),[tab,setTab]=useState('Graph'),[selected,setSelected]=useState(null),[history,setHistory]=useState([]);
    const [question,setQuestion]=useState(''),[labels,setLabels]=useState(''),[schema,setSchema]=useState(null),[config,setConfig]=useState({prompt:'',provider:'',model:''});
    const [metadataSearch,setMetadataSearch]=useState(''),[generationOpen,setGenerationOpen]=useState(false),[rowLimit,setRowLimit]=useState(25),[graphRevision,setGraphRevision]=useState(0),[expanded,setExpanded]=useState(false);
    const [layout,setLayout]=useState(()=>stateCore.normalize({}).layout),[runState,setRunState]=useState({status:'idle'}),[diagnostic,setDiagnostic]=useState(null);
    const [panelWidth,setPanelWidth]=useState(600),[restored,setRestored]=useState(false),[storageWarning,setStorageWarning]=useState(false);
    const [databases,setDatabases]=useState([]),[customDatabase,setCustomDatabase]=useState(null),[databaseHint,setDatabaseHint]=useState('');
    const generationTrigger=useRef(null),persistedKey=useRef(null),draftRef=useRef(null),panelRoot=useRef(null),editorActions=useRef(null),controller=useRef(null),busyRef=useRef(false),activityRef=useRef(''),alive=useRef(true),historyRef=useRef(history),runner=useRef(null);
    const inspectorId='n4j-inspector-'+React.useId().replace(/:/g,'');
    const editorId='n4j-query-'+React.useId().replace(/:/g,'');
    function changeExpanded(value) {setExpanded(value);setFullscreenQueryOpen(false);if(activityRef.current==='generate')controller.current?.abort();setGenerationOpen(false);}
    function toggleFullscreenQuery() {
      if(fullscreenQueryOpen){if(activityRef.current==='generate')controller.current?.abort();setGenerationOpen(false);queryToggle.current?.focus();}
      setFullscreenQueryOpen(value=>!value);
    }
    const statusRef=useRef(status),resultConnection=useRef(null),expansions=useRef(null);
    if(!expansions.current)expansions.current=createGraphExpansionStore();
    function adoptStatus(value) {
      const previous=statusRef.current;
      if(previous.instanceId===value.instanceId&&Number.isFinite(previous.connectionRevision)&&Number.isFinite(value.connectionRevision)&&value.connectionRevision<previous.connectionRevision)return;
      if(previous.connectionId&&previous.connectionId!==value.connectionId){resultConnection.current=null;expansions.current.reset();setExpandedNodes(new Set());setResult(null);setSelected(null);setSchema(null);setConfirm(null);setAllowWrite(false);setDiagnostic(null);setRunState({status:'idle'});}
      statusRef.current=value;setStatus(value);
    }
    const setPreference=(key,value)=>setLayout(old=>({...old,[key]:value}));
    const showDetails=layout.showDetails,showMetadata=layout.showMetadata,showConnection=layout.showConnection;
    const setShowDetails=value=>setPreference('showDetails',value);
    const browserStorage=()=>{try{return window.localStorage;}catch{return undefined;}};
    draftRef.current={query,params,history:historyRef.current,rowLimit,question,labels,tab,layout};
    function writeHistory(entries) {
      historyRef.current=entries;if(draftRef.current)draftRef.current={...draftRef.current,history:entries};
      if(alive.current)setHistory(entries);
      if(persistedKey.current&&!stateCore.save(browserStorage(),persistedKey.current,draftRef.current)&&alive.current)setStorageWarning(true);
    }
    if(!runner.current)runner.current=createQueryRunner({
      execute:(snapshot,write,signal)=>api('query',{...snapshot,allowWrite:write,...(write?{confirmedQuery:snapshot.query}:{})},signal),
      onChange:state=>{
        if(state.status==='running') {
          busyRef.current=true;activityRef.current='query';
          writeHistory(stateCore.append(historyRef.current,{id:state.id,query:state.snapshot.query,parameters:state.snapshot.parameters,at:state.at,status:'running'}));
        } else {busyRef.current=false;activityRef.current='';}
        if(alive.current){setRunState(state);setBusy(state.status==='running');setActivity(state.status==='running'?'query':'');}
      },
      onResult:(value,info)=>{if(!alive.current)return;if(info.snapshot.expectedConnectionId!==statusRef.current.connectionId){setError('The shared database connection changed. Run again in the selected database.');return;}resultConnection.current=info.snapshot.expectedConnectionId;const graph=expansions.current.reset(value.graph);setExpandedNodes(new Set());setResult({...value,graph});setGraphRevision(revision=>revision+1);setSelected(null);},
      onFinish:state=>{
        writeHistory(historyRef.current.map(entry=>entry.id===state.id?{...entry,status:state.status,durationMs:state.durationMs,rows:state.rows}:entry));
        if(!alive.current)return;
        setAllowWrite(false);
        if(state.status==='failed')setDiagnostic({query:state.snapshot.query,message:state.error?.message||t('Failed'),...(state.error?.position||{})});
        if(state.status==='cancelled'&&state.write)setNotice(t('Query cancelled. A write may already have committed; check database state before retrying.'));
        if(state.error?.code==='STALE_CONNECTION')setError(state.error.message);
        if(state.write||state.error?.code==='STALE_CONNECTION')api('status').then(value=>{if(alive.current)adoptStatus(value);}).catch(()=>{});
      },
    });
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;runner.current.cancel();controller.current?.abort();};},[]);
    useEffect(()=>{if(!active)changeExpanded(false);},[active]);
    React.useLayoutEffect(()=>{if(expanded&&fullscreenQueryOpen)editorActions.current?.focus();},[expanded,fullscreenQueryOpen]);
    useEffect(()=>{
      if(!expanded||!active)return;
      const close=event=>{if(event.key!=='Escape'||event.defaultPrevented||generationOpen)return;if(event.target?.closest?.('input,textarea,.cm-editor,[popover],details[open]'))return;changeExpanded(false);};
      window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
    },[expanded,active,generationOpen]);
    useEffect(()=>{const observer=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width>0)setPanelWidth(width);});observer.observe(panelRoot.current);return()=>observer.disconnect();},[]);
    useEffect(()=>{if(!restored||!persistedKey.current)return;const timer=setTimeout(()=>setStorageWarning(!stateCore.save(browserStorage(),persistedKey.current,draftRef.current)),180);return()=>clearTimeout(timer);},[restored,query,params,history,rowLimit,question,labels,tab,layout]);
    useEffect(()=>{const flush=()=>{if(persistedKey.current)stateCore.save(browserStorage(),persistedKey.current,draftRef.current);};window.addEventListener('pagehide',flush);return()=>{window.removeEventListener('pagehide',flush);flush();};},[]);
    useEffect(()=>{
      if(!status.connected){setSchema(null);return;}
      if(status.schema){setSchema(status.schema);return;}
      setSchema(null);const c=new AbortController();api('schema',{},c.signal).then(setSchema).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();
    },[status.connected,status.instanceId,status.connectionId,status.schemaCachedAt,status.connection?.uri,status.connection?.username,status.connection?.database]);
    useEffect(()=>{
      const c=new AbortController();api('status',{},c.signal).then(s=>{
        if(c.signal.aborted)return;
        const base=new URL('api/neo4j-browser',document.baseURI).pathname;
        persistedKey.current=stateCore.key(s.storageScope,base,storageId);
        const saved=stateCore.load(browserStorage(),persistedKey.current,storageId?stateCore.key(s.storageScope,base):undefined);
        setQuery(saved.query);setParams(saved.params);setHistory(saved.history);historyRef.current=saved.history;setRowLimit(saved.rowLimit);setQuestion(saved.question);setLabels(saved.labels);setTab(saved.tab);
        setLayout({...saved.layout,showConnection:saved.layout.showConnection||!s.connected});adoptStatus(s);setRestored(true);if(s.config)setConfig(s.config);
        if(s.connection)setConnection({...s.connection,database:s.connection.database??'',password:''});
      }).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();
    },[]);
    useEffect(()=>{if(!active||!restored)return;const c=new AbortController();api('status',{},c.signal).then(s=>{if(!c.signal.aborted)adoptStatus(s);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[active,restored]);
    useEffect(()=>{
      if(!status.connected){setDatabases([]);return;}
      const c=new AbortController();api('databases',{},c.signal).then(value=>{if(!c.signal.aborted){setDatabases(value.databases||[]);setDatabaseHint(value.truncated?t('Database list is truncated. Use Other database… for another name.'):'');}}).catch(e=>{if(e.name!=='AbortError')setDatabaseHint(t('Database list unavailable'));});return()=>c.abort();
    },[status.connected,status.connection?.uri,status.connection?.username]);
    async function act(action,input={},apply=()=>{}) {
      if(busyRef.current)return null;
      const c=new AbortController();controller.current=c;busyRef.current=true;activityRef.current=action;setBusy(true);setActivity(action);setError('');setNotice('');
      try{const value=await api(action,input,c.signal);if(!c.signal.aborted&&alive.current){apply(value);return value;}}
      catch(e){if(alive.current){setError(e.name==='AbortError'?t('Cancelled'):e.message);if(e.code==='STALE_CONNECTION')api('status').then(value=>{if(alive.current)adoptStatus(value);}).catch(()=>{});}}
      finally{if(controller.current===c){busyRef.current=false;activityRef.current='';if(alive.current){setBusy(false);setActivity('');}}}
      return null;
    }
    function execute(confirmed=false,snapshotOverride=null) {
      if(busyRef.current||!restored||!status.connected)return;
      if(status.version!==version){setError(t('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.'));return;}
      let parameters;try{parameters=snapshotOverride?.parameters??JSON.parse(params);if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw new Error('Parameters must be a JSON object.');}catch(e){setDiagnostic({query,message:e.message});return;}
      const candidate={...(snapshotOverride||{query,parameters}),expectedConnectionId:status.connectionId};if(!candidate.query.trim())return;
      if(!snapshotOverride&&allowWrite&&!confirmed){setConfirm(candidate);return;}
      const snapshot=confirmed?confirm:candidate;if(!snapshot)return;
      setConfirm(null);setError('');setNotice('');setDiagnostic(null);
      try{void runner.current.run({...snapshot,limit:rowLimit},!!confirmed);}catch{setDiagnostic({query:snapshot.query,message:'Query or parameters cannot be processed. Check input size and nesting.'});setRunState({status:'failed',durationMs:0});}
    }
    function loadHistory(entry) {if(busyRef.current)return;setQuery(entry.query);setParams(pretty(entry.parameters));setAllowWrite(false);setConfirm(null);setDiagnostic(null);if(expanded)setFullscreenQueryOpen(true);queueMicrotask(()=>editorActions.current?.focus());}
    function runAgain(entry) {if(busyRef.current)return;loadHistory(entry);execute(false,{query:entry.query,parameters:entry.parameters});}
    function browse(statement){setQuery(statement);setParams('{}');setAllowWrite(false);setConfirm(null);execute(false,{query:statement,parameters:{}});}
    function expand(id) {
      if(busyRef.current)return;
      const origin=resultConnection.current||status.connectionId;
      if(expansions.current.has(id)) {
        const graph=expansions.current.collapse(id);
        setExpandedNodes(expansions.current.expandedIds);setResult(old=>old?{...old,graph}:old);
        setSelected(current=>{
          if(!current)return current;
          const visible=current.kind==='relationship'?graph.edges.some(edge=>edge.id===current.id):graph.nodes.some(node=>node.id===current.id);
          return visible?current:graph.nodes.find(node=>node.id===id)?{...graph.nodes.find(node=>node.id===id),kind:'node'}:null;
        });
        return;
      }
      act('expand',{elementId:id,limit:25,expectedConnectionId:origin},value=>{
        if(resultConnection.current!==origin||statusRef.current.connectionId!==origin)return;
        const graph=expansions.current.add(id,{...value.graph,truncated:value.truncated});
        setExpandedNodes(expansions.current.expandedIds);setResult(old=>old?{...old,graph}:old);
      });
    }
    async function copy(text) {try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(text);setNotice(t('Copied'));}catch{setError(t('Clipboard is unavailable.'));}}
    function chooseDatabase(database) {act('use_database',{database},value=>{adoptStatus(value);setConnection(old=>({...old,database}));setSchema(null);setResult(null);setSelected(null);setDiagnostic(null);setRunState({status:'idle'});setCustomDatabase(null);setAllowWrite(false);setConfirm(null);});}
    const button=(text,onClick,disabled=false,className='')=>h('button',{type:'button',onClick,disabled:busy||disabled,className,title:t(text)},t(text));
    const iconButton=(text,icon,onClick,disabled=false)=>h('button',{type:'button',onClick,disabled:disabled||(busy&&text!=='Copy'),title:t(text),'aria-label':t(text)},icon);
    const field=(text,value,onChange,options={})=>h('label',null,t(text),h(options.multiline?'textarea':'input',{value,onChange:event=>onChange(event.target.value),disabled:busy||!restored,...Object.fromEntries(Object.entries(options).filter(([key])=>key!=='multiline'))}));
    const scope=()=>labels.split(',').map(value=>value.trim()).filter(Boolean);
    const openInspector=name=>setLayout(old=>({...old,showDetails:true,inspectorTab:name}));
    const select=value=>{setSelected(value);if(value)openInspector('Properties');};
    const menuAction=(label,fn,disabled=false)=>h('button',{type:'button',disabled:disabled||(busy&&label!=='Copy'),onClick:event=>{event.currentTarget.closest('details').open=false;fn();}},t(label));
    const rows=result?.rows||[],columns=result?.columns||[],graphNodes=result?.graph?.nodes||[],graphEdges=result?.graph?.edges||[];
    const labelCounts=new Map(),typeCounts=new Map();for(const node of graphNodes)for(const label of node.labels||[])labelCounts.set(label,(labelCounts.get(label)||0)+1);for(const edge of graphEdges)typeCounts.set(edge.type,(typeCounts.get(edge.type)||0)+1);
    const chips=(items,onClick,counts)=>h('div',{className:'chips'},...items.map(name=>h('button',{key:name,type:'button',className:'chip',style:{'--n4j-color':labelColor(name)},disabled:busy||!status.connected,onClick:()=>onClick(name)},name,counts?.has(name)?` (${counts.get(name)})`:'')));
    const propertyList=properties=>h('dl',{className:'property-list'},...Object.entries(properties||{}).filter(([key])=>!['id','uuid'].includes(key.toLowerCase())).map(([key,value])=>h('div',{key,className:'property-row'},h('dt',null,key),h('dd',null,typeof value==='string'?value:pretty(value)))));
    const entity=describeEntity(selected);
    const properties=selected?h(React.Fragment,null,h('div',{className:'entity-summary'},h('div',{className:'entity-title'},entity.title),...entity.identity.map(([key,value])=>h('div',{key,className:'entity-id',title:`${key}: ${value}`},`${key}: ${value}`)),h('div',{className:'entity-labels'},...(selected.labels||[selected.type].filter(Boolean)).map(label=>h('span',{key:label},label)))),propertyList(selected.properties)):h(React.Fragment,null,h('p',{className:'muted'},t('Select a node or relationship to inspect its properties.')),h('h3',null,t('Node labels')),chips([...labelCounts.keys()],label=>browse(`MATCH (n:${quoteIdentifier(label)}) RETURN n LIMIT 25`),labelCounts),h('h3',null,t('Relationship types')),chips([...typeCounts.keys()],type=>browse(`MATCH (n)-[r:${quoteIdentifier(type)}]->(m) RETURN n,r,m LIMIT 25`),typeCounts),h('p',{className:'muted'},t('Counts refer to the displayed graph, not the entire database.')));
    const historyView=h(React.Fragment,null,h('div',{className:'history-list'},history.length?history.map((entry,index)=>h('div',{className:'history-entry',key:entry.id||`${entry.at}:${index}`},h('div',{className:'history-line'},h('button',{type:'button',className:'history-load',title:entry.query,onClick:()=>loadHistory(entry),disabled:busy},historyPreview(entry.query)),h('span',{className:'history-meta',title:`${entry.status||''} · ${entry.at?new Date(entry.at).toLocaleString():''}`},Number.isFinite(entry.durationMs)?`${entry.durationMs} ms · `:'',entry.at?time.format(entry.at):''),h('div',{className:'history-actions'},iconButton('Run again','▶',()=>runAgain(entry),!status.connected),iconButton('Edit','✎',()=>loadHistory(entry)),iconButton('Copy','⧉',()=>copy(entry.query)))),h('details',{className:'history-full'},h('summary',{title:entry.query,'aria-label':t('Query')},'⌄'),h('pre',null,entry.query)))):h('p',{className:'muted'},t('No query history'))),h('p',{className:'history-note'},t('Query text and parameters are stored locally in this browser. Passwords and query results are not stored.')));
    const inspectorTabs=h('div',{className:'tabs bar',role:'tablist','aria-label':t('Properties')+' / '+t('History')},...['Properties','History'].map(name=>h('button',{key:name,type:'button',role:'tab','aria-selected':layout.inspectorTab===name,tabIndex:layout.inspectorTab===name?0:-1,onClick:()=>openInspector(name),onKeyDown:event=>tabsKey(event,['Properties','History'],layout.inspectorTab,openInspector)},t(name))));
    const inspector=h('aside',{id:inspectorId,className:'inspector','aria-label':t(layout.inspectorTab)},h('div',{className:'inspector-header'},inspectorTabs,!expanded&&h('button',{type:'button','aria-label':t('Close inspector'),title:t('Close inspector'),onClick:()=>setShowDetails(false)},'×')),h('div',{className:'inspector-body',role:'tabpanel','aria-label':t(layout.inspectorTab)},layout.inspectorTab==='History'?historyView:properties),!expanded&&h(ResizeHandle,{label:'Resize inspector',value:layout.inspectorHeight,min:160,max:1200,onChange:value=>setPreference('inspectorHeight',value)}));
    const metadataSection=(title,items,onClick)=>h('section',{className:'meta-section'},h('h3',null,t(title)),chips(items.filter(name=>name.toLowerCase().includes(metadataSearch.toLowerCase())),onClick),!items.length&&h('p',{className:'muted'},t('No metadata available')));
    const propertyNames=[...new Set([...(schema?.nodeProperties||[]),...(schema?.relationshipProperties||[])].map(property=>property.propertyName).filter(Boolean))].sort();
    const databaseInfo=h('aside',{className:'database-info','aria-label':t('Database Information')},h('h2',null,t('Database Information')),field('Search metadata',metadataSearch,setMetadataSearch),button('Refresh schema',()=>act('schema',status.version===version?{refresh:true}:{},setSchema),!status.connected),metadataSection('Node labels',schema?.labels||[],label=>browse(`MATCH (n:${quoteIdentifier(label)}) RETURN n LIMIT 25`)),button('All nodes',()=>browse('MATCH (n) RETURN n LIMIT 25'),!status.connected),metadataSection('Relationship types',schema?.relationshipTypes||[],type=>browse(`MATCH (n)-[r:${quoteIdentifier(type)}]->(m) RETURN n,r,m LIMIT 25`)),button('All relationships',()=>browse('MATCH (n)-[r]->(m) RETURN n,r,m LIMIT 25'),!status.connected),metadataSection('Property keys',propertyNames,key=>browse(`MATCH (n) WHERE n.${quoteIdentifier(key)} IS NOT NULL RETURN n LIMIT 25`)),schema?.omissions?.length>0&&h('details',null,h('summary',null,t('Metadata may be incomplete. Refresh schema to retry.')),h('ul',null,...schema.omissions.map((message,index)=>h('li',{key:index,className:'muted'},message)))));
    const generationSettings=h('details',{className:'query-options',open:layout.generationSettings,onToggle:event=>{const open=event.currentTarget.open;if(open!==layout.generationSettings)setPreference('generationSettings',open);if(open&&!config.prompt&&!busyRef.current)act('config',{},setConfig);}},h('summary',null,t('Generation settings')),h('p',{className:'muted'},t('AI settings apply to this Host process.')),h('p',{className:'muted'},t('Schema metadata and your question are sent to the selected LLM provider. No property values, credentials or chat history are included.')),field('Schema labels (comma-separated, optional)',labels,setLabels),field('Provider (empty = Harness default)',config.provider||'',value=>setConfig(old=>({...old,provider:value}))),field('Model (empty = Harness default)',config.model||'',value=>setConfig(old=>({...old,model:value}))),field('System prompt',config.prompt||'',value=>setConfig(old=>({...old,prompt:value})),{multiline:true,rows:6}),button('Save settings',()=>act('config',config,value=>{setConfig(value);setNotice(t('Settings saved'));})),h('p',{className:'muted'},t('Review generated Cypher before running it. Generation never executes a query.')));
    const currentDatabase=status.connection?.database??'';
    const databaseOptions=[...new Set(['',currentDatabase,...databases])];
    const errorForEditor=diagnostic?.query===query?diagnostic:null;
    const visibleInspector=showDetails||expanded;
    const compactMenu={className:'compact-menu',onBlur:event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;},onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}};
    const closeGeneration=()=>{if(activityRef.current==='generate')controller.current?.abort();setGenerationOpen(false);};
    return h('section',{ref:panelRoot,className:`n4j workstation${sidebar?' sidebar-page':''}${sidebar&&panelWidth<950?' compact-sidebar':''}${panelWidth-(showMetadata?240:0)<1000?' compact-workspace':''}`,'aria-label':t('Neo4j Browser')},h('style',null,styles),
      h('div',{className:'workspace-heading bar spread'},h('div',{className:'bar'},h(Icon,{size:20}),h('h1',null,t('Neo4j Browser'))),h('span',{className:'version-note',title:t('Database connection is shared across this profile.')},`UI ${version} / Host ${status.version||t('Unknown')}`)),
      restored&&status.version!==version&&h('p',{className:'warn',role:'alert'},t('Restart Harness, then refresh this page: the Host is running an older Neo4j backend.')),
      storageWarning&&h('p',{className:'warn',role:'alert'},t('Browser storage is unavailable. Query history will not survive closing this page.')),
      h('div',{className:`grid${showMetadata?'':' no-metadata'}`},showMetadata&&databaseInfo,h('div',{className:`workspace${expanded?' fullscreen-workspace':''}`},
        h('div',{id:editorId,className:'card editor-card',hidden:expanded&&!fullscreenQueryOpen,'aria-label':t('Query panel')},
          expanded&&h('div',{className:'fullscreen-query-heading bar spread'},h('strong',null,t('Query panel')),h('button',{type:'button',onClick:toggleFullscreenQuery,title:t('Hide query panel'),'aria-label':t('Hide query panel')},'×')),
          h('div',{className:'query-toolbar'},
            h('span',{className:`connection-badge ${status.connected?'success':'muted'}`,title:status.connection?.uri||t('Not connected')},'● ',t(status.connected?'Connected':'Not connected')),
            h('select',{className:'database-selector','aria-label':t('Database'),title:databaseHint||t('Database'),value:currentDatabase,disabled:busy||!status.connected,onChange:event=>{if(event.target.value==='__other__')setCustomDatabase('');else chooseDatabase(event.target.value);}},...databaseOptions.map(name=>h('option',{key:name,value:name},name||t('Default'))),h('option',{value:'__other__'},t('Other database…'))),
            h('details',compactMenu,h('summary',{title:t('Connection menu'),'aria-label':t('Connection menu')},'⚙'),h('div',{className:'menu-items'},menuAction('Connection settings',()=>setPreference('showConnection',!showConnection)),menuAction(showMetadata?'Hide database info':'Show database info',()=>setPreference('showMetadata',!showMetadata)),menuAction('Refresh schema',()=>act('schema',status.version===version?{refresh:true}:{},setSchema),!status.connected),menuAction('Refresh databases',()=>act('databases',{refresh:true},value=>{setDatabases(value.databases||[]);setDatabaseHint(value.truncated?t('Database list is truncated. Use Other database… for another name.'):'');}),!status.connected),menuAction('Disconnect',()=>act('disconnect',{},value=>{adoptStatus(value);setResult(null);setSelected(null);setSchema(null);setPreference('showConnection',true);setConnection(old=>({...old,password:''}));}),!status.connected))),
            customDatabase!==null&&h('div',{className:'database-custom'},h('input',{value:customDatabase,'aria-label':t('Database'),placeholder:t('Database'),onChange:event=>setCustomDatabase(event.target.value),onKeyDown:event=>{if(event.key==='Enter'&&customDatabase.trim()){event.preventDefault();chooseDatabase(customDatabase.trim());}if(event.key==='Escape')setCustomDatabase(null);},disabled:busy}),button('Apply',()=>chooseDatabase(customDatabase.trim()),!customDatabase.trim())),
            h('details',compactMenu,h('summary',{title:t('Editor actions'),'aria-label':t('Editor actions')},'…'),h('div',{className:'menu-items'},menuAction('Format query',()=>editorActions.current?.format(),!query.trim()),menuAction('Copy',()=>copy(query),!query),menuAction('Clear',()=>{editorActions.current?.clear();setConfirm(null);setDiagnostic(null);},!query))),
            h('div',{className:'run-group'},h('div',{className:'query-action-buttons'},
              h('button',{ref:generationTrigger,type:'button',className:'generate-trigger','aria-label':t('Generate Cypher'),title:t('Generate Cypher'),disabled:busy,onClick:()=>{setError('');setGenerationOpen(true);}},h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,'aria-hidden':true},h('path',{d:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z'}))),
              h('button',{type:'button',className:`query-run ${runState.status==='running'?'stop':'primary'}`,disabled:runState.status==='running'?false:busy||!restored||!status.connected||!query.trim(),onClick:()=>runState.status==='running'?runner.current.cancel():execute(),'aria-label':t(runState.status==='running'?'Stop':'Run query'),title:t(runState.status==='running'?'Stop':'Run query')},h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'currentColor','aria-hidden':true,focusable:false},runState.status==='running'?h('rect',{x:6,y:6,width:12,height:12,rx:1.5}):h('path',{d:'M8 5 L19 12 L8 19 Z'})))),
              h('span',{className:`run-state ${runState.status}`,role:'status','aria-live':'polite'},executionLabel(runState,t)))),
          showConnection&&h('div',{className:'card connection-card'},h('div',{className:'bar spread'},h('h2',null,t('Connection')),iconButton('Hide connection','×',()=>setPreference('showConnection',false))),h('div',{className:'fields'},...['uri','username','password','database'].map(key=>h(React.Fragment,{key},field({uri:'URI',username:'Username',password:'Password',database:'Database'}[key],connection[key]||'',value=>setConnection(old=>({...old,[key]:value})),{type:key==='password'?'password':'text',autoComplete:key==='password'?'new-password':'off'})))),button('Connect',()=>act('connect',connection,value=>{adoptStatus(value);setConnection(old=>({...old,password:''}));setPreference('showConnection',false);setResult(null);setSelected(null);setSchema(null);setRunState({status:'idle'});}),false,'primary'),h('p',{className:'muted'},t('Use a read-only database account. Credentials stay in Host memory until disconnect or restart.'))),
          h('div',{className:'query-editor'},h(CypherEditor,{value:query,onChange:setQuery,onRun:()=>execute(),schema,parametersText:params,disabled:busy||!restored,active:active&&(!expanded||fullscreenQueryOpen),height:layout.editorHeight,diagnostic:errorForEditor,actionsRef:editorActions})),
          h(ResizeHandle,{label:'Resize query editor',value:layout.editorHeight,min:64,max:640,onChange:value=>setPreference('editorHeight',value)}),
          errorForEditor&&h('div',{className:'compact-error error',role:'alert'},h('strong',null,t('Query error')),errorForEditor.message,Number.isInteger(errorForEditor.line)&&h('span',{className:'muted'},` · ${errorForEditor.line}:${errorForEditor.column||1}`)),
          error&&h('div',{className:'compact-error error',role:'alert'},error),notice&&h('p',{className:'inline-notice',role:'status'},notice),activity&&activity!=='query'&&h('p',{className:'inline-notice',role:'status'},t('Loading…'),' ',h('button',{type:'button',onClick:()=>controller.current?.abort()},t('Cancel'))),
          h('details',{className:'query-options',open:layout.queryOptions,onToggle:event=>{if(event.currentTarget.open!==layout.queryOptions)setPreference('queryOptions',event.currentTarget.open);}},h('summary',null,t('Query options')),field('Parameters (JSON)',params,setParams,{multiline:true,rows:2,className:'code',spellCheck:false}),h('div',{className:'bar spread'},h('label',{className:'check'},h('input',{type:'checkbox',checked:allowWrite,disabled:busy,onChange:event=>setAllowWrite(event.target.checked)}),t('Allow writes for this run')),h('label',{className:'row-limit'},t('Row limit'),h('select',{value:rowLimit,disabled:busy,onChange:event=>setRowLimit(Number(event.target.value))},...[25,50,100,200].map(value=>h('option',{key:value,value},value)))))),
          generationSettings,
          confirm&&h('div',{className:'card',role:'group','aria-label':t('Write confirmation')},h('p',{className:'warn'},t('This query may change your database. Review the exact query before confirming.')),h('pre',null,confirm.query),h('pre',null,pretty(confirm.parameters)),h('div',{className:'bar'},button('Confirm write',()=>execute(true)),button('Cancel',()=>setConfirm(null))))),
        h('div',{className:'card result-card'},h('div',{className:'bar spread result-header'},h('div',{className:'bar tabs',role:'tablist','aria-label':t('Result view')},...['Graph','Table','JSON'].map(name=>h('button',{key:name,type:'button',role:'tab','aria-selected':tab===name,tabIndex:tab===name?0:-1,onClick:()=>setTab(name),onKeyDown:event=>tabsKey(event,['Graph','Table','JSON'],tab,setTab)},t(name)))),h('div',{className:'bar tabs'},expanded&&h('button',{ref:queryToggle,type:'button',className:'query-panel-toggle','aria-expanded':fullscreenQueryOpen,'aria-controls':editorId,onClick:toggleFullscreenQuery,title:t(fullscreenQueryOpen?'Hide query panel':'Show query panel')},'⌨ ',t(fullscreenQueryOpen?'Hide query panel':'Show query panel')),expanded&&h('button',{type:'button',onClick:()=>changeExpanded(false),title:t('Exit fullscreen'),'aria-label':t('Exit fullscreen')},'↙'),...['Properties','History'].map(name=>h('button',{key:name,type:'button','aria-expanded':showDetails&&layout.inspectorTab===name,'aria-controls':inspectorId,onClick:()=>openInspector(name)},t(name))))),(result?.truncated||result?.graph?.truncated)&&h('p',{className:'warn'},t('Results truncated')),
          h('div',{className:`result-layout workbench${visibleInspector?' has-details':''}${expanded?' is-fullscreen':''}`,style:{'--graph-height':layout.graphHeight+'px','--inspector-height':layout.inspectorHeight+'px','--inspector-width':layout.inspectorWidth+'px'}},
            h('div',{className:'results-main',role:'tabpanel','aria-label':t(tab)},tab==='Graph'?h(Graph,{graph:result?.graph,revision:graphRevision,selected,onSelect:select,onExpand:expand,expandedNodes,busy,expanded,onExpandedChange:changeExpanded,active,inspectorId:layout.inspectorTab==='Properties'&&visibleInspector?inspectorId:undefined}):tab==='JSON'?h('pre',{className:'result-json'},result?pretty(result):t('No results yet. Run a query to explore your graph.')):h('div',{className:'table'},!result?h('p',{className:'muted'},t('No results yet. Run a query to explore your graph.')):h('table',null,h('thead',null,h('tr',null,...columns.map(column=>h('th',{key:column},column)))),h('tbody',null,...rows.map((row,index)=>h('tr',{key:index},...columns.map((column,columnIndex)=>h('td',{key:column},JSON.stringify(Array.isArray(row)?row[columnIndex]:row[column])))))))),!expanded&&h(ResizeHandle,{label:'Resize graph',value:layout.graphHeight,min:240,max:1600,onChange:value=>setPreference('graphHeight',value)})),
            visibleInspector&&h(ResizeHandle,{axis:'x',label:'Resize inspector width',value:layout.inspectorWidth,min:200,max:640,reverse:true,onChange:value=>setPreference('inspectorWidth',value)}),visibleInspector&&inspector)),
        generationOpen&&h(GeneratorMenu,{anchorRef:generationTrigger,onClose:closeGeneration},h('div',{className:'menu-heading'},h('strong',null,t('Prompt')),h('button',{type:'button','aria-label':t('Close'),onClick:closeGeneration},'×')),field('Prompt',question,setQuestion,{multiline:true,rows:3}),error&&h('p',{className:'error',role:'alert'},error),h('div',{className:'bar spread'},busy?h('span',{'aria-live':'polite'},t('Loading…')):h('span',null),busy?h('button',{type:'button',onClick:()=>controller.current?.abort()},t('Cancel')):button('Generate Cypher',()=>act('generate',{question,labels:scope()},value=>{setQuery(value.cypher??value.query??'');setParams(pretty(value.parameters||{}));setAllowWrite(false);setConfirm(null);setDiagnostic(null);setGenerationOpen(false);}),!status.connected||!question.trim(),'primary'))))));
  };
}
