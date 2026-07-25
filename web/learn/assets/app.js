(function(){
var root=document.body.getAttribute('data-root')||'';
// theme toggle
var tb=document.getElementById('theme');
if(tb)tb.addEventListener('click',function(){var cur=document.documentElement.getAttribute('data-theme');var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('help-theme',next);}catch(e){}});
// copy buttons
document.querySelectorAll('.code .copy').forEach(function(b){b.addEventListener('click',function(){var c=b.parentElement.querySelector('code');var t=c?c.innerText:'';try{navigator.clipboard.writeText(t);}catch(e){}b.textContent='Kopyalandı';b.classList.add('ok');setTimeout(function(){b.textContent='Kopyala';b.classList.remove('ok');},1200);});});
// search
var q=document.getElementById('q'),box=document.getElementById('results');
var IDX=(window.__HELP_INDEX__||[]);
function score(d,terms){var t=(d.title||'').toLowerCase(),s=(d.section||'').toLowerCase(),b=(d.text||'');var sc=0;terms.forEach(function(w){if(t.indexOf(w)>=0)sc+=5;if(s.indexOf(w)>=0)sc+=2;if(b.indexOf(w)>=0)sc+=1;});return sc;}
function run(){if(!q)return;var v=q.value.trim().toLowerCase();if(!v){box.hidden=true;box.innerHTML='';return;}var terms=v.split(/\s+/);
var hits=IDX.map(function(d){return{d:d,s:score(d,terms)};}).filter(function(x){return x.s>0;}).sort(function(a,b){return b.s-a.s;}).slice(0,8);
if(!hits.length){box.hidden=false;box.innerHTML='<a>Sonuç yok</a>';return;}
box.innerHTML=hits.map(function(x){return '<a href="'+root+x.d.href+'"><div>'+x.d.title+'</div><div class="r-sec">'+(x.d.section||x.d.system)+'</div></a>';}).join('');box.hidden=false;}
if(q){q.addEventListener('input',run);q.addEventListener('focus',run);
document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==q){e.preventDefault();q.focus();}if(e.key==='Escape'){box.hidden=true;q.blur();}});
document.addEventListener('click',function(e){if(box&&!box.contains(e.target)&&e.target!==q)box.hidden=true;});}
})();