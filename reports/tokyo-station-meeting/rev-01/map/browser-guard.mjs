// Installed only in the full-screen map document, never in reports/source pages.
export function installBrowserGuard(doc) {
 const owned=new Set(),listeners=[];
 const isMap=node=>Boolean(node?.closest?.('#view,#labels'));
 const cancel=e=>{if(e.cancelable)e.preventDefault();};
 const clear=()=>owned.clear();
 function onTouchStart(e){
  const active=new Set(Array.from(e.touches,t=>t.identifier));
  for(const id of owned)if(!active.has(id))owned.delete(id);
  for(const t of e.changedTouches||[])if(isMap(t.target||e.target))owned.add(t.identifier);else owned.delete(t.identifier);
  if(e.touches.length>1 && owned.size)cancel(e);
 }
 function onTouchMove(e){if(e.touches.length>1 && owned.size)cancel(e);}
 function onTouchEnd(e){for(const t of e.changedTouches||[])owned.delete(t.identifier);}
 const onHidden=()=>{if(doc.hidden)clear();};
 const onDouble=e=>{if(isMap(e.target))cancel(e);};
 const active={capture:true,passive:false},passive={capture:true,passive:true};
 function listen(target,type,fn,options){if(!target)return;target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));}
 // Safari GestureEvent is an additional native page-zoom path.
 for(const type of ['gesturestart','gesturechange'])listen(doc,type,cancel,active);
 listen(doc,'touchstart',onTouchStart,active);listen(doc,'touchmove',onTouchMove,active);
 for(const type of ['touchend','touchcancel'])listen(doc,type,onTouchEnd,passive);
 listen(doc,'dblclick',onDouble,active);
 listen(doc,'visibilitychange',onHidden,passive);listen(doc.defaultView,'blur',clear,passive);
 return ()=>{clear();for(const remove of listeners)remove();};
}
