'use strict';
route();
initAccount();
function updateOffline(){const el=document.getElementById('offline-strip');if(el)el.hidden=navigator.onLine!==false;}
window.addEventListener('online',updateOffline);window.addEventListener('offline',updateOffline);updateOffline();
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js',{scope:'./'}).catch(()=>{});
