// Expansion is a local graph view, never a database mutation. The base result is
// immutable; visible expansion groups are reachable from its nodes, not from
// their own cached descendants (which would keep collapsed cycles alive).
export function createGraphExpansionStore({maxNodes=500,maxEdges=1000,maxGroups=100}={}) {
  let base={nodes:[],edges:[]},groups=new Map();
  const identity=value=>value?.id??value?.elementId;
  const normalize=graph=>({
    truncated:Boolean(graph?.truncated),
    nodes:(graph?.nodes||[]).filter(node=>identity(node)!==undefined&&identity(node)!==null).map(node=>({...node,id:String(identity(node))})),
    edges:(graph?.edges||[]).filter(edge=>identity(edge)!==undefined&&identity(edge)!==null).map(edge=>({...edge,id:String(identity(edge)),source:String(edge.source),target:String(edge.target)})),
  });
  function materialize() {
    const nodes=new Map(base.nodes.slice(0,maxNodes).map(node=>[node.id,node])),edges=new Map(base.edges.slice(0,maxEdges).map(edge=>[edge.id,edge]));
    const reached=new Set(),baseEdges=new Set(edges.keys());let changed=true,truncated=base.truncated||base.nodes.length>maxNodes||base.edges.length>maxEdges;
    while(changed) {
      changed=false;
      for(const [root,graph] of groups) {
        if(reached.has(root)||!nodes.has(root))continue;
        reached.add(root);changed=true;truncated ||= graph.truncated;
        for(const node of graph.nodes){if(nodes.has(node.id)||nodes.size<maxNodes)nodes.set(node.id,node);else truncated=true;}
        for(const edge of graph.edges){if(edges.has(edge.id)||edges.size<maxEdges)edges.set(edge.id,edge);else truncated=true;}
      }
    }
    groups=new Map([...groups].filter(([root])=>reached.has(root)));
    return {nodes:[...nodes.values()],edges:[...edges.values()].filter(edge=>baseEdges.has(edge.id)||(nodes.has(edge.source)&&nodes.has(edge.target))),truncated};
  }
  return {
    reset(graph){base=normalize(graph);groups=new Map();return materialize();},
    has(root){return groups.has(String(root));},
    get expandedIds(){return new Set(groups.keys());},
    add(root,graph){
      root=String(root);
      const visible=materialize();
      if(!visible.nodes.some(node=>node.id===root))return visible;
      if(!groups.has(root)&&groups.size>=maxGroups)throw new Error('Graph expansion limit reached. Collapse another node first.');
      groups.set(root,normalize(graph));return materialize();
    },
    collapse(root){groups.delete(String(root));return materialize();},
    snapshot:materialize,
  };
}
