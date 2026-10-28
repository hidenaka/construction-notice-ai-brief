export function configureMotion(controls, mode, height, mobile) {
  controls.mapPlanePanning=mobile && mode==='3d';
  controls.screenSpacePanning=mode!=='3d'||!mobile;
  controls.zoomToCursor=mobile;
  controls.rotateSpeed=mobile?height/1440:1; // 100 CSS px = 25°, independent of card/orientation.
  controls.minPolarAngle=mobile&&mode==='3d'?Math.PI/12:0;
  controls.maxPolarAngle=mobile&&mode==='3d'?65*Math.PI/180:100*Math.PI/180;
  const distance=heightMetres=>heightMetres/(2*Math.tan(Math.PI/8));
  controls.minDistance=mobile?distance(35):0;
  controls.maxDistance=mobile?distance(3000):Infinity;
  controls.minZoom=mobile?2/3000:0;
  controls.maxZoom=mobile?2/35:Infinity;
}
