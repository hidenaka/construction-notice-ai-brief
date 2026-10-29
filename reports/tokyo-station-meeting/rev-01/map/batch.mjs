// Only the unselectable, untransformed decorative boxes are combined.
// Selected floors and feature meshes retain their IDs and materials.
export function batchBoxes(THREE, group) {
  const buckets=new Map();
  for(const mesh of [...group.children]) {
    if(!mesh.isMesh||mesh.position.lengthSq()!==0||mesh.scale.toArray().some(x=>x!==1)||mesh.quaternion.toArray().some((x,i)=>x!==(i===3?1:0)))throw Error('Unexpected transformed decorative mesh');
    const key=mesh.material.color.getHex();
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(mesh);
  }
  group.clear();
  for(const meshes of buckets.values()) {
    const geometries=meshes.map(m=>m.geometry.index?m.geometry.toNonIndexed():m.geometry);
    const merged=new THREE.BufferGeometry();
    for(const key of ['position','normal']) {
      const count=geometries.reduce((n,g)=>n+g.attributes[key].array.length,0),values=new Float32Array(count);
      let offset=0;for(const g of geometries){values.set(g.attributes[key].array,offset);offset+=g.attributes[key].array.length;}
      merged.setAttribute(key,new THREE.BufferAttribute(values,3));
    }
    group.add(new THREE.Mesh(merged,meshes[0].material));
    for(const m of meshes){m.geometry.dispose();if(m.material!==meshes[0].material)m.material.dispose();}
  }
}
