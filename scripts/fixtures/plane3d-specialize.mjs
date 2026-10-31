import {rect3dSpecialize} from './rect3d-specialize.mjs';

export function planeGeometry(dims,normal,options={}) {
  if(!Array.isArray(dims)||dims.length!==3||!dims.every(n=>Number.isSafeInteger(n)&&n>1))throw new Error('invalid plane texture dimensions');
  if(!Array.isArray(normal)||normal.length!==3||!normal.every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=8)||!normal.some(Boolean))throw new Error('invalid integer plane normal');
  const gcd=(a,b)=>b?gcd(b,a%b):Math.abs(a);
  if(normal.reduce((a,b)=>gcd(a,b),0)!==1)throw new Error('plane normal must be primitive');
  const capacity=dims.reduce((a,b)=>a*b,1),count=options.count??capacity,boundary=options.boundary??'clamp';
  if(!Number.isSafeInteger(count)||count<32||count>capacity||capacity>0x3fffffff||!['clamp','periodic'].includes(boundary))throw new Error('invalid plane count or boundary');
  const index=c=>c[0]+dims[0]*(c[1]+dims[1]*c[2]);
  const coordinate=j=>[j%dims[0],Math.floor(j/dims[0])%dims[1],Math.floor(j/(dims[0]*dims[1]))];
  const neighbour=(c,delta)=>{
    let j=index(c)+normal.reduce((s,m,a)=>s+m*delta[a],0);
    j=boundary==='periodic'?((j%count)+count)%count:Math.max(0,Math.min(count-1,j));
    return coordinate(j);
  };
  return {dims:[...dims],normal:[...normal],count,capacity,boundary,index,coordinate,neighbour,
    normalPlaneSpacing:dx=>dx/Math.hypot(...normal)};
}

// Exact integer-plane quotient of a 3D lattice. Only neighbour coordinates,
// texture bounds and topology change; every floating-point equation is retained.
export function plane3dSpecialize(source,dims,normal,options={}) {
  const g=planeGeometry(dims,normal,options),rect=rect3dSpecialize(source,dims);
  const replacements=[];
  const expression=/cid3\s*\(\s*P\s*,/g;
  let result='',last=0,match;
  while((match=expression.exec(rect))!==null){
    const open=rect.indexOf('(',match.index);let depth=1,end=open+1;
    for(;end<rect.length&&depth;end++){if(rect[end]==='(')depth++;else if(rect[end]===')')depth--;}
    if(depth)throw new Error('unterminated production neighbour expression');
    const argument=rect.slice(match.index+match[0].length,end-1).trim();
    let delta;
    if(argument==='c')delta='vec3i(0)';
    else{
      const m=/^c\s*([+-])\s*([\s\S]+)$/.exec(argument);
      if(!m)throw new Error('unreviewed production neighbour base: '+argument);
      delta=m[1]==='-'?`-(${m[2]})`:`(${m[2]})`;
    }
    const old=rect.slice(match.index,end),replacement=`planeNeighbour(c, ${delta})`;
    result+=rect.slice(last,match.index)+replacement;last=end;expression.lastIndex=end;
    replacements.push({original:old,replacement});
  }
  result+=rect.slice(last);
  if(replacements.length<6||replacements.length>100||expression.test(result))throw new Error('production neighbour inventory changed');
  // Packed row/slice faces are not physical faces of the rational-plane
  // quotient. Periodic planes have none; clamp means constant plane-end ghosts.
  // Retain the normal-flux arithmetic while disabling rectangular reflections.
  let originalFaceBlock=null,quotientFaceBlock=null;
  const begin='// QUANT-NORMAL-FLUX-BEGIN',end='// QUANT-NORMAL-FLUX-END';
  if(result.includes(begin)){
    if(result.split(begin).length!==2||result.split(end).length!==2)throw new Error('normal-flux block changed');
    const from=result.indexOf(begin),to=result.indexOf(end)+end.length;
    originalFaceBlock=result.slice(from,to);quotientFaceBlock=originalFaceBlock;
    for(const axis of ['x','y','z'])for(const face of [`gid.${axis} == fluxEdge.${axis}`,`gid.${axis} == 0u`]){
      if(quotientFaceBlock.split(face).length!==2)throw new Error('normal-flux face inventory changed');
      quotientFaceBlock=quotientFaceBlock.replace(face,'false');
    }
    result=result.slice(0,from)+quotientFaceBlock+result.slice(to);
  }
  const guard=`any(gid >= vec3u(${dims.map(n=>`${n}u`).join(', ')}))`;
  if(result.split(guard).length!==2)throw new Error('plane guard changed');
  const newGuard=`(${guard} || planeIndex(vec3i(gid)) >= ${g.count})`;
  result=result.replace(guard,newGuard);
  const helper=`
fn planeIndex(c: vec3i) -> i32 { return c.x + ${dims[0]} * (c.y + ${dims[1]} * c.z); }
fn planeNeighbour(c: vec3i, d: vec3i) -> vec3i {
  let shift = ${normal[0]} * d.x + ${normal[1]} * d.y + ${normal[2]} * d.z;
  let raw = planeIndex(c) + shift;
  let j = ${g.boundary==='periodic'?`((raw % ${g.count}) + ${g.count}) % ${g.count}`:`clamp(raw, 0, ${g.count-1})`};
  return vec3i(j % ${dims[0]}, (j / ${dims[0]}) % ${dims[1]}, j / ${dims[0]*dims[1]});
}
`;
  const anchor='fn hash3(';
  if(result.split(anchor).length!==2)throw new Error('plane helper insertion point changed');
  result=result.replace(anchor,helper+'\n'+anchor);
  // Prove the specialization can be reversed to the exact rectangular source.
  let reverse=result.replace(helper+'\n','').replace(newGuard,guard);
  if(quotientFaceBlock)reverse=reverse.replace(quotientFaceBlock,originalFaceBlock);
  for(const {original,replacement} of replacements)reverse=reverse.replace(replacement,original);
  if(reverse!==rect)throw new Error('plane specialization changed non-geometry source');
  return {code:result,geometry:{dims:g.dims,normal:g.normal,count:g.count,boundary:g.boundary},
    replacements,rectangularFluxFacesDisabled:!!originalFaceBlock,geometryOnlyRoundtrip:true};
}
