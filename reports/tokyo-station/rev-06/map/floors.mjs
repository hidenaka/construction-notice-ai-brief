export const FLOOR_STYLE=Object.freeze({
 '1F':{name:'地上',code:'1F',fill:0x58ae83,line:0x176741,color:'#176741',tint:'#e6f4ec'},
 B1:{name:'地下1階',code:'B1',fill:0x67a7e3,line:0x185ca2,color:'#185ca2',tint:'#e4f0fc'},
 B2:{name:'地下2階',code:'B2',fill:0xaa84db,line:0x7043a0,color:'#7043a0',tint:'#f0e9fa'}
});
export function markFloorLabel(el,floor){
 const s=FLOOR_STYLE[floor];if(!s)return;
 el.dataset.mapFloor=floor;el.style.setProperty('--floor-color',s.color);
 const tag=document.createElement('span');tag.className='floor-tag';tag.textContent=s.code;el.append(tag);
}
export function installFloorKey(bar){
 for(const b of document.querySelectorAll('[data-floor]')){
  const s=FLOOR_STYLE[b.dataset.floor];b.style.setProperty('--floor-color',s.color);b.style.setProperty('--floor-tint',s.tint);b.textContent=s.name+' '+s.code;
 }
 const key=document.createElement('div');key.id='floor-key';key.setAttribute('aria-label','フロアの色');
 key.innerHTML=Object.values(FLOOR_STYLE).map(s=>`<span style="--floor-color:${s.color}"><i></i>${s.code} ${s.name}</span>`).join('');
 key.title='用途や確認精度ではなく、階の色です。B2のホームは概略を含みます。';
 bar.append(key);return key;
}
