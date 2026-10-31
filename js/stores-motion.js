/* Subtle in-view reveal for the Boztik Stores storefront. */
(function(){
  "use strict";
  var page=document.querySelector(".stores-page");
  if(!page||!("IntersectionObserver" in window)||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  var targets=page.querySelectorAll(".store-section-intro,.platform-card,.collection-heading,.store-filter-wrap,.store-bottom-cta");
  targets.forEach(function(el){el.classList.add("store-reveal");});
  var observer=new IntersectionObserver(function(entries){
    entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add("is-visible");observer.unobserve(entry.target);}});
  },{threshold:.12,rootMargin:"0px 0px -35px 0px"});
  targets.forEach(function(el){observer.observe(el);});
})();
