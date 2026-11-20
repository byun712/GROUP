import {el} from './dom.js';
// A deliberately small Markdown subset. User text is never parsed as HTML.
export function markdownPreview(text){
  const root=el('div',{class:'markdown-preview'});let list=null;
  for(const line of text.split('\n')){
    const heading=/^(#{1,3})\s+(.+)$/.exec(line),item=/^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if(heading){list=null;root.append(el('h'+(heading[1].length+1),{},...inline(heading[2])));}
    else if(item){if(!list){list=el('ul');root.append(list);}const check=/^\[([ xX])\]\s*(.*)$/.exec(item[1]);list.append(el('li',{},check?el('input',{type:'checkbox',checked:check[1]!==' ',disabled:true,'aria-label':'설명 체크리스트'}):null,...inline(check?check[2]:item[1])));}
    else{list=null;root.append(el('p',{},...(line?inline(line):['\u00a0'])));}
  }
  return root;
}
function inline(text){
  const nodes=[];let last=0;
  const token=/\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  for(const match of text.matchAll(token)){
    nodes.push(text.slice(last,match.index));last=match.index+match[0].length;
    if(match[1]){
      let safe=false;try{safe=['https:','http:','mailto:'].includes(new URL(match[2]).protocol);}catch{}
      nodes.push(safe?el('a',{href:match[2],target:'_blank',rel:'noopener noreferrer'},match[1]):match[0]);
    }else nodes.push(el(match[3]?'strong':'code',{},match[3]||match[4]));
  }
  nodes.push(text.slice(last));return nodes;
}
