import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

async function boot() {
// Presentation fixture only: no backend, account or campaign mutations.
const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(max-width:600px)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const state = { tiles: 412, points: 28, crystals: 6, reveal: false, radius: 25, targetRadius: 25, selected: null, dusk: true };
const HQ = new THREE.Vector3(-7, 0.65, 4);
const fogUniforms = {
  revealRadius: { value: 25 }, density: { value: 0.48 },
  center: { value: new THREE.Vector2(HQ.x, HQ.z) }, time: { value: 0 },
  color: { value: new THREE.Color(.055,.12,.15) },
  cloudA: { value: new THREE.Color(.11,.22,.26) },
  cloudB: { value: new THREE.Color(.23,.37,.39) },
};
const scene = new THREE.Scene();
scene.background = new THREE.Color('#19343d');
scene.fog = new THREE.FogExp2('#24434b', 0.0032);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.7 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('world').appendChild(renderer.domElement);
const camera = new THREE.OrthographicCamera(-48, 48, 36, -36, .1, 500);
camera.position.set(57, 57, 69);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-1, 0, 1);
controls.enableDamping = true;
controls.dampingFactor = .075;
controls.minZoom = .65;
controls.maxZoom = 2.7;
controls.maxPolarAngle = Math.PI / 2.7;
controls.minPolarAngle = .25;
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.touches.ONE = THREE.TOUCH.PAN;
controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
controls.screenSpacePanning = false;
const hemi = new THREE.HemisphereLight('#9bbbd1', '#183c35', .95);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#f5d7ab', 2.35);
sun.position.set(-36, 39, -24);
sun.castShadow = true;
sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 160 });
sun.shadow.normalBias = .08;
sun.shadow.bias = -.0002;
sun.shadow.radius = 4;
scene.add(sun);
const fill = new THREE.DirectionalLight('#a2d2eb', .9);
fill.position.set(20, 30, 45);
scene.add(fill);
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, .06).texture;
scene.environmentIntensity = .28;
room.dispose(); pmrem.dispose();

const mats = new Map();
const fogShader = `
 uniform vec2 mockCenter;
 uniform float mockRadius;
 uniform float mockDensity;
 uniform vec3 mockColor;
 varying vec2 mockWorld;
 float mockFog() {
   float distanceToEdge = length(mockWorld - mockCenter) - mockRadius;
   float softness = smoothstep(-3.0, 5.0, distanceToEdge);
   float wisps = 0.89 + .11 * sin(mockWorld.x * .17 + sin(mockWorld.y * .13));
   return softness * mockDensity * wisps;
 }
`;
function mistMaterial(mat) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.mockCenter = fogUniforms.center;
    shader.uniforms.mockRadius = fogUniforms.revealRadius;
    shader.uniforms.mockDensity = fogUniforms.density;
    shader.uniforms.mockColor = fogUniforms.color;
    shader.vertexShader = 'varying vec2 mockWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', 'mockWorld = (modelMatrix * vec4(transformed, 1.0)).xz;\n#include <project_vertex>');
    shader.fragmentShader = fogShader + shader.fragmentShader.replace('#include <opaque_fragment>', `
      float fogAmount = mockFog();
      float luminance = dot(outgoingLight, vec3(.2126,.7152,.0722));
      outgoingLight = mix(outgoingLight, vec3(luminance) * vec3(.86,1.02,1.08), fogAmount * .28);
      outgoingLight = mix(outgoingLight, mockColor, fogAmount * .83);
      #include <opaque_fragment>
    `);
  };
  mat.customProgramCacheKey = () => 'road-to-landscape-mist';
  return mat;
}
function material(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, mistMaterial(new THREE.MeshStandardMaterial({ color, roughness: .86, ...extra })));
  return mats.get(key);
}
function mesh(geo, mat, position, parent = scene) {
  const object = new THREE.Mesh(geo, mat);
  if (position) object.position.set(...position);
  object.castShadow = true; object.receiveShadow = true;
  parent.add(object); return object;
}
function box(w,h,d,color,x,y,z,parent=scene,extra={}) { return mesh(new THREE.BoxGeometry(w,h,d), material(color,extra),[x,y,z],parent); }
let seed = 32917;
function random() { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }
const riverX = z => 29 + 5*Math.sin(z*.048) + 2*Math.cos(z*.105);
function height(x,z) {
  const noise = Math.sin(x*.055+z*.023)*1.2 + Math.cos(z*.081-x*.02)*.7 + Math.sin((x+z)*.17)*.14;
  let h = .9 + Math.max(0, -x-28)*.052 + noise;
  const foundation = Math.max(Math.abs(x-HQ.x)/14,Math.abs(z-HQ.z)/13);
  h = THREE.MathUtils.lerp(.65,h,THREE.MathUtils.smoothstep(foundation,1,1.65));
  const bank = Math.abs(x-riverX(z));
  if(bank<5)h=-1.3;
  else if(bank<8)h=THREE.MathUtils.lerp(-.8,h,(bank-5)/3);
  return h;
}
const terrainGeo = new THREE.PlaneGeometry(260,260,160,160);
terrainGeo.rotateX(-Math.PI/2);
const pos = terrainGeo.getAttribute('position');
const colors=[]; const green=new THREE.Color();
for(let i=0;i<pos.count;i++) {
  const x=pos.getX(i),z=pos.getZ(i),h=height(x,z); pos.setY(i,h);
  const bank=Math.abs(x-riverX(z));
green.set(bank<7.8?'#8f9e96':'#456958');
  const tint=.94+.06*Math.sin(x*.19)*Math.cos(z*.15);
  if(bank>8)green.lerp(new THREE.Color('#688c71'),Math.max(0,Math.sin(x*.065+z*.09))*.26);
  green.multiplyScalar(tint);colors.push(green.r,green.g,green.b);
}
terrainGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
terrainGeo.computeVertexNormals();
const terrain = mesh(terrainGeo,mistMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:1})));terrain.castShadow=false;

const waterPoints=[],waterIndex=[];
for(let i=0;i<=120;i++) {const z=-140+i*280/120,x=riverX(z);waterPoints.push(x-5.3,.09,z,x+5.3,.09,z);if(i<120){const a=i*2;waterIndex.push(a,a+2,a+1,a+1,a+2,a+3);}}
const waterGeo=new THREE.BufferGeometry();waterGeo.setAttribute('position',new THREE.Float32BufferAttribute(waterPoints,3));waterGeo.setIndex(waterIndex);waterGeo.computeVertexNormals();
mesh(waterGeo,material('#27565f',{roughness:.2,metalness:.25})).castShadow=false;
for(let i=0;i<28;i++) {const z=-85+i*6.3,x=riverX(z),w=2+random()*5;const ripple=box(w,.012,.025,'#759ea4',x+(random()-.5)*5,.11,z);ripple.castShadow=false;}

// A small campus integrates the authored HQ into the environment.
box(26,.18,25,'#708586',HQ.x,.57,HQ.z);
box(27,.08,26,'#a0b3aa',HQ.x,.48,HQ.z);
box(17,.025,5.1,'#849996',HQ.x,.7,20);
box(29,.12,4.3,'#879a94',15,.68,16.7);
const bridgeX=riverX(16.7);
box(17,.44,5.1,'#b0beb4',bridgeX,.7,16.7);
for(const z of [14.35,19.05]) {
  box(17,.13,.13,'#556e70',bridgeX,2.05,z);
  for(let x=bridgeX-7;x<bridgeX+9;x+=3.5)box(.13,1.1,.13,'#708180',x,1.48,z);
}
for(let z=-5;z<15;z+=3.5) {
  box(.7,.45,2.3,'#c5c8b5',HQ.x+12.4,.95,z);
  box(.62,.35,2.13,'#497a57',HQ.x+12.4,1.33,z);
}
for(const side of [-1,1])for(let i=0;i<5;i++) {
  box(1.25,.5,.55,'#bdc6b3',HQ.x+side*10.5,1.0,17+i*1.1);
  box(1.1,.45,.48,'#517e58',HQ.x+side*10.5,1.45,17+i*1.1);
}

// Restrained architectural lighting belongs to the campus, not reward locations.
const lamps = new THREE.Group();scene.add(lamps);
const pathLightMaterial = new THREE.MeshStandardMaterial({ color:'#abc6ba', emissive:'#93c8c2', emissiveIntensity:1.2, roughness:.5 });
const warmLightMaterial = new THREE.MeshStandardMaterial({ color:'#f0e2bf', emissive:'#ffce80', emissiveIntensity:1.5, roughness:.55 });
const campusLights=[];
for(const [x,z] of [[-19.5,-7.8],[5.5,-7.8],[-19.5,15.8],[5.5,15.8]]){
  box(.14,2.5,.14,'#334f57',x,1.9,z,lamps);
  mesh(new THREE.BoxGeometry(.23,.24,.23),warmLightMaterial,[x,3.2,z],lamps);
  const light=new THREE.PointLight('#f9d2a0',30,9,2);light.position.set(x,3,z);lamps.add(light);campusLights.push(light);
}
for(let x=8;x<bridgeX+9;x+=3.4)for(const z of [14.8,18.6]){
  box(.13,.54,.13,'#536b70',x,1,z,lamps);
  mesh(new THREE.BoxGeometry(.17,.1,.17),pathLightMaterial,[x,1.3,z],lamps);
}
for(const x of [HQ.x-12.7,HQ.x+12.7]){
  const light=mesh(new THREE.BoxGeometry(.045,.035,23),pathLightMaterial,[x,.71,HQ.z],lamps);
  light.castShadow=false;
}

const trunkGeo=new THREE.CylinderGeometry(.18,.25,2.5,7);
const crownGeo=new THREE.IcosahedronGeometry(1,1);
const treeBark=material('#656d60'),leaves=['#355a49','#416b55','#53795a','#345748','#5e7e60'].map(c=>material(c));
function tree(x,z,scale=1){
  const y=height(x,z),g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(scale);scene.add(g);
  mesh(trunkGeo,treeBark,[0,1.2,0],g);
  const c=mesh(crownGeo,leaves[Math.floor(random()*leaves.length)],[0,3.7,0],g);c.scale.set(1.8,2.3,1.65);c.rotation.y=random()*6;
  const c2=mesh(crownGeo,leaves[Math.floor(random()*leaves.length)],[.7,3.1,-.25],g);c2.scale.set(1.1,1.4,1.2);
}
for(let i=0;i<235;i++) {
  const x=(random()-.5)*168,z=(random()-.5)*168;
  if(Math.abs(x-HQ.x)<17&&Math.abs(z-HQ.z)<20)continue;
  if(Math.abs(x-riverX(z))<9||Math.abs(z-16.7)<4&&x>-2&&x<44)continue;
  if(Math.hypot(x-20,z+20)<4||Math.hypot(x+32,z+12)<4)continue;
  tree(x,z,.72+random()*.63);
}
for(const [x,z] of [[-21,19],[-19,-12],[8,-11],[9,20]])tree(x,z,.8);
const rockGeo=new THREE.IcosahedronGeometry(1,0);
for(let i=0;i<55;i++) {const z=(random()-.5)*170,x=riverX(z)+(random()>.5?1:-1)*(6.2+random()*3);const r=mesh(rockGeo,material(i%2?'#8b9b90':'#a6ab9b'),[x,height(x,z)+.3,z]);r.scale.set(1+random(),.5+random()*.5,.8+random());r.rotation.y=random()*6;}

const edgePoints=[];
for(let i=0;i<180;i++) {const a=i/180*Math.PI*2,r=18.6+Math.sin(a*5)*.8;const x=HQ.x+Math.cos(a)*r,z=HQ.z+Math.sin(a)*r;edgePoints.push(new THREE.Vector3(x,height(x,z)+.13,z));}
const border=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(edgePoints),new THREE.LineBasicMaterial({color:'#84c8d0',transparent:true,opacity:.8}));scene.add(border);
const landTint=mesh(new THREE.CircleGeometry(18.2,100),new THREE.MeshBasicMaterial({color:'#66bdd0',transparent:true,opacity:.04,depthWrite:false}),[HQ.x,.7,HQ.z]);landTint.rotation.x=-Math.PI/2;landTint.castShadow=false;

const mistMaterialPlane = new THREE.ShaderMaterial({
 transparent:true,depthWrite:false,side:THREE.DoubleSide,
 uniforms:{...fogUniforms},
 vertexShader:'varying vec2 p; void main(){vec4 w=modelMatrix*vec4(position,1.0);p=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}',
 fragmentShader:`uniform vec2 center;uniform float revealRadius;uniform float density;uniform float time;uniform vec3 cloudA;uniform vec3 cloudB;varying vec2 p;
 float noise(vec2 q){return .5+.22*sin(q.x*.19+sin(q.y*.13))+.18*cos(q.y*.18+sin(q.x*.11));}
 void main(){float edge=smoothstep(revealRadius-3.,revealRadius+6.,length(p-center));float clouds=noise(p+vec2(time*.13,time*.06));float a=edge*density*(.26+.22*clouds);gl_FragColor=vec4(mix(cloudA,cloudB,clouds),a);#include <colorspace_fragment>}`.replace('#include','\n#include')
});
const mist=mesh(new THREE.PlaneGeometry(260,260),mistMaterialPlane,[0,3.2,0]);mist.rotation.x=-Math.PI/2;mist.castShadow=false;mist.receiveShadow=false;mist.renderOrder=4;

function uniStop(){
 const g=new THREE.Group();g.position.set(20,height(20,-20),-20);
 box(3,.3,3,'#b3bfba',0,.1,0,g);box(.35,3.3,.35,'#6c8385',0,1.8,0,g);
 const ring=mesh(new THREE.TorusGeometry(1,.13,8,32),material('#8ce9ee',{emissive:'#2d8b99',emissiveIntensity:.5}),[0,3.6,0],g);ring.rotation.y=.5;
 box(1.1,.7,1,'#516b70',0,1.1,0,g);g.visible=false;scene.add(g);return g;
}
function chest(){const g=new THREE.Group();g.position.set(-32,height(-32,-12)+.1,-12);box(1.7,.85,1.1,'#887047',0,.5,0,g);box(1.76,.28,1.15,'#af9566',0,1.06,0,g);for(const x of [-.59,.59])box(.12,1.04,1.18,'#c7c3a3',x,.64,0,g);box(.32,.4,.07,'#82dbdc',0,.75,.6,g);g.visible=false;scene.add(g);return g;}
const stop=uniStop(),treasure=chest();
const selectOutline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.65,0,-.65),new THREE.Vector3(.65,0,-.65),new THREE.Vector3(.65,0,.65),new THREE.Vector3(-.65,0,.65)]),new THREE.LineBasicMaterial({color:'#d0fcff',transparent:true,opacity:.9}));selectOutline.visible=false;scene.add(selectOutline);
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
let pointerStart=null,lastFocus=null,toastTimer;
renderer.domElement.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};});
renderer.domElement.addEventListener('pointerup',e=>{
 if(!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>7)return;
 ndc.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(ndc,camera);
 const hit=ray.intersectObject(terrain)[0];if(!hit)return;
 const p=hit.point;state.selected={x:Math.round(p.x+500),z:Math.round(p.z+500)};
 $('coordinates').textContent=`${state.selected.x} · ${state.selected.z}`;
 selectOutline.position.set(p.x,height(p.x,p.z)+.12,p.z);selectOutline.visible=true;
 if(stop.visible&&p.distanceTo(stop.position)<3)openDialog('stop');
 else if(treasure.visible&&p.distanceTo(treasure.position)<3)openDialog('chest');
});
function toast(text){$('toast').textContent=text;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);}
function toggleTools(open){$('tools').hidden=!open;$('tools-toggle').setAttribute('aria-expanded',String(open));$('tools-toggle').setAttribute('aria-label',open?'Đóng công cụ':'Mở công cụ');}
$('tools-toggle').onclick=()=>toggleTools($('tools').hidden);
$('close-tools').onclick=()=>{toggleTools(false);$('tools-toggle').focus();};
$('fog-density').oninput=e=>{fogUniforms.density.value=Number(e.target.value)/100;};
$('lighting').onclick=()=>{
 state.dusk=!state.dusk;
 const dusk=state.dusk;
 hemi.color.set(dusk?'#9bbbd1':'#e8f5ff');hemi.groundColor.set(dusk?'#183c35':'#4d6252');
 sun.color.set(dusk?'#f5d7ab':'#fff0d2');sun.intensity=dusk?2.35:2.15;
 fill.intensity=dusk?.9:.15;
 scene.environmentIntensity=dusk?.28:.38;
 scene.background.set(dusk?'#19343d':'#728e8e');scene.fog.color.set(dusk?'#24434b':'#9fb8b5');scene.fog.density=dusk?.0032:.0018;
 fogUniforms.color.value.setRGB(...(dusk?[.055,.12,.15]:[.24,.36,.39]));
 fogUniforms.cloudA.value.setRGB(...(dusk?[.11,.22,.26]:[.60,.73,.73]));
 fogUniforms.cloudB.value.setRGB(...(dusk?[.23,.37,.39]:[.77,.84,.81]));
 lamps.visible=dusk;
 $('lighting').textContent=dusk?'Chạng vạng':'Ban ngày';$('lighting').setAttribute('aria-pressed',String(dusk));
};
$('home').onclick=()=>{controls.target.copy(HQ).setY(0);camera.position.copy(HQ).add(new THREE.Vector3(62,66,72));camera.zoom=1;camera.updateProjectionMatrix();if(mobile)toggleTools(false);};
$('zoom-in').onclick=()=>{camera.zoom=Math.min(2.7,camera.zoom*1.18);camera.updateProjectionMatrix();};
$('zoom-out').onclick=()=>{camera.zoom=Math.max(.65,camera.zoom/1.18);camera.updateProjectionMatrix();};
$('rotate').onclick=()=>{const d=camera.position.clone().sub(controls.target);d.applyAxisAngle(new THREE.Vector3(0,1,0),Math.PI/4);camera.position.copy(controls.target).add(d);};
$('explore').onclick=()=>{
 if(state.reveal)return;
 state.reveal=true;state.targetRadius=44;state.points--;state.tiles++;
 $('tile-count').innerHTML=state.tiles+' <span>ô</span>';
 $('explore').disabled=true;$('explore').innerHTML='<span>Đã mở vùng mẫu</span><span>✓</span>';
 toggleTools(false);toast('Vùng mới đã mở · −1 điểm');
};
$('reset').onclick=()=>{state.reveal=false;state.targetRadius=25;state.tiles=412;state.points=28;$('tile-count').innerHTML='412 <span>ô</span>';$('explore').disabled=false;$('explore').innerHTML='<span>Mở vùng khám phá mẫu</span><span>−1 điểm ↗</span>';stop.visible=false;treasure.visible=false;toast('Đã đặt lại cảnh mẫu');};
function openDialog(kind){
 toggleTools(false);lastFocus=document.activeElement;
 const titles={student:['SINH VIÊN','Nguyễn Minh Anh','Đại học Bách khoa TP.HCM · HCMUT'],progress:['TIẾN TRÌNH','Mỗi bước, một vùng mới.','Thành tích minh hoạ của trường bạn'],inventory:['HÀNH TRANG','Sẵn sàng lên đường.','Vật phẩm và số dư minh hoạ'],ranking:['BẢNG XẾP HẠNG','Cùng trường tiến lên.','Dữ liệu minh hoạ cho bản xem trước'],stop:['TRẠM TIẾP TẾ','UniStop · Aspire','Trạm chỉ xuất hiện sau khi khám phá'],chest:['KHÁM PHÁ MỚI','Rương Aspire','Rương chỉ xuất hiện sau khi khám phá']};
 const [k,t,s]=titles[kind];$('dialog-kicker').textContent=k;$('dialog-title').textContent=t;$('dialog-subtitle').textContent=s;
 const stat=(a,b)=>`<div class="stat"><small>${a}</small><strong>${b}</strong></div>`;
 if(kind==='ranking')$('dialog-content').innerHTML='<div class="rank-row"><b>01 · HCMUT</b><span>'+state.tiles+' ô</span></div><div class="rank-row"><b>02 · OU</b><span>386 ô</span></div><div class="rank-row"><b>03 · DTU</b><span>351 ô</span></div><p class="ranking-note">BXH được mở khi cần; bản đồ luôn là không gian chính.</p>';
 else if(kind==='stop'||kind==='chest')$('dialog-content').innerHTML='<p>Minh hoạ cách mở cửa sổ công trình. Bản xem trước không tiêu vật phẩm hoặc phát thưởng thật.</p>';
 else $('dialog-content').innerHTML='<div class="stat-grid">'+stat('Điểm khả dụng',state.points)+stat('Tinh thể',state.crystals)+stat(kind==='inventory'?'Chìa khoá Aspire':'Ô tri thức',kind==='inventory'?'2':state.tiles)+stat(kind==='inventory'?'Bản đồ kho báu':'Xếp hạng trường',kind==='inventory'?'1':'#1')+'</div><p class="ranking-note">Bản xem trước giao diện · số liệu minh hoạ.</p>';
 $('scrim').hidden=false;$('close-dialog').focus();
}
function closeDialog(){ $('scrim').hidden=true;lastFocus?.focus(); }
$('student').onclick=()=>openDialog('student');$('progress').onclick=()=>openDialog('progress');$('inventory').onclick=()=>openDialog('inventory');$('ranking').onclick=()=>openDialog('ranking');$('close-dialog').onclick=closeDialog;
$('scrim').onclick=e=>{if(e.target===$('scrim'))closeDialog();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeDialog();toggleTools(false);}if(e.key.toLowerCase()==='t'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.matches('input,textarea')){if($('scrim').hidden)toggleTools($('tools').hidden);}if(!$('scrim').hidden&&e.key==='Tab'){const a=$('dialog').querySelectorAll('button,[href],input');if(!a.length)return;const first=a[0],last=a[a.length-1];if(e.shiftKey&&document.activeElement===first){last.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first.focus();e.preventDefault();}}});
document.addEventListener('pointerdown',e=>{if(!$('tools').hidden&&!e.target.closest('.panel')&&!e.target.closest('.hud'))toggleTools(false);});
function size(){const aspect=innerWidth/innerHeight;const half=innerWidth<600?47:39;camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);}
addEventListener('resize',size);size();
function label(id,p,show=true){const el=$(id);el.hidden=!show;if(!show)return;const q=p.clone().project(camera);el.hidden=q.z>1||Math.abs(q.x)>1.1||Math.abs(q.y)>1.1;el.style.left=(q.x*.5+.5)*innerWidth+'px';el.style.top=(-q.y*.5+.5)*innerHeight+'px';}
const encoded=$('hq-data').textContent.trim();const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
try {
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer,'');
 const model=gltf.scene;model.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(model);const dim=bounds.getSize(new THREE.Vector3());
 model.scale.setScalar(23/Math.max(dim.x,dim.z));model.updateMatrixWorld(true);
 bounds.setFromObject(model);const center=bounds.getCenter(new THREE.Vector3());model.position.set(HQ.x-center.x,HQ.y-bounds.min.y,HQ.z-center.z);
 model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;for(const mat of Array.isArray(o.material)?o.material:[o.material]){if(mat.metalness>.35){mat.metalness=.25;mat.roughness=Math.max(.4,mat.roughness);}mistMaterial(mat);}}});
 scene.add(model);
} catch(error) {console.error(error);$('loading').querySelector('div').textContent='Không thể tải model HQ. Hãy mở bằng trình duyệt hỗ trợ WebGL.';}
$('loading').style.opacity='0';setTimeout(()=>$('loading').remove(),600);
let last=performance.now();
function animate(now){const dt=Math.min((now-last)/1000,.05);last=now;state.radius=THREE.MathUtils.damp(state.radius,state.targetRadius,reducedMotion?1000:2.2,dt);fogUniforms.revealRadius.value=state.radius;fogUniforms.time.value=reducedMotion?0:now*.001;
 stop.visible=state.radius>Math.hypot(stop.position.x-HQ.x,stop.position.z-HQ.z)+1;
 treasure.visible=state.radius>Math.hypot(treasure.position.x-HQ.x,treasure.position.z-HQ.z)+1;
 controls.update();renderer.render(scene,camera);
 label('hq-label',new THREE.Vector3(HQ.x,HQ.y+1,HQ.z+13));
 label('stop-label',stop.position.clone().add(new THREE.Vector3(0,5,0)),stop.visible);
 label('chest-label',treasure.position.clone().add(new THREE.Vector3(0,2,0)),treasure.visible);
 requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
}
boot().catch(error => {
  console.error(error);
  const load = document.getElementById('loading');
  if (load) load.querySelector('div').textContent = 'Trình duyệt chưa khởi tạo được WebGL. Hãy thử Chrome hoặc Edge với tăng tốc đồ hoạ.';
});
