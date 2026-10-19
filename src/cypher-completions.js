// Local-only language helpers: schema names/types are used, never property values.
export const KEYWORDS = ['MATCH','OPTIONAL MATCH','WHERE','RETURN','WITH','AS','DISTINCT','ORDER BY','ASC','DESC','LIMIT','SKIP','UNWIND','CALL','YIELD','UNION','UNION ALL','CREATE','MERGE','ON CREATE SET','ON MATCH SET','SET','REMOVE','DELETE','DETACH DELETE','FOREACH','LOAD CSV','USING INDEX','USING SCAN','EXPLAIN','PROFILE','SHOW','SHOW INDEXES','SHOW CONSTRAINTS','USE','AND','OR','XOR','NOT','IN','IS NULL','IS NOT NULL','CONTAINS','STARTS WITH','ENDS WITH','CASE','WHEN','THEN','ELSE','END','EXISTS','COUNT','COLLECT','TRUE','FALSE','NULL'];
export const FUNCTIONS = ['count','collect','sum','avg','min','max','coalesce','size','length','head','last','tail','keys','labels','type','properties','nodes','relationships','startNode','endNode','elementId','id','toString','toInteger','toFloat','toBoolean','toLower','toUpper','trim','replace','split','substring','left','right','range','reduce','all','any','none','single','date','datetime','duration','timestamp','point','shortestPath','allShortestPaths'];
const keywordSet = new Set(KEYWORDS.flatMap(word => word.split(' ')));
const identifierPattern = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const identifierToken = token => token && (token.kind === 'word' || token.kind === 'identifier');
const patternPreceders = new Set(['MATCH','OPTIONAL','CREATE','MERGE','WHERE','EXISTS','NOT','AND','OR']);

export function lexCypher(text) {
  const tokens = []; let i = 0;
  while (i < text.length && tokens.length < 12000) {
    const from = i, char = text[i];
    if (/\s/u.test(char)) { i++; continue; }
    if (text.startsWith('//', i)) {
      i += 2; while (i < text.length && text[i] !== '\n') i++;
      tokens.push({kind:'comment',value:text.slice(from,i),from,to:i,line:true,closed:i<text.length}); continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2;
      tokens.push({kind:'comment',value:text.slice(from,i),from,to:i,closed:end>=0}); continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      let value = '', closed = false; i++;
      while (i < text.length) {
        if (text[i] === char) {
          if (text[i+1] === char) { value += char; i += 2; continue; }
          i++; closed = true; break;
        }
        if (char !== '`' && text[i] === '\\' && i+1 < text.length) { value += text.slice(i,i+2); i += 2; continue; }
        value += text[i++];
      }
      tokens.push({kind:char==='`'?'identifier':'string',value,from,to:i,closed}); continue;
    }
    const word = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(i));
    if (word) { i += word[0].length; tokens.push({kind:'word',value:word[0],from,to:i}); continue; }
    const number = /^(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (number) { i += number[0].length; tokens.push({kind:'number',value:number[0],from,to:i}); continue; }
    i++; tokens.push({kind:'punctuation',value:char,from,to:i});
  }
  return tokens;
}

export function highlightCypher(text) {
  const tokens = lexCypher(text.slice(0,16000));
  return tokens.map((token,index) => {
    let style = token.kind;
    const previous = tokens[index-1], next = tokens[index+1];
    if (identifierToken(token)) {
      if (previous?.value === '.') style = 'property';
      else if (previous?.value === '$') style = 'parameter';
      else if (previous?.value === ':') style = 'label';
      else if (token.kind === 'word' && keywordSet.has(token.value.toUpperCase())) style = 'keyword';
      else if (next?.value === '(') style = 'function';
      else style = 'identifier';
    }
    return {...token,style};
  });
}

export function quoteIdentifier(name, force = false) {
  return !force && identifierPattern.test(name) && !keywordSet.has(name.toUpperCase()) ? name : '`'+name.replaceAll('`','``')+'`';
}
const metadataType = value => {
  const name = String(value ?? '').replace(/^:/,'');
  return name.startsWith('`') && name.endsWith('`') ? name.slice(1,-1).replaceAll('``','`') : name;
};

export function buildCompletionSchema(schema = {}) {
  const labels = new Set((schema?.labels || []).filter(value=>typeof value==='string'));
  const relationships = new Set((schema?.relationshipTypes || []).filter(value=>typeof value==='string'));
  const nodeProperties = new Map(), relationshipProperties = new Map(), allNode = new Map(), allRelationship = new Map();
  function add(target,name,types) {
    if(typeof name!=='string'||!name)return;
    if(!target.has(name))target.set(name,new Set());
    for(const type of types||[])if(typeof type==='string')target.get(name).add(type);
  }
  for(const row of schema?.nodeProperties||[]) {
    add(allNode,row.propertyName,row.propertyTypes);
    for(const label of row.nodeLabels||[])if(typeof label==='string') {
      labels.add(label);if(!nodeProperties.has(label))nodeProperties.set(label,new Map());
      add(nodeProperties.get(label),row.propertyName,row.propertyTypes);
    }
  }
  for(const row of schema?.relationshipProperties||[]) {
    const type = metadataType(row.relType);add(allRelationship,row.propertyName,row.propertyTypes);
    if(type) {relationships.add(type);if(!relationshipProperties.has(type))relationshipProperties.set(type,new Map());add(relationshipProperties.get(type),row.propertyName,row.propertyTypes);}
  }
  return {labels:[...labels].sort(),relationships:[...relationships].sort(),nodeProperties,relationshipProperties,allNode,allRelationship};
}

function patternAt(tokens,index) {
  const opening=tokens[index],previous=tokens[index-1];
  if(opening.value==='[' && previous?.value!=='-')return null;
  if(opening.value==='(' && previous?.kind==='word' && !patternPreceders.has(previous.value.toUpperCase()))return null;
  let j=index+1,name;
  if(identifierToken(tokens[j]))name=tokens[j++].value;
  if(name && tokens[j] && ![':',')',']','{'].includes(tokens[j].value))return null;
  const labels=[];
  for(;j<tokens.length;j++) {
    const value=tokens[j].value;
    if(tokens[j].kind==='punctuation'&&['{',')',']'].includes(value))break;
    if(tokens[j].kind==='punctuation'&&[':','|','&'].includes(value)&&identifierToken(tokens[j+1]))labels.push(tokens[j+1].value);
  }
  return {kind:opening.value==='['?'relationship':'node',name,labels};
}

function inferBindings(tokens) {
  const bindings=new Map();
  for(let i=0;i<tokens.length;i++) {
    if(tokens[i].kind==='punctuation'&&['(','['].includes(tokens[i].value)) {
      const pattern=patternAt(tokens,i);
      if(pattern?.name) {
        const previous=bindings.get(pattern.name);
        bindings.set(pattern.name,{...pattern,labels:[...new Set([...(previous?.labels||[]),...pattern.labels])]});
      }
    }
    if(tokens[i].kind==='word'&&tokens[i].value.toUpperCase()==='AS'&&identifierToken(tokens[i-1])&&identifierToken(tokens[i+1])) {
      const original=bindings.get(tokens[i-1].value);if(original)bindings.set(tokens[i+1].value,{...original,name:tokens[i+1].value});
    }
  }
  return bindings;
}

function propertyOptions(schema,binding) {
  const collection=binding?.kind==='relationship'?schema.relationshipProperties:schema.nodeProperties;
  const fallback=binding?.kind==='relationship'?schema.allRelationship:schema.allNode;
  const properties=new Map(); let found=false;
  for(const label of binding?.labels||[]) {
    const known=collection.get(label);if(!known)continue;found=true;
    for(const [name,types] of known) {if(!properties.has(name))properties.set(name,new Set());for(const type of types)properties.get(name).add(type);}
  }
  if(!found)for(const [name,types] of fallback)properties.set(name,new Set(types));
  // No bound variable: allow both domains, but never import sampled values.
  if(!binding)for(const [name,types] of schema.allRelationship) {if(!properties.has(name))properties.set(name,new Set());for(const type of types)properties.get(name).add(type);}
  return [...properties].map(([label,types])=>({label,type:'property',detail:[...types].join(' | ')}));
}

export function completeCypher(text,position,schema,parameters = {},explicit = false) {
  if(text.length>16000)return null;
  const pos=Math.max(0,Math.min(text.length,position));
  const all=lexCypher(text);
  const containing=all.find(token=>token.from<pos&&token.to>=pos);
  if(containing?.kind==='string' && (!containing.closed||pos<containing.to))return null;
  if(containing?.kind==='comment' && (containing.line||!containing.closed||pos<containing.to))return null;
  const current=all.find(token=>identifierToken(token)&&token.from<=pos&&token.to>=pos)||null;
  const from=current?.from??pos,to=current?.to??pos;
  let prefix=current?text.slice(from,pos):'';
  const quoted=prefix.startsWith('`');
  if(quoted){prefix=prefix.slice(1);if(current.closed&&pos===current.to)prefix=prefix.slice(0,-1);prefix=prefix.replaceAll('``','`');}
  let before=all.filter(token=>token.to<=from&&token.kind!=='comment');
  const statement=before.findLastIndex(token=>token.kind==='punctuation'&&token.value===';');before=before.slice(statement+1);
  const bindings=inferBindings(before),last=before.at(-1),previous=before.at(-2);
  const stack=[];
  for(let i=0;i<before.length;i++) {
    const token=before[i];
    if(token.kind!=='punctuation')continue;
    if(['(','[','{'].includes(token.value)) {
      const parent=stack.at(-1),owner=token.value==='{'?(parent?.pattern||bindings.get(before[i-1]?.value)):undefined;
      stack.push({opening:token.value,pattern:['(','['].includes(token.value)?patternAt(before,i):null,owner});
    } else if([')',']','}'].includes(token.value))stack.pop();
  }
  const top=stack.at(-1);let options=[],kind='general';
  if(last?.kind==='punctuation'&&last.value==='.' && identifierToken(previous)) {
    options=propertyOptions(schema,bindings.get(previous.value));kind='property';
  } else if(last?.kind==='punctuation'&&last.value==='$') {
    options=Object.keys(parameters&&typeof parameters==='object'?parameters:{}).map(label=>({label,type:'variable',detail:'Parameter'}));kind='parameter';
  } else if(top?.opening==='{' && top.owner && last?.kind==='punctuation' && ['{',',','.'].includes(last.value)) {
    options=propertyOptions(schema,top.owner);kind='property';
  } else if(top?.opening!=='{' && last?.kind==='punctuation' && [':','|','&','!'].includes(last.value)) {
    const relationship=top?.pattern?.kind==='relationship';
    options=(relationship?schema.relationships:schema.labels).map(label=>({label,type:'type',detail:relationship?'Relationship type':'Node label'}));kind=relationship?'relationship':'label';
  } else {
    if(!prefix&&!explicit)return null;
    options=[...KEYWORDS.map(label=>({label,type:'keyword',detail:'Cypher keyword'})),...FUNCTIONS.map(label=>({label,type:'function',detail:'Function'})),...[...bindings.keys()].map(label=>({label,type:'variable',detail:'Variable'}))];
  }
  const seen=new Set();
  options=options.filter(option=>{
    const key=option.label+'\0'+option.type;
    if(seen.has(key)||!option.label.toLowerCase().startsWith(prefix.toLowerCase()))return false;
    seen.add(key);return true;
  }).sort((a,b)=>a.label.localeCompare(b.label)).slice(0,200).map(option=>({...option,apply:option.type==='keyword'||option.type==='function'?option.label:quoteIdentifier(option.label,quoted)}));
  return options.length?{from,to,kind,options}:null;
}
