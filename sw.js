/* EyeCopy service worker. Это шаблон: build.py подставляет версии и список предзагрузки и пишет mobile/www/sw.js — правьте здесь.
   Версии — короткие хэши содержимого, поэтому каждый деплой даёт новый sw.js и старые кэши удаляются при активации.
   APP — оболочка (index.html, манифест, иконки и прочие файлы сайта), LIB — библиотеки: vendor/ и CDN с зафиксированными
   версиями. Деплой без смены библиотек не заставляет заново качать ~25 МБ vendor/.
   Установка кладёт в LIB то, без чего первый экран офлайн выглядит сломанным: шрифты интерфейса и KaTeX (~1 МБ, список
   LIB_PRECACHE считает build.py). Страница после загрузки присылает список того, что уже скачала (сообщение cache-lib),
   и в свободную минуту — модули чтения PDF и DOCX. Большие файлы MediaPipe (≈ 6 МБ по сети) страница докачивает сама,
   пока открыта панель «Камера» (p4: mpPrefetch, только на хорошей сети), или при первом включении камеры; сюда они
   попадают обычным путём — как любой ответ из vendor/. Так же и распознавание текста (p9, vendor/tesseract/, ≈ 7 МБ по
   сети: воркер, ядро wasm под процессор и языки rus/eng в gzip) — при первом распознавании, ничего заранее.
   Навигация — сначала сеть, но не дольше 3,5 с: на «висящей» мобильной сети открывается index.html из кэша.
   Остальное (свой сайт и CDN) — сначала кэш, кладётся при первом использовании. В кэш попадают только полные ответы 200. */
'use strict';
var APP='eyecopy-app-3fbad6fe4a';
var LIB='eyecopy-lib-b7d26212ec';
var LIB_PRECACHE=["vendor/fonts/fonts.css","vendor/fonts/golos-text-cyrillic-400-normal.woff2","vendor/fonts/golos-text-cyrillic-500-normal.woff2","vendor/fonts/golos-text-cyrillic-600-normal.woff2","vendor/fonts/golos-text-cyrillic-700-normal.woff2","vendor/fonts/golos-text-cyrillic-800-normal.woff2","vendor/fonts/golos-text-latin-400-normal.woff2","vendor/fonts/golos-text-latin-500-normal.woff2","vendor/fonts/golos-text-latin-600-normal.woff2","vendor/fonts/golos-text-latin-700-normal.woff2","vendor/fonts/golos-text-latin-800-normal.woff2","vendor/fonts/jetbrains-mono-cyrillic-400-normal.woff2","vendor/fonts/jetbrains-mono-cyrillic-500-normal.woff2","vendor/fonts/jetbrains-mono-latin-400-normal.woff2","vendor/fonts/jetbrains-mono-latin-500-normal.woff2","vendor/fonts/stix-two-text-cyrillic-400-italic.woff2","vendor/fonts/stix-two-text-cyrillic-400-normal.woff2","vendor/fonts/stix-two-text-cyrillic-700-normal.woff2","vendor/fonts/stix-two-text-greek-400-italic.woff2","vendor/fonts/stix-two-text-greek-400-normal.woff2","vendor/fonts/stix-two-text-greek-700-normal.woff2","vendor/fonts/stix-two-text-latin-400-italic.woff2","vendor/fonts/stix-two-text-latin-400-normal.woff2","vendor/fonts/stix-two-text-latin-700-normal.woff2","vendor/katex/fonts/KaTeX_AMS-Regular.woff2","vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2","vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2","vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2","vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2","vendor/katex/fonts/KaTeX_Main-Bold.woff2","vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2","vendor/katex/fonts/KaTeX_Main-Italic.woff2","vendor/katex/fonts/KaTeX_Main-Regular.woff2","vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2","vendor/katex/fonts/KaTeX_Math-Italic.woff2","vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2","vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2","vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2","vendor/katex/fonts/KaTeX_Script-Regular.woff2","vendor/katex/fonts/KaTeX_Size1-Regular.woff2","vendor/katex/fonts/KaTeX_Size2-Regular.woff2","vendor/katex/fonts/KaTeX_Size3-Regular.woff2","vendor/katex/fonts/KaTeX_Size4-Regular.woff2","vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2","vendor/katex/katex.min.css","vendor/katex/katex.min.js"];
/* './' не кэшируем отдельно: навигация на корень без сети и так получает index.html */
var SHELL_OPTIONAL=['./manifest.webmanifest','./privacy.html','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png'];
var CDN=/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|storage\.googleapis\.com)\//;
var SCOPE=self.registration.scope;
var VENDOR=SCOPE+'vendor/';
var INDEX=new URL('index.html',SCOPE).href;
var NAV_TIMEOUT=3500;

function cacheable(res){ return !!res&&res.status===200&&(res.type==='basic'||res.type==='cors')&&!res.redirected; }
/* cache:'no-cache' — сверка с сервером (ETag → 304 без тела), а не повторная загрузка: файлы, которые страница только что
   скачала, второй раз не качаются, и при этом старая копия из HTTP-кэша не попадёт в кэш новой версии */
function precache(cache,url){
  return fetch(new Request(url,{cache:'no-cache'})).then(function(res){
    if(!cacheable(res)) throw new Error('precache '+url+': '+res.status);
    return cache.put(url,res);
  });
}
/* в 4 потока, чтобы не забивать канал и не ждать каждый файл по очереди; уже лежащее в кэше не трогаем;
   ошибки не мешают остальным */
function fill(cacheName,urls){
  return caches.open(cacheName).then(function(c){
    var i=0;
    var lane=function(){ if(i>=urls.length) return Promise.resolve(); var u=urls[i++]; return c.match(u).then(function(hit){ if(!hit) return precache(c,u); }).catch(function(){}).then(lane); };
    return Promise.all([lane(),lane(),lane(),lane()]);
  });
}

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(APP).then(function(c){
    return Promise.all([precache(c,INDEX)].concat(SHELL_OPTIONAL.map(function(u){ return precache(c,new URL(u,SCOPE).href).catch(function(){}); })));
  }).then(function(){
    return fill(LIB,LIB_PRECACHE.map(function(u){ return new URL(u,SCOPE).href; })).catch(function(){});
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k.indexOf('eyecopy-')===0&&k!==APP&&k!==LIB; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

/* страница: {type:'cache-lib', urls:[…]} — доложить в LIB файлы vendor/ (только свои, не больше 300);
   {type:'cache-shell'} — заново положить оболочку (после «Стереть локальные данные») */
self.addEventListener('message',function(e){
  var d=e.data; if(!d||typeof d!=='object') return;
  if(d.type==='cache-lib'&&Array.isArray(d.urls)){
    var urls=d.urls.filter(function(u){ return typeof u==='string'&&u.length<400&&u.indexOf(VENDOR)===0&&!/[?#]/.test(u); }).slice(0,300);
    e.waitUntil(fill(LIB,urls).catch(function(){}));
  } else if(d.type==='cache-shell'){
    e.waitUntil(fill(APP,[INDEX].concat(SHELL_OPTIONAL.map(function(u){ return new URL(u,SCOPE).href; }))).catch(function(){}));
  }
});

function offlinePage(req){
  return caches.match(req,{ignoreSearch:true}).then(function(hit){ return hit||caches.match(INDEX); });
}

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET'||req.headers.has('range')) return;
  var url=req.url;
  if(url.indexOf(SCOPE+'api/')===0) return;   /* API сервера (если он на том же домене) — всегда из сети, не из кэша */
  if(req.mode==='navigate'){
    /* сначала сеть; если она молчит дольше NAV_TIMEOUT или ошибается — страница из кэша (index.html, privacy.html),
       иначе index.html. Если кэша нет — ждём сеть до конца. */
    e.respondWith(new Promise(function(resolve){
      var settled=false, net=fetch(req);
      var done=function(r){ if(!settled&&r){ settled=true; resolve(r); } return !!r; };
      var timer=setTimeout(function(){ offlinePage(req).then(done).catch(function(){}); },NAV_TIMEOUT);
      net.then(function(r){ clearTimeout(timer); done(r); },function(){
        clearTimeout(timer);
        offlinePage(req).then(function(hit){
          done(hit||new Response('Нет сети, а страница ещё не сохранена для офлайна.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}));
        });
      });
    }));
    return;
  }
  var lib=CDN.test(url)||url.indexOf(VENDOR)===0;
  if(!lib&&url.indexOf(SCOPE)!==0) return;
  e.respondWith(caches.open(lib?LIB:APP).then(function(c){
    return c.match(req).then(function(hit){
      if(hit) return hit;
      return fetch(req).then(function(res){
        if(cacheable(res)){ var copy=res.clone(); e.waitUntil(c.put(req,copy).catch(function(){})); }
        return res;
      });
    });
  }));
});
