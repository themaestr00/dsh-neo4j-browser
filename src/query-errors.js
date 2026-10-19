// Deliberately narrow: only UI query syntax/semantic errors may expose bounded copy.
// Authentication, connection, database values and arbitrary driver errors remain generic.
const allowed=new Set(['Neo.ClientError.Statement.SyntaxError','Neo.ClientError.Statement.SemanticError','Neo.ClientError.Statement.ParameterMissing']);
export function queryDiagnostic(error,query,prefix=0,parameters={}) {
  if(!allowed.has(error?.code)||typeof error.message!=='string')return null;
  let message=error.message.split(/\r?\n/,1)[0].replace(/\s*\(line \d+,\s*column \d+(?:\s*\(offset:\s*\d+\))?\)/i,'').replace(/[\x00-\x08\x0b-\x1f]/g,'').trim();
  const pending=[parameters];let visits=0;
  while(pending.length&&visits++<200) {
    const value=pending.pop();
    if(typeof value==='string'&&value.length>=4)message=message.replaceAll(value,'[redacted]');
    else if(value&&typeof value==='object')pending.push(...Object.values(value).slice(0,100));
  }
  message=message.replace(/((?:password|credential|token|secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]').replace(/((?:bolt|neo4j)(?:\+s|\+ssc)?:\/\/)[^@\s]+@/gi,'$1[redacted]@').slice(0,1200)||'Cypher query is invalid.';
  const raw=error.diagnosticRecord?._position??error.position??{};
  const parsed=/line\s+(\d+),\s*column\s+(\d+)(?:\s*\(offset:\s*(\d+)\))?/i.exec(error.message);
  let offset=Number.isInteger(raw.offset)?raw.offset:parsed?.[3]===undefined?null:Number(parsed[3]);
  let line=Number.isInteger(raw.line)?raw.line:parsed?Number(parsed[1]):null;
  let column=Number.isInteger(raw.column)?raw.column:parsed?Number(parsed[2]):null;
  if(offset!==null)offset=Math.max(0,Math.min(query.length,offset-prefix));
  else if(line!==null) {
    const lines=query.split('\n');line=Math.max(1,Math.min(lines.length,line));
    column=Math.max(1,(column||1)-(line===1?prefix:0));
    offset=lines.slice(0,line-1).reduce((total,value)=>total+value.length+1,0)+Math.min(lines[line-1].length,column-1);
  }
  if(offset!==null) {
    const preceding=query.slice(0,offset).split('\n');line=preceding.length;column=preceding.at(-1).length+1;
    return {message,position:{offset,line,column}};
  }
  return {message};
}
