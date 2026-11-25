/* EyeCopy service worker. Это шаблон: build.py подставляет версии и список предзагрузки и пишет mobile/www/sw.js — правьте здесь.
   Версии — короткие хэши содержимого, поэтому каждый деплой даёт новый sw.js и старые кэши удаляются при активации.
   APP — оболочка (index.html, манифест, иконки и прочие файлы сайта), библиотеки — по кэшу на каждую папку vendor/ (fonts, katex,
   mediapipe, tesseract, pdfjs, jszip; версия — хэш её файлов, LIB_PARTS считает build.py) и кэш CDN (адреса с версиями). Деплой,
   который меняет одну библиотеку, не заставляет заново качать остальные: до 16.11 кэш библиотек был один, и, например, новые
   шрифты (0.9.40) выбрасывали у всех вернувшихся модель лица и распознавание — ~11 МБ заново (основатель 16.11: «лицо слишком
   долго скачивается»). Прежний единый кэш (LIB_LEGACY — тот же хэш по старой формуле) читается, пока его содержимое совпадает
   с нынешним vendor/. Из остальных удаляемых кэшей библиотек (выпуски старше, старые версии папок) тяжёлые файлы (LIB_BIG: модель
   лица, движки wasm, языки распознавания, pdf.js) перед удалением переезжают в кэш своей папки, если их контрольная сумма совпала
   с нынешней, — модель лица и распознавание не качаются заново, пока сами эти файлы не поменялись. Кэш CDN — со своей версией по
   закреплённым версиям библиотек (LIB_CDN).
   Установка кладёт только оболочку — новая версия встаёт за секунды и на медленной сети (Штаб 11.11: вернувшийся человек сутки
   видел прошлую версию). То, без чего первый экран офлайн выглядит сломанным — шрифты интерфейса и KaTeX (~1 МБ, список
   LIB_PRECACHE считает build.py), — воркер докладывает в кэши библиотек по сообщению warm от страницы, уже после активации. Страница после
   загрузки присылает и список того, что уже скачала (сообщение cache-lib), и в свободную минуту — модули чтения PDF и DOCX.
   VER — версия сайта: страница сверяет свою с версией воркера (сообщение version) и на главном экране перезагружается в новую (p6). Большие файлы MediaPipe (≈ 6 МБ по сети) страница докачивает сама:
   в «Камере» — как только разрешили заднюю камеру (p4 mpPrefetchCam), в других версиях — пока открыта панель камеры (p4 mpPrefetch)
   или при первом включении камеры; сюда они попадают обычным путём — как любой ответ из vendor/. Распознавание текста (p9,
   vendor/tesseract/, ≈ 5 МБ по сети: воркер, ядро wasm под процессор и языки rus/eng в gzip) — заранее, когда распознавать будет
   телефон (p5 camOcrWarm, ocrDownWarm), иначе при первом распознавании.
   Навигация — сначала сеть, но не дольше 3,5 с: на «висящей» мобильной сети открывается index.html из кэша.
   Остальное (свой сайт и CDN) — сначала кэш, кладётся при первом использовании. В кэш попадают только полные ответы 200. */
'use strict';
var APP='eyecopy-app-ba7200cb97';
var LIB_LEGACY='eyecopy-lib-6c5b28ed17';
var LIB_PARTS={"fonts":"e26e1527f2","jszip":"d7b9cad3a0","katex":"d302b03b01","mediapipe":"b3488eb8cf","pdfjs":"261fd465ca","tesseract":"600e3a55fb"};
var LIB_CDN='eyecopy-lib-cdn-15bd0a292f';
var LIB_BIG={"vendor/mediapipe/face_landmarker.task":"64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff","vendor/mediapipe/wasm/vision_wasm_internal.wasm":"f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc","vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm":"38b61feab2fd7934e05cbe9f68baa308978a5e3b7f85c1913bb8ae89b8ef8b97","vendor/pdfjs/pdf.min.js":"f401927e692efc7735e0cd528c490d0dd31b7f0972c122b7040df805be45cce4","vendor/pdfjs/pdf.worker.min.js":"a33cfe728c584fdba4fcc1fd54bcdc2f9f2f13889ddbb5b2bd1d0f8cbe49b84e","vendor/tesseract/eng.traineddata.gz":"384e37bf0f5ddcc4a1e24802322a837e0b5692e18150e6078ff1d4379b191f98","vendor/tesseract/rus.traineddata.gz":"6e81ea1cde38d325cf3686170802b685c938502561b5a2033ff691432a2a7c9b","vendor/tesseract/tesseract-core-lstm.wasm.js":"eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680","vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js":"861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3","vendor/tesseract/tesseract-core-simd-lstm.wasm.js":"c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38"};   /* тяжёлые файлы vendor/ → sha256 их содержимого (build.py): переезд из старых кэшей только при совпадении */
var VER='0.9.67';
var LIB_PRECACHE=["vendor/fonts/fonts.css","vendor/fonts/golos-text-cyrillic-400-normal.woff2","vendor/fonts/golos-text-cyrillic-500-normal.woff2","vendor/fonts/golos-text-cyrillic-600-normal.woff2","vendor/fonts/golos-text-cyrillic-700-normal.woff2","vendor/fonts/golos-text-cyrillic-800-normal.woff2","vendor/fonts/golos-text-latin-400-normal.woff2","vendor/fonts/golos-text-latin-500-normal.woff2","vendor/fonts/golos-text-latin-600-normal.woff2","vendor/fonts/golos-text-latin-700-normal.woff2","vendor/fonts/golos-text-latin-800-normal.woff2","vendor/fonts/jetbrains-mono-cyrillic-400-normal.woff2","vendor/fonts/jetbrains-mono-cyrillic-500-normal.woff2","vendor/fonts/jetbrains-mono-latin-400-normal.woff2","vendor/fonts/jetbrains-mono-latin-500-normal.woff2","vendor/fonts/stix-two-text-cyrillic-400-italic.woff2","vendor/fonts/stix-two-text-cyrillic-400-normal.woff2","vendor/fonts/stix-two-text-cyrillic-700-normal.woff2","vendor/fonts/stix-two-text-greek-400-italic.woff2","vendor/fonts/stix-two-text-greek-400-normal.woff2","vendor/fonts/stix-two-text-greek-700-normal.woff2","vendor/fonts/stix-two-text-latin-400-italic.woff2","vendor/fonts/stix-two-text-latin-400-normal.woff2","vendor/fonts/stix-two-text-latin-700-normal.woff2","vendor/katex/fonts/KaTeX_AMS-Regular.woff2","vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2","vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2","vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2","vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2","vendor/katex/fonts/KaTeX_Main-Bold.woff2","vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2","vendor/katex/fonts/KaTeX_Main-Italic.woff2","vendor/katex/fonts/KaTeX_Main-Regular.woff2","vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2","vendor/katex/fonts/KaTeX_Math-Italic.woff2","vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2","vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2","vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2","vendor/katex/fonts/KaTeX_Script-Regular.woff2","vendor/katex/fonts/KaTeX_Size1-Regular.woff2","vendor/katex/fonts/KaTeX_Size2-Regular.woff2","vendor/katex/fonts/KaTeX_Size3-Regular.woff2","vendor/katex/fonts/KaTeX_Size4-Regular.woff2","vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2","vendor/katex/katex.min.css","vendor/katex/katex.min.js"];
/* './' не кэшируем отдельно: навигация на корень без сети и так получает index.html */
var SHELL_OPTIONAL=['./manifest.webmanifest','./privacy.html','./icons/icon.svg','./icons/favicon.svg','./icons/icon-192.png','./icons/icon-512.png'];
var CDN=/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|storage\.googleapis\.com)\//;
var SCOPE=self.registration.scope;
var VENDOR=SCOPE+'vendor/';
var INDEX=new URL('index.html',SCOPE).href;
var NAV_TIMEOUT=3500;

/* кэш библиотеки по адресу: vendor/<папка>/… — кэш этой папки с её версией; CDN — общий кэш CDN */
function libName(url){
  if(CDN.test(url)) return LIB_CDN;
  var p=url.slice(VENDOR.length).split('/'), part=p.length>1? p[0] : '_root';
  return 'eyecopy-lib-'+part+'-'+(LIB_PARTS[part]||'0');
}
function libKeep(){ var k={}; k[LIB_CDN]=1; k[LIB_LEGACY]=1; Object.keys(LIB_PARTS).forEach(function(p){ k['eyecopy-lib-'+p+'-'+LIB_PARTS[p]]=1; }); return k; }
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
    var lane=function(){ if(i>=urls.length) return Promise.resolve(); var u=urls[i++];
      return c.match(u).then(function(hit){ if(hit) return;
        return caches.match(u,{cacheName:LIB_LEGACY}).then(function(o){ return o? c.put(u,o) : precache(c,u); });   /* прежний единый кэш — то же содержимое */
      }).catch(function(){}).then(lane); };
    return Promise.all([lane(),lane(),lane(),lane()]);
  });
}
/* библиотеки — каждая в свой кэш; папки параллельно (по очереди — старый воркер дольше занят, и новая версия встаёт позже) */
function fillLib(urls){
  var g={}; urls.forEach(function(u){ var n=libName(u); (g[n]=g[n]||[]).push(u); });
  return Promise.all(Object.keys(g).map(function(n){ return fill(n,g[n]); }));
}
function hexOf(buf){ var a=new Uint8Array(buf), s=''; for(var i=0;i<a.length;i++) s+=(a[i]<16?'0':'')+a[i].toString(16); return s; }
/* из удаляемых кэшей библиотек — тяжёлые файлы в кэш своей папки, если содержимое совпало с нынешним (sha256 из LIB_BIG) */
function salvage(sources){
  if(!sources.length||!self.crypto||!crypto.subtle) return Promise.resolve();
  return Object.keys(LIB_BIG).reduce(function(p,rel){ return p.then(function(){
    var u=new URL(rel,SCOPE).href, dest=libName(u), i=0;
    var next=function(){
      if(i>=sources.length) return null;
      var n=sources[i++];
      return caches.match(u,{cacheName:n}).then(function(r){
        if(!r) return next();
        return r.clone().arrayBuffer().then(function(b){ return crypto.subtle.digest('SHA-256',b); }).then(function(d){
          return hexOf(d)===LIB_BIG[rel]? caches.open(dest).then(function(c){ return c.put(u,r); }) : next();
        });
      });
    };
    return caches.match(u,{cacheName:dest}).then(function(have){ if(!have) return next(); });
  }).catch(function(){}); },Promise.resolve());
}

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(APP).then(function(c){
    return Promise.all([precache(c,INDEX)].concat(SHELL_OPTIONAL.map(function(u){ return precache(c,new URL(u,SCOPE).href).catch(function(){}); })));
  }).then(function(){ return self.skipWaiting(); }));   /* библиотеки — после, по сообщению warm: установка их не ждёт */
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    var keep=libKeep(); keep[APP]=1;
    var drop=keys.filter(function(k){ return k.indexOf('eyecopy-')===0&&!keep[k]; });
    return salvage(drop.filter(function(k){ return k.indexOf('eyecopy-lib-')===0; })).then(function(){
      return Promise.all(drop.map(function(k){ return caches.delete(k); }));
    });
  }).then(function(){ return self.clients.claim(); }));
});

/* страница: {type:'cache-lib', urls:[…]} — доложить в кэши библиотек файлы vendor/ (только свои, не больше 300);
   {type:'warm'} — шрифты и KaTeX (LIB_PRECACHE) в кэши библиотек, если их там ещё нет; {type:'version'} + порт — ответить версией;
   {type:'cache-shell'} — заново положить оболочку (после «Стереть локальные данные») */
self.addEventListener('message',function(e){
  var d=e.data; if(!d||typeof d!=='object') return;
  if(d.type==='version'){ if(e.ports&&e.ports[0]) e.ports[0].postMessage({ver:VER,app:APP}); return; }
  if(d.type==='warm'){ e.waitUntil(fillLib(LIB_PRECACHE.map(function(u){ return new URL(u,SCOPE).href; })).catch(function(){})); return; }
  if(d.type==='cache-lib'&&Array.isArray(d.urls)){
    var urls=d.urls.filter(function(u){ return typeof u==='string'&&u.length<400&&u.indexOf(VENDOR)===0&&!/[?#]/.test(u); }).slice(0,300);
    e.waitUntil(fillLib(urls).catch(function(){}));
  } else if(d.type==='cache-shell'){
    e.waitUntil(fill(APP,[INDEX].concat(SHELL_OPTIONAL.map(function(u){ return new URL(u,SCOPE).href; }))).catch(function(){}));
  }
});

/* версия сайта в странице (подвал, #appVer) — чтобы не положить в кэш страницу старее лежащей */
function verOf(html){ var m=/id="appVer"[^>]*>\s*([0-9]+(?:\.[0-9]+)*)/.exec(String(html||'')); return m? m[1] : ''; }
function verCmp(a,b){ if(!a||!b) return 0; var x=a.split('.'), y=b.split('.'); for(var i=0;i<Math.max(x.length,y.length);i++){ var d=(+x[i]||0)-(+y[i]||0); if(d) return d<0? -1 : 1; } return 0; }
function offlinePage(req){
  return caches.match(req,{ignoreSearch:true}).then(function(hit){ return hit||caches.match(INDEX); });
}

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET'||req.headers.has('range')||req.cache==='no-store') return;   /* no-store — страница хочет свежее с сервера (версия сайта) */
  var url=req.url;
  if(url.indexOf(SCOPE+'api/')===0) return;   /* API сервера (если он на том же домене) — всегда из сети, не из кэша */
  if(req.mode==='navigate'){
    /* сначала сеть; если она молчит дольше NAV_TIMEOUT или ошибается — страница из кэша (index.html, privacy.html),
       иначе index.html. Если кэша нет — ждём сеть до конца. */
    var net=fetch(req);
    /* свежая страница из сети — в кэш, даже если показали сохранённую (основатель 21.11: «у многих вместо нового сайта открывается
       старый, иногда уже после нового»): раньше в кэше лежала версия установки воркера, и на медленной сети человек, уже видевший
       новую, снова получал прежнюю. Копия снимается сразу, до того как страница прочтёт ответ */
    e.waitUntil(net.then(function(r){
      if(!r||!r.ok||r.type!=='basic'||!/text\/html/.test(r.headers.get('content-type')||'')) return;
      var copy=r.clone(), u=new URL(req.url); u.search=''; u.hash='';
      var key=u.href===SCOPE? INDEX : u.href;   /* главная — только корень сайта, не любая папка (проверяющий 21.11) */
      /* ответ мог прийти из HTTP-кэша браузера (max-age, «Назад», восстановленная вкладка) — более старой версией сайта не затираем */
      return Promise.all([copy.clone().text(),caches.match(key,{cacheName:APP}).then(function(o){ return o? o.text() : ''; })]).then(function(v){
        if(verCmp(verOf(v[0]),verOf(v[1]))<0) return;
        return caches.open(APP).then(function(c){ return c.put(key,copy); });
      });
    }).catch(function(){}));
    e.respondWith(new Promise(function(resolve){
      var settled=false;
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
  e.respondWith(caches.open(lib? libName(url) : APP).then(function(c){
    return c.match(req).then(function(hit){
      if(hit) return hit;
      /* библиотека: нет в своём кэше — из прежнего единого (если он есть, его содержимое = нынешнему), и переложить */
      var old= lib? caches.match(req,{cacheName:LIB_LEGACY}).catch(function(){}) : Promise.resolve();
      return old.then(function(o){
        if(o){ e.waitUntil(c.put(req,o.clone()).catch(function(){})); return o; }
        return fetch(req).then(function(res){
          if(cacheable(res)){ var copy=res.clone(); e.waitUntil(c.put(req,copy).catch(function(){})); }
          return res;
        });
      });
    });
  }));
});
