export function el(tag,attrs={},...children){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)){
    if(key.startsWith('on'))node.addEventListener(key.slice(2),value);
    else if(key==='class')node.className=value;
    else if(key==='value')node.value=value??'';
    else if(key==='checked'||key==='disabled'||key==='hidden')node[key]=!!value;
    else if(value!==null&&value!==undefined)node.setAttribute(key,String(value));
  }
  for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));
  return node;
}
export const $=(selector,root=document)=>root.querySelector(selector);
export const field=(label,input)=>el('label',{},el('span',{class:'field-label'},label),input);
export function options(select,values,value){select.replaceChildren(...values.map(([key,label])=>el('option',{value:key},label)));select.value=value??'';return select;}
export function selectInput(name,values,value,attrs={}){return options(el('select',{name,...attrs}),values,value);}
export function icon(name){
  const paths={all:'M4 5h16M4 12h16M4 19h16',today:'M5 5h14v15H5zM8 3v4m8-4v4M5 10h14m-9 4h4',upcoming:'M4 5h16v15H4zM8 3v4m8-4v4M4 10h16m-9 4 3 2-3 2',projects:'M3 7V5h7l2 2h9v13H3z',done:'M5 12l4 4L19 6',plus:'M12 5v14M5 12h14',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',arrow:'m9 5 7 7-7 7',close:'M6 6l12 12M6 18 12 6',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',flag:'M5 21V3h12l-2 4 2 4H5',note:'M5 3h14v18H5zM8 8h8M8 12h8m-8 4h5',dot:'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12',trash:'M3 6h18M9 3h6m-10 3 1 15h12l1-15M10 10v7m4-7v7',local:'M5 3h14v18H5zM9 17h6',chevron:'m8 10 4 4 4-4'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.note);svg.append(path);return svg;
}
export const button=(label,action,attrs={})=>el('button',{type:'button',onclick:action,...attrs},label);
export function watchDirty(form){form.dataset.dirty='false';form.addEventListener('input',()=>{form.dataset.dirty='true';});form.addEventListener('change',()=>{form.dataset.dirty='true';});}
export const formValues=form=>Object.fromEntries(new FormData(form));
