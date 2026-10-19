import {EditorState,Transaction} from '@codemirror/state';
import {lexCypher} from './cypher-completions.js';

const clauseHeads=new Set(['MATCH','OPTIONAL','WHERE','RETURN','WITH','UNWIND','CALL','YIELD','CREATE','MERGE','SET','REMOVE','DELETE','DETACH','ORDER','SKIP','LIMIT','UNION','LOAD','USE','FOREACH']);
const compoundTails=new Set(['OPTIONAL MATCH','DETACH DELETE','ON CREATE','ON MATCH','CREATE SET','MATCH SET','STARTS WITH','ENDS WITH']);

// Best effort, not a parser: only replace existing whitespace before top-level
// clauses. Never reconstruct tokens or touch nested expressions or comment text.
export function formatCypher(query) {
  if(typeof query!=='string'||query.length>160000)return query;
  const tokens=lexCypher(query);
  if(tokens.length>=12000||tokens.some(token=>token.closed===false&&!token.line))return query;
  const changes=[];let depth=0,caseDepth=0;
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i],previous=tokens[i-1],word=token.kind==='word'?token.value.toUpperCase():'';
    if(token.kind==='punctuation') {
      if(['(','[','{'].includes(token.value))depth++;
      else if([')',']','}'].includes(token.value))depth=Math.max(0,depth-1);
    }
    if(word==='CASE')caseDepth++;
    if(word==='END')caseDepth=Math.max(0,caseDepth-1);
    if(!previous||depth||caseDepth||!clauseHeads.has(word))continue;
    const preceding=previous.kind==='word'?previous.value.toUpperCase():'';
    if(compoundTails.has(preceding+' '+word)||['.','$',':'].includes(previous.value)||preceding==='AS')continue;
    // A line comment's terminator is semantically significant: leave it intact.
    if(previous.kind==='comment')continue;
    const gap=query.slice(previous.to,token.from);
    if(gap&&/^\s+$/u.test(gap)&&gap!=='\n')changes.push({from:previous.to,to:token.from});
  }
  let result=query;
  for(let i=changes.length-1;i>=0;i--)result=result.slice(0,changes[i].from)+'\n'+result.slice(changes[i].to);
  return result;
}

// Getter keeps the API valid across prop updates, and harmless after disposal.
// All edits are ordinary undoable CodeMirror transactions; no execution or copy.
export function createEditorActions(getView,isDisabled=()=>false) {
  function replace(transform) {
    const view=getView();
    if(!view||isDisabled()||view.state.facet(EditorState.readOnly))return false;
    const before=view.state.doc.toString(),after=transform(before);
    if(after===before)return false;
    view.dispatch({changes:{from:0,to:before.length,insert:after},selection:{anchor:Math.min(view.state.selection.main.head,after.length)},annotations:Transaction.userEvent.of('input')});
    return true;
  }
  return {
    format:()=>replace(formatCypher),
    clear:()=>replace(()=>''),
    focus:()=>{const view=getView();if(!view)return false;view.focus();return true;},
  };
}

// Coordinates refer to the original query, never an EXPLAIN-prefixed query.
// Neo4j line/column are 1-based; offset is a 0-based UTF-16 document position.
export function diagnosticPosition(doc,diagnostic) {
  if(!diagnostic||diagnostic.query!==doc.toString())return null;
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,Math.floor(value)));
  if(finite(diagnostic.offset)) {
    const offset=clamp(diagnostic.offset,0,doc.length);
    return {line:doc.lineAt(offset).number,offset};
  }
  if(!finite(diagnostic.line))return null;
  const line=doc.line(clamp(diagnostic.line,1,doc.lines));
  return {line:line.number,offset:finite(diagnostic.column)?line.from+clamp(diagnostic.column-1,0,line.length):null};
}
