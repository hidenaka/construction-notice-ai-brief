export function frameScheduler(draw, requestFrame) {
  let pending=false;
  return function invalidate() {
    if(pending)return;
    pending=true;
    requestFrame(time=>{pending=false;draw(time);});
  };
}
