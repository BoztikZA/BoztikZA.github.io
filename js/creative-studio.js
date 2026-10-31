(() => {
'use strict';
const $ = (s,r=document) => r.querySelector(s);
const nav=[...document.querySelectorAll('.studio-nav')], panels=[...document.querySelectorAll('.studio-panel')];
nav.forEach(b=>b.addEventListener('click',()=>{nav.forEach(x=>{x.classList.toggle('is-active',x===b);x.removeAttribute('aria-current')});b.setAttribute('aria-current','page');panels.forEach(p=>p.hidden=p.id!=='panel-'+b.dataset.panel)}));
const input=$('#studio-file'),zone=$('#drop-zone'),results=$('#inspection-results'),status=$('#inspect-status');
let objectUrl=null,palette=[];
function say(t){status.textContent=t}
function clear(){if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;palette=[];input.value='';results.hidden=true;say('')}
$('#clear-image').addEventListener('click',clear);
input.addEventListener('change',()=>{if(input.files[0])inspect(input.files[0])});
zone.addEventListener('click',e=>{if(e.target.tagName!=='LABEL')input.click()});
zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}});
['dragenter','dragover'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.add('is-dragging')}));
['dragleave','drop'].forEach(t=>zone.addEventListener(t,e=>{e.preventDefault();zone.classList.remove('is-dragging')}));
zone.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)inspect(f)});
function inspect(file){
 if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type))return say('Choose a JPG, PNG, WebP, GIF or AVIF image.');
 if(file.size>25*1024*1024)return say('This file is larger than 25 MB. Try a smaller copy.');
 say('Reading image locally…');const url=URL.createObjectURL(file),img=new Image();
 img.onload=()=>{try{
  const scale=Math.min(1,900/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Canvas unavailable');
  ctx.drawImage(img,0,0,c.width,c.height);const data=ctx.getImageData(0,0,c.width,c.height).data,stats=getStats(data);palette=getPalette(data);
  const ratio=img.naturalWidth/img.naturalHeight,metrics=[
   ['Dimensions',img.naturalWidth.toLocaleString()+' × '+img.naturalHeight.toLocaleString(),'Original pixel dimensions'],
   ['Aspect ratio',simplify(img.naturalWidth,img.naturalHeight),ratio.toFixed(2)+':1'],
   ['File size',bytes(file.size),file.type||'Image file'],
   ['Brightness',Math.round(stats.brightness*100)+'%',stats.brightness<.3?'Dark tendency':stats.brightness>.72?'Bright tendency':'Balanced range'],
   ['Contrast',Math.round(stats.contrast*100)+'%','Sampled tonal spread'],
   ['Pixel count',(img.naturalWidth*img.naturalHeight/1e6).toFixed(2)+' MP','Sampled at '+c.width+' × '+c.height]
  ];
  $('#image-preview').src=url;$('#file-name').textContent=file.name;$('#file-summary').textContent=(file.type||'Image')+' · '+bytes(file.size);
  $('#metrics-grid').innerHTML=metrics.map(m=>'<div class="metric"><span>'+m[0]+'</span><strong>'+m[1]+'</strong><small>'+m[2]+'</small></div>').join('');
  $('#palette-swatches').innerHTML=palette.map(col=>'<button class="palette-swatch" type="button" data-colour="'+col+'"><i style="background:'+col+'"></i>'+col+'</button>').join('');
  $('#palette-swatches').querySelectorAll('[data-colour]').forEach(b=>b.addEventListener('click',()=>copy(b.dataset.colour).then(()=>say(b.dataset.colour+' copied.'))));
  results.hidden=false;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=url;say('Analysis complete. Your original image was not uploaded.');
 }catch(e){URL.revokeObjectURL(url);say('This image could not be analysed. Try a smaller or different image.')}};
 img.onerror=()=>{URL.revokeObjectURL(url);say('The image could not be opened. It may be damaged or unsupported.')};img.src=url;
}
function getPalette(d){const map=new Map(),step=Math.max(1,Math.floor(d.length/4/12000));for(let i=0;i<d.length;i+=step*4){if(d[i+3]<128)continue;const rgb=[0,1,2].map(n=>Math.min(255,Math.round(d[i+n]/32)*32));const h='#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();map.set(h,(map.get(h)||0)+1)}return [...map].sort((a,b)=>b[1]-a[1]).slice(0,6).map(x=>x[0])}
function getStats(d){let s=0,s2=0,n=0;for(let i=0;i<d.length;i+=16){if(d[i+3]<128)continue;const y=(d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722)/255;s+=y;s2+=y*y;n++}const m=n?s/n:.5;return{brightness:m,contrast:Math.min(1,Math.sqrt(Math.max(0,n?s2/n-m*m:0))*2)}}
function gcd(a,b){return b?gcd(b,a%b):a}function simplify(w,h){const d=gcd(w,h);return(w/d)+':'+(h/d)}function bytes(n){return n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB'}
async function copy(v){try{await navigator.clipboard.writeText(v)}catch(e){const t=document.createElement('textarea');t.value=v;document.body.append(t);t.select();document.execCommand('copy');t.remove()}}
$('#copy-palette').addEventListener('click',()=>{if(palette.length)copy(palette.join(', ')).then(()=>say('Colour palette copied.'))});
const promptIds=['subject','style','light','composition','mood','details','avoid'];
function build(){const v=id=>$('#prompt-'+id).value.trim(),p=[];if(v('subject'))p.push(v('subject'));if(v('style'))p.push('Visual direction: '+v('style')+'.');if(v('light'))p.push('Lighting: '+v('light')+'.');if(v('composition'))p.push('Composition: '+v('composition')+'.');if(v('mood'))p.push('Mood: '+v('mood')+'.');if(v('details'))p.push('Important details: '+v('details')+'.');if(v('avoid'))p.push('Avoid: '+v('avoid')+'.');$('#prompt-output').textContent=p.length?p.join(' '):'Add a subject above to start building your prompt.'}
promptIds.forEach(id=>$('#prompt-'+id).addEventListener('input',build));
$('#copy-prompt').addEventListener('click',()=>{const v=$('#prompt-output').textContent;if(v.startsWith('Add a subject'))return;copy(v).then(()=>{const b=$('#copy-prompt');b.textContent='Copied';setTimeout(()=>b.textContent='Copy prompt',1300)})});
const w=$('#ratio-width'),h=$('#ratio-height');function ratio(){const a=Math.round(Number(w.value)),b=Math.round(Number(h.value));if(!Number.isFinite(a)||!Number.isFinite(b)||!a||!b||a<1||b<1||a>100000||b>100000){$('#ratio-output').textContent='—';$('#ratio-decimal').textContent='Enter valid dimensions';return}$('#ratio-output').textContent=simplify(a,b);$('#ratio-decimal').textContent=(a/b).toFixed(3)+':1'}[w,h].forEach(x=>x.addEventListener('input',ratio));
document.querySelectorAll('[data-w][data-h]').forEach(b=>b.addEventListener('click',()=>{w.value=b.dataset.w;h.value=b.dataset.h;ratio()}));
$('#guidance-search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();$('#guidance-list').querySelectorAll('article').forEach(a=>a.hidden=!!q&&!(a.dataset.terms+' '+a.textContent).toLowerCase().includes(q))});
window.addEventListener('beforeunload',()=>{if(objectUrl)URL.revokeObjectURL(objectUrl)});\nlet installPrompt=null;const installButton=$('#install-app');window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installButton.hidden=false});installButton.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;installButton.hidden=true});window.addEventListener('appinstalled',()=>{installButton.hidden=true;installPrompt=null});
})();