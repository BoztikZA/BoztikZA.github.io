/* Creative Toolkit guide interactions. No libraries, network calls or storage. */
(function(){
'use strict';
var page=document.querySelector('[data-guide-body]');if(!page)return;
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Add a feature by authoring an H2 with a unique id and its content in the guide HTML.
   This wrapper applies the shared visual module automatically; no JS edit is needed. */
var headings=Array.prototype.slice.call(page.querySelectorAll(':scope > h2[id]'));
headings.forEach(function(heading,index){
 var section=document.createElement('section');section.className='tk-guide-module';section.setAttribute('data-guide-module','');section.setAttribute('data-guide-step',String(index+1));
 heading.parentNode.insertBefore(section,heading);var node=heading;
 while(node&&!(node!==heading&&node.tagName==='H2')){var next=node.nextSibling;section.appendChild(node);node=next;}
});
var items=Array.prototype.slice.call(document.querySelectorAll('[data-guide-reveal],[data-guide-module]'));
if(reduce||!('IntersectionObserver'in window)){items.forEach(function(el){el.classList.add('is-visible');});}
else{var observer=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}});},{rootMargin:'0px 0px -7% 0px',threshold:.08});items.forEach(function(el){observer.observe(el);});window.setTimeout(function(){items.forEach(function(el){el.classList.add('is-visible');});},5000);}
var dialog=document.querySelector('[data-guide-zoom]'),open=document.querySelector('[data-open-guide-zoom]'),close=document.querySelector('[data-close-guide-zoom]'),slider=document.getElementById('guide-zoom-level'),output=document.querySelector('[data-guide-zoom-value]'),image=document.querySelector('[data-guide-zoom-image]'),viewport=dialog&&dialog.querySelector('.tk-guide-zoom__viewport');
function setZoom(value){if(!image||!slider)return;var scale=Number(value)||1;image.style.width=(scale*100)+'%';slider.value=String(scale);if(output)output.value=Math.round(scale*100)+'%';if(viewport)viewport.scrollTop=0;}
if(open&&dialog&&typeof dialog.showModal==='function'){open.addEventListener('click',function(){dialog.showModal();setZoom(1);});if(close)close.addEventListener('click',function(){dialog.close();});dialog.addEventListener('click',function(event){if(event.target===dialog)dialog.close();});dialog.addEventListener('close',function(){setZoom(1);});if(slider)slider.addEventListener('input',function(){setZoom(slider.value);});var reset=document.querySelector('[data-reset-guide-zoom]');if(reset)reset.addEventListener('click',function(){setZoom(1);});}else if(open){open.hidden=true;}
})();
