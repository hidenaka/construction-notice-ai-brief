import { TapGuard } from './gesture.mjs';
import { configureMotion } from './motion.mjs';

export function installMobileUI(api) {
  const { THREE, controls, state, saveHash, resize, visibleHeight, setMode, renderer } = api;
  const $ = s => document.querySelector(s);
  const small = matchMedia('(max-width:700px), (max-height:500px)');
  const bar = $('.bar'), canvas = $('#view canvas');
  let rotate = false;
  let layoutDirty=true, bounds, blockers=[];
  const labelSizes=new Map();
  const measureLayout=()=>{
    bounds=$('#labels').getBoundingClientRect();
    blockers=[$('#mobile-nav'),$('#compass'),$('#schemB2')].filter(e=>e?.getClientRects().length).map(e=>e.getBoundingClientRect());
    layoutDirty=false;
  };
  const node = (tag, cls, html='') => { const e=document.createElement(tag);e.className=cls;e.innerHTML=html;return e; };
  const button = (text, label, fn) => { const b=node('button','chip mobile-only');b.textContent=text;b.type='button';if(label)b.setAttribute('aria-label',label);b.onclick=fn;return b; };
  const closePanels = () => { document.body.classList.remove('options-open','search-open');settings.setAttribute('aria-expanded','false');find.setAttribute('aria-expanded','false'); };
  const panel = name => {
    const open=!document.body.classList.contains(name+'-open'); closePanels();
    document.body.classList.toggle(name+'-open',open);
    (name==='search'?find:settings).setAttribute('aria-expanded',String(open));
    if(open && name==='search') $('#q').focus();
  };
  const primary=node('div','mobile-primary'), floors=node('div','mobile-floors');
  const options=node('div','mobile-options'), search=node('div','mobile-search');
  const mode=$('[aria-label="表示"]'), floor=$('[aria-label="階"]'), area=$('[aria-label="場所"]');
  primary.append($('.title'),mode);
  const find=button('検索','建物・出口を検索',()=>panel('search'));
  const settings=button('表示設定','表示設定を開く',()=>panel('options'));
  for(const b of [find,settings]) b.setAttribute('aria-expanded','false');
  primary.append(find,settings);floors.append(floor);
  options.append($('#tBldg'),$('#tUnder'),$('#tNet'),$('#tExits'),area);
  const key=button('凡例','凡例を開く',()=>{closePanels();$('#legendBtn').click();});options.append(key);
  const source=node('a','mobile-only','出典・未確認箇所');source.href='../sources.html';options.append(source);
  search.append($('.search'));const hint=node('div','mobile-only mobile-hint');
  const actions=node('div','mobile-only mobile-actions');
  actions.setAttribute('role','group');actions.setAttribute('aria-label','1本指の操作');
  const actionTitle=node('span','mobile-actions-title','1本指の操作');
  const move=button('移動','移動',()=>{rotate=false;sync();});
  const turn=button('回転・傾き','回転・傾き',()=>{rotate=true;sync();});
  actions.append(actionTitle,move,turn);
  hint.setAttribute('role','status');hint.setAttribute('aria-live','polite');
  bar.append(primary,floors,actions,hint,options,search);
  const nav=node('div','mobile-only');nav.id='mobile-nav';nav.setAttribute('aria-label','地図操作');
  const zoom = factor => {
    const before=visibleHeight(), after=Math.max(35,Math.min(3000,before*factor)), cam=controls.object;
    if(state.mode==='2d') cam.zoom*=before/after;
    else cam.position.sub(controls.target).multiplyScalar(after/before).add(controls.target);
    cam.updateProjectionMatrix();controls.update();saveHash();
  };
  nav.append(button('＋','地図を拡大',()=>zoom(1/1.2)),button('−','地図を縮小',()=>zoom(1.2)));
  nav.append(button('戻す','丸の内の初期表示に戻す',()=>{
    const cam=controls.object,dx=-200-controls.target.x,dy=60-controls.target.y;
    cam.position.x+=dx;cam.position.y+=dy;controls.target.x=-200;controls.target.y=60;
    rotate=false;setMode(state.mode);zoom(700/visibleHeight());sync();
  }));document.body.append(nav);
  const cardBar=node('div','mobile-only');cardBar.id='mobile-cardbar';
  const cardTitle=node('div','');cardTitle.id='mobile-cardtitle';
  const detail=button('詳細','選択した場所の詳細を開閉',()=>{
    const open=document.body.classList.toggle('details-open');detail.textContent=open?'畳む':'詳細';detail.setAttribute('aria-expanded',String(open));
  });detail.id='mobile-detail';detail.setAttribute('aria-expanded','false');
  cardBar.append(cardTitle,detail);$('#card').prepend(cardBar);
  const collapseDetails=()=>{
    document.body.classList.remove('details-open');detail.textContent='詳細';detail.setAttribute('aria-expanded','false');
  };
  new MutationObserver(()=>{
    cardTitle.textContent=$('#cardBody h2')?.textContent||'選択した場所';collapseDetails();
  }).observe($('#cardBody'),{childList:true});
  new MutationObserver(()=>{
    if(!document.body.classList.contains('has-card')&&document.body.classList.contains('details-open'))collapseDetails();
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
  cardTitle.textContent=$('#cardBody h2')?.textContent||'選択した場所';
  const exitClose=button('閉じる','出口一覧を閉じる',()=>$('#tExits').click());exitClose.id='mobile-exit-close';$('#exitPanel').prepend(exitClose);
  $('#tExits').addEventListener('click',closePanels);
  $('#exitPanel').addEventListener('click',e=>{if(e.target.closest('[data-exit],[data-yo]'))$('#tExits').click();});
  $('#results').addEventListener('click',e=>{if(e.target.closest('button')){closePanels();$('#q').blur();}});
  const credit=node('span','mobile-only','非公式・出口点の意味と精度は未確認。<br><a href="../sources.html">出典・利用条件</a> ／ <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> (<a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>)');$('#foot').append(credit);
  function sync() {
    layoutDirty=true;
    if(state.mode!=='3d')rotate=false;
    document.body.classList.toggle('mobile-3d',state.mode==='3d');
    move.setAttribute('aria-pressed',String(!rotate));turn.setAttribute('aria-pressed',String(rotate));
    move.textContent=rotate?'移動':'✓ 移動';turn.textContent=rotate?'✓ 回転・傾き':'回転・傾き';
    hint.textContent=state.mode==='3d'&&rotate?'1本指で回転・傾き ／ 2本指で拡大・縮小':'1本指で移動 ／ 2本指で拡大・縮小';
    if(small.matches) {
      const rotating=state.mode==='3d'&&rotate;
      controls.touches.ONE=rotating?THREE.TOUCH.ROTATE:THREE.TOUCH.PAN;
      controls.mouseButtons.LEFT=rotating?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
    } else {
      controls.touches.ONE=state.mode==='3d'?THREE.TOUCH.ROTATE:THREE.TOUCH.PAN;
      controls.mouseButtons.LEFT=state.mode==='3d'?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
      closePanels();
    }
    configureMotion(controls,state.mode,canvas.clientHeight,small.matches);
    controls.update();
  }
  for(const id of ['m2d','m3d']) $('#'+id).addEventListener('click',sync);
  small.addEventListener('change',sync);
  document.addEventListener('click',()=>{layoutDirty=true;});
  new ResizeObserver(()=>{
    layoutDirty=true;labelSizes.clear();
    configureMotion(controls,state.mode,canvas.clientHeight,small.matches);
    controls.update();
    const ratio=Math.min(devicePixelRatio,small.matches?1.5:2);
    if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
    resize();
  }).observe($('#view'));
  // Forward starts on labels to OrbitControls as well; a stationary tap keeps its label action.
  const labelTap = new TapGuard();const pending=new Map();
  $('#labels').addEventListener('pointerdown',e=>{
    const el=e.target.closest('button');if(!small.matches||!el||!el.onclick)return;
    e.preventDefault();pending.set(e.pointerId,el);
    const forwarded=new PointerEvent('pointerdown',{bubbles:false,pointerId:e.pointerId,pointerType:e.pointerType,clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,isPrimary:e.isPrimary});
    Object.defineProperty(forwarded,'labelOrigin',{value:true});canvas.dispatchEvent(forwarded);
  });
  canvas.addEventListener('pointerdown',e=>labelTap.down(e.pointerId,e.clientX,e.clientY));
  canvas.addEventListener('pointermove',e=>labelTap.move(e.pointerId,e.clientX,e.clientY));
  canvas.addEventListener('pointerup',e=>{
    const el=pending.get(e.pointerId),tap=labelTap.up(e.pointerId,e.clientX,e.clientY);pending.delete(e.pointerId);
    if(el&&tap)el.click();
  });
  canvas.addEventListener('pointercancel',e=>{labelTap.cancel(e.pointerId);pending.delete(e.pointerId);});
  sync();
  return {
    sync,
    prepareMode(mode){configureMotion(controls,mode,canvas.clientHeight,small.matches);},
    get active(){return small.matches;},
    layoutLabels(labels) {
      if(!small.matches)return;
      if(layoutDirty)measureLayout();
      const used=[...blockers];
      const priority=L=>state.selected===L.id?0:/exit|cand/.test(L.el.className)?1:!L.floor?2:/gate/.test(L.el.className)?3:4;
      const sorted=labels.filter(L=>L.projectedVisible&&!/head/.test(L.el.className)).sort((a,b)=>priority(a)-priority(b));
      const missing=[];
      for(const L of sorted){
        const key=L.el.className+'|'+L.el.textContent;
        if(labelSizes.get(L.el)?.key!==key){L.el.style.display='block';missing.push({L,key});}
      }
      // Batch measurements only when text/classes/viewport changed, never each pan frame.
      for(const {L,key} of missing)labelSizes.set(L.el,{key,w:L.el.offsetWidth,h:L.el.offsetHeight});
      const measured=sorted.map(L=>{const s=labelSizes.get(L.el),x=bounds.left+L.screenX,y=bounds.top+L.screenY;return {L,r:{left:x-s.w/2,right:x+s.w/2,top:y-s.h/2,bottom:y+s.h/2}};});
      const accepted=new Set();
      for(const {L,r} of measured) {
        if(L.small&&state.selected!==L.id)continue;
        const outside=r.left<bounds.left||r.right>bounds.right||r.top<bounds.top||r.bottom>bounds.bottom;
        const overlap=used.some(b=>r.left<b.right+4&&r.right>b.left-4&&r.top<b.bottom+4&&r.bottom>b.top-4);
        if(!outside&&!overlap){accepted.add(L);used.push(r);}
      }
      for(const L of labels){const desired=L.projectedVisible&&(/head/.test(L.el.className)||accepted.has(L))?'block':'none';if(L.el.style.display!==desired)L.el.style.display=desired;}
    }
  };
}
