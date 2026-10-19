import {Annotation,Compartment,EditorState,Prec,StateEffect,StateField} from '@codemirror/state';
import {Decoration,EditorView,drawSelection,highlightActiveLine,keymap,lineNumbers} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap} from '@codemirror/commands';
import {acceptCompletion,autocompletion,closeBrackets,closeBracketsKeymap,closeCompletion,completionKeymap,moveCompletionSelection} from '@codemirror/autocomplete';
import {bracketMatching} from '@codemirror/language';
import {buildCompletionSchema,completeCypher,highlightCypher} from './cypher-completions.js';

import {createEditorActions,diagnosticPosition} from './editor-actions.js';

const fromReact=Annotation.define();
// These commands own selection/acceptance only while completion is active. CM's
// tooltip updates aria-selected and scrolls its own UL when selection changes.
export const completionNavigationKeymap=[
  {key:'ArrowDown',run:moveCompletionSelection(true)},
  {key:'ArrowUp',run:moveCompletionSelection(false)},
  {key:'Enter',run:acceptCompletion},
  {key:'Tab',run:acceptCompletion},
  {key:'Escape',run:closeCompletion},
];
export const completionNavigation=Prec.highest(keymap.of(completionNavigationKeymap));
export const setEditorDiagnostic=StateEffect.define();
function diagnosticDecorations(state,diagnostic) {
  const position=diagnosticPosition(state.doc,diagnostic);
  if(!position)return Decoration.none;
  const title=typeof diagnostic.message==='string'?diagnostic.message:'';
  const line=state.doc.line(position.line),ranges=[Decoration.line({class:'n4j-cypher-error-line',attributes:{title}}).range(line.from)];
  if(position.offset!==null&&line.length) {
    const from=Math.min(position.offset,line.to-1);
    ranges.push(Decoration.mark({class:'n4j-cypher-error-position',attributes:{title}}).range(from,from+1));
  }
  return Decoration.set(ranges,true);
}
export const cypherDiagnostics=StateField.define({
  create:()=>Decoration.none,
  update:(ranges,transaction)=>{
    if(transaction.docChanged)ranges=Decoration.none;
    for(const effect of transaction.effects)if(effect.is(setEditorDiagnostic))ranges=diagnosticDecorations(transaction.state,effect.value);
    return ranges;
  },
  provide:field=>EditorView.decorations.from(field),
});
// An omitted height retains the original content-sized editor. A controlled
// pixel height belongs to the scroller, not the tooltip or any foreign DOM.
export function editorHeight(height) {
  return typeof height==='number'&&Number.isFinite(height)?Prec.highest(EditorView.theme({'.cm-scroller':{height:Math.max(1,height)+'px',maxHeight:'none'}})):[];
}
const decorate=state=>Decoration.set(highlightCypher(state.doc.toString()).filter(token=>!['identifier','punctuation'].includes(token.style)).map(token=>Decoration.mark({class:'n4j-cypher-'+token.style}).range(token.from,token.to)));
export const cypherHighlighting=StateField.define({
  create:decorate,
  update:(ranges,transaction)=>transaction.docChanged?decorate(transaction.state):ranges,
  provide:field=>EditorView.decorations.from(field),
});
const theme=EditorView.theme({
  '&':{color:'var(--dsw-alias-label-primary)',backgroundColor:'var(--dsw-alias-bg-base)',fontSize:'13px',width:'100%'},
  '&.cm-focused':{outline:'none'},
  '.cm-scroller':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',lineHeight:'1.65',maxHeight:'300px',overflow:'auto'},
  '.cm-content':{minHeight:'65px',padding:'8px 0',caretColor:'var(--dsw-alias-brand-primary)'},
  '.cm-line':{padding:'0 8px'},
  '.cm-gutters':{backgroundColor:'var(--dsw-alias-bg-base)',color:'var(--dsw-alias-label-secondary)',border:'none',fontSize:'11px'},
  '.cm-activeLine':{backgroundColor:'var(--dsw-alias-bg-layer-1)'},
  '.cm-cursor':{borderLeftColor:'var(--dsw-alias-brand-primary)'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent)'},
  '.cm-matchingBracket':{backgroundColor:'var(--dsw-alias-bg-layer-2)',outline:'1px solid var(--dsw-alias-brand-primary)'},
  '.n4j-cypher-keyword':{color:'var(--dsw-alias-brand-primary)',fontWeight:'600'},
  '.n4j-cypher-string':{color:'var(--dsw-alias-state-success-primary)'},
  '.n4j-cypher-number, .n4j-cypher-parameter':{color:'var(--dsw-alias-state-warn-primary)'},
  '.n4j-cypher-comment':{color:'var(--dsw-alias-label-secondary)',fontStyle:'italic'},
  '.n4j-cypher-label, .n4j-cypher-function':{color:'var(--dsw-alias-brand-primary)'},
  '.n4j-cypher-property':{color:'var(--dsw-alias-state-warn-primary)'},
  '.cm-tooltip':{zIndex:'120',border:'1px solid var(--dsw-alias-border-l2)',borderRadius:'8px',backgroundColor:'var(--dsw-alias-bg-overlay)',color:'var(--dsw-alias-label-primary)',overflow:'hidden'},
  '.cm-tooltip-autocomplete':{maxWidth:'min(520px, 90vw)'},
  '.cm-tooltip-autocomplete > ul':{fontFamily:'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',fontSize:'12px',maxHeight:'240px'},
  '.cm-tooltip-autocomplete > ul > li':{padding:'5px 9px',lineHeight:'1.6'},
  '.cm-tooltip-autocomplete > ul > li[aria-selected=true]':{backgroundColor:'color-mix(in srgb, var(--dsw-alias-brand-primary) 26%, var(--dsw-alias-bg-overlay))',color:'var(--dsw-alias-label-primary)',boxShadow:'inset 3px 0 var(--dsw-alias-brand-primary), inset 0 0 0 1px var(--dsw-alias-brand-primary)'},
  '.cm-tooltip-autocomplete > ul > li[aria-selected=true] .cm-completionLabel':{fontWeight:'700'},
  '.n4j-cypher-error-line':{backgroundColor:'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)',boxShadow:'inset 3px 0 var(--dsw-alias-state-error-primary)'},
  '.n4j-cypher-error-position':{textDecoration:'underline wavy var(--dsw-alias-state-error-primary)',textUnderlineOffset:'3px',backgroundColor:'color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent)'},
  '.cm-completionMatchedText':{color:'var(--dsw-alias-brand-primary)',textDecoration:'none',fontWeight:'600'},
  '.cm-completionDetail':{color:'var(--dsw-alias-label-secondary)',fontSize:'11px',marginLeft:'12px'},
});

export function completionSource(schema,parameters,t=value=>value) {
  return context=>{
    if(context.state.facet(EditorState.readOnly))return null;
    const result=completeCypher(context.state.doc.toString(),context.pos,schema,parameters,context.explicit);
    // Filtering already understands backtick escapes; CM's plain-text matcher must not reject them.
    return result?{...result,filter:false,options:result.options.map(option=>({...option,detail:t(option.detail)}))}:null;
  };
}

// React is supplied by the Harness module table; no second React or Client SDK is bundled.
export function createCypherEditor(React,t) {
  const {createElement:h,useEffect,useMemo,useRef}=React;
  return function CypherEditor({value,onChange,onRun,schema,parametersText,disabled,active=true,height,diagnostic,actionsRef}) {
    const host=useRef(null),mounted=useRef(null),latest=useRef(null);
    latest.current={onChange,onRun,disabled};
    const metadata=useMemo(()=>buildCompletionSchema(schema),[schema]);
    const parameters=useMemo(()=>{try{const parsed=JSON.parse(parametersText||'{}');return parsed&&!Array.isArray(parsed)&&typeof parsed==='object'?parsed:{};}catch{return {};}},[parametersText]);
    const source=useMemo(()=>completionSource(metadata,parameters,t),[metadata,parameters]);
    useEffect(()=>{
      const completions=new Compartment(),editing=new Compartment(),sizing=new Compartment();
      const view=new EditorView({parent:host.current,state:EditorState.create({doc:value,extensions:[
        theme,cypherHighlighting,cypherDiagnostics,sizing.of(editorHeight(height)),lineNumbers(),highlightActiveLine(),drawSelection(),history(),bracketMatching(),closeBrackets(),EditorView.lineWrapping,
        EditorState.languageData.of(()=>[{closeBrackets:{brackets:['(','[','{',"'",'"','`']}}]),
        editing.of([EditorState.readOnly.of(!!disabled),EditorView.editable.of(!disabled)]),
        completions.of(autocompletion({override:[source],activateOnTyping:true,maxRenderedOptions:60,defaultKeymap:false,interactionDelay:0})),
        completionNavigation,
        keymap.of([{key:'Mod-Enter',run:()=>{if(!latest.current.disabled)latest.current.onRun?.();return true;}},...completionKeymap,...closeBracketsKeymap,...defaultKeymap,...historyKeymap]),
        EditorView.contentAttributes.of({'aria-label':t('Cypher'),'aria-multiline':'true',spellcheck:'false',autocapitalize:'off',autocorrect:'off'}),
        EditorView.updateListener.of(update=>{if(update.docChanged&&!update.transactions.some(transaction=>transaction.annotation(fromReact)))latest.current.onChange(update.state.doc.toString());}),
      ]})});
      mounted.current={view,completions,editing,sizing};
      return()=>{mounted.current=null;view.destroy();};
    },[]);
    useEffect(()=>{
      const view=mounted.current?.view;if(!view||view.state.doc.toString()===value)return;
      view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value},annotations:fromReact.of(true),selection:{anchor:Math.min(view.state.selection.main.head,value.length)}});
    },[value]);
    useEffect(()=>{const current=mounted.current;if(!current)return;closeCompletion(current.view);current.view.dispatch({effects:current.completions.reconfigure(autocompletion({override:[source],activateOnTyping:true,maxRenderedOptions:60,defaultKeymap:false,interactionDelay:0}))});},[source]);
    useEffect(()=>{const current=mounted.current;if(!current)return;if(disabled)closeCompletion(current.view);current.view.dispatch({effects:current.editing.reconfigure([EditorState.readOnly.of(!!disabled),EditorView.editable.of(!disabled)])});},[disabled]);
    useEffect(()=>{if(!active&&mounted.current)closeCompletion(mounted.current.view);if(active)mounted.current?.view.requestMeasure();},[active]);
    useEffect(()=>{const current=mounted.current;if(!current)return;current.view.dispatch({effects:current.sizing.reconfigure(editorHeight(height))});current.view.requestMeasure();},[height]);
    useEffect(()=>{mounted.current?.view.dispatch({effects:setEditorDiagnostic.of(diagnostic)});},[diagnostic]);
    useEffect(()=>{
      if(!actionsRef)return;
      const actions=createEditorActions(()=>mounted.current?.view,()=>!!latest.current.disabled);
      actionsRef.current=actions;
      return()=>{if(actionsRef.current===actions)actionsRef.current=null;};
    },[actionsRef]);
    return h('div',{className:'cypher-editor'},h('div',{ref:host,className:'cypher-editor-host'}),h('div',{className:'cypher-editor-hint'},t('Ctrl+Space: suggestions · Tab/Enter: accept · Ctrl/⌘+Enter: run')));
  };
}
