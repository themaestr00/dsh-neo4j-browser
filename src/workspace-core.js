// View-only helpers. No authority, connection objects, results or error text are persisted.
export function resizeValue(start,delta,min,max) {return Math.max(min,Math.min(max,Math.round(start+delta)));}
export function describeEntity(entity) {
  if(!entity)return {title:'',id:'',identity:[]};
  const properties=entity.properties||{},label=entity.kind==='relationship'?entity.type:entity.labels?.[0];
  let caption='';
  for(const key of ['name','title','product','displayName','cve_id','cve']) {
    const value=properties[key];if((typeof value==='string'&&value.trim())||typeof value==='number'){caption=String(value);break;}
  }
  const id=String(entity.id??entity.elementId??'');
  const identity=[['Element ID',id],...['uuid','id'].filter(key=>properties[key]!==undefined&&String(properties[key])!==id).map(key=>[key.toUpperCase(),String(properties[key])])];
  return {title:[label,caption].filter((value,index,array)=>value&&array.indexOf(value)===index).join(' · ')||'Node',id,identity};
}
export function historyPreview(query) {return String(query).replace(/\s+/g,' ').trim();}
export function executionLabel(state,t=value=>value) {
  if(!state||state.status==='idle')return '';
  if(state.status==='running')return t('Running…');
  const duration=`${Math.max(0,Math.round(state.durationMs||0))} ms`;
  if(state.status==='completed')return `✓ ${t('Completed')} · ${duration} · ${state.rows||0} ${t('rows')}`;
  return `${t(state.status==='cancelled'?'Cancelled':'Failed')} · ${duration}`;
}

// Cancellation wins immediately, even if a transport ignores abort or resolves late.
// onFinish runs exactly once, synchronously on cancellation, so unmount can flush history.
export function createQueryRunner({execute,onChange=()=>{},onResult=()=>{},onFinish=()=>{},now=()=>performance.now(),wallNow=()=>Date.now(),id=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}) {
  let current=null;
  function finish(token,status,value,error) {
    if(token.done)return null;
    token.done=true;token.controller.signal.removeEventListener('abort',token.onAbort);
    if(current===token)current=null;
    const result={id:token.id,at:token.at,snapshot:token.snapshot,write:token.write,status,durationMs:Math.max(0,Math.round(now()-token.started)),rows:value?.rowCount??value?.rows?.length??0,error};
    if(status==='completed')onResult(value,result);
    onChange(result);onFinish(result);return result;
  }
  return {
    get running(){return Boolean(current);},
    cancel(){if(!current)return false;current.controller.abort();return true;},
    run(snapshot,write=false) {
      if(current)return Promise.resolve(null);
      const token={id:id(),at:wallNow(),started:now(),snapshot:structuredClone(snapshot),write,controller:new AbortController(),done:false};
      current=token;
      let rejectAbort;
      const aborted=new Promise((_,reject)=>{rejectAbort=reject;});
      token.onAbort=()=>{const error=Object.assign(new Error('Operation cancelled.'),{name:'AbortError',code:'ABORTED'});finish(token,'cancelled',null,error);rejectAbort(error);};
      token.controller.signal.addEventListener('abort',token.onAbort,{once:true});
      onChange({id:token.id,at:token.at,snapshot:token.snapshot,write,status:'running',durationMs:0,rows:0});
      const operation=Promise.resolve().then(()=>{if(token.controller.signal.aborted)throw Object.assign(new Error('Operation cancelled.'),{name:'AbortError'});return execute(token.snapshot,write,token.controller.signal);});
      return Promise.race([operation,aborted]).then(value=>finish(token,'completed',value),error=>finish(token,error.name==='AbortError'||error.code==='ABORTED'?'cancelled':'failed',null,error));
    },
  };
}
