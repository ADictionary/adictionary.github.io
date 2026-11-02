/* Fourth & Goal – Markets tab (play money only, no real wagering).
   Reads games from window.FG.state.games (ESPN scoreboard) and renders into #marketsView.
   Prices are MODEL prices: they start from the ESPN betting line (spread + over/under) and move with the
   live score and game clock. They are not Kalshi's or any sportsbook's prices.
   State lives in localStorage under 'fourth-goal-markets-v1' and is separate from picks/fantasy data. */
(function(){
'use strict';
const FG=window.FG;if(!FG)return;
const root=document.getElementById('marketsView'),KEY='fourth-goal-markets-v1',START=10000;
let S={pos:[],hist:{},gs:{}},view='list',vg=null,mt='w',flt='all',legs=[],qty=10,msg='';
try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&Array.isArray(s.pos))S=Object.assign(S,s)}catch(_){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(_){}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- pricing model ---------- */
const Phi=x=>{const t=1/(1+.2316419*Math.abs(x)),p=.3989423*Math.exp(-x*x/2)*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p};
const G=()=>FG.state.games||[],find=id=>G().find(g=>g.id===id)||S.gs[id];
const done=g=>g.state==='post'||!!g.completed;
const secs=g=>{const m=String(g.clock||'').match(/(\d+):(\d+)/);return m?+m[1]*60+ +m[2]:0};
const rem=g=>g.state==='pre'?3600:done(g)?0:g.period>4?secs(g):Math.max(0,4-g.period)*900+secs(g);
const MU=g=>Number.isFinite(g.mu)?g.mu:0,TOT=g=>Number.isFinite(g.totalLine)?g.totalLine:44.5,marg=g=>g.home.score-g.away.score;
function pm(g,s){if(done(g))return marg(g)>s?1:0;const f=rem(g)/3600;return Phi((marg(g)+MU(g)*f-s)/Math.max(13.5*Math.sqrt(f),.7))}
function pt(g,s){const n=g.home.score+g.away.score;if(done(g))return n>s?1:0;const f=rem(g)/3600;return Phi((n+TOT(g)*f-s)/Math.max(10*Math.sqrt(f),.7))}
/* leg = {gid,k:'w'|'p'|'t',team,s,yes}; w = wins, p = wins by over s, t = total over s */
function mp(g,l){const H=l.team===g.home.abbr;let p=l.k==='t'?pt(g,l.s):l.k==='w'?(H?pm(g,0):1-pm(g,0)):(H?pm(g,l.s):1-pm(g,-l.s));if(!done(g))p=Math.min(.99,Math.max(.01,p));return l.yes?p:1-p}
const pc=p=>Math.round(p*100),ask=q=>Math.min(99,Math.max(1,pc(q)+1)),bid=q=>Math.min(99,Math.max(1,pc(q)-1));
const fee=(n,p)=>Math.ceil(n*p*(1-p)*7-1e-9)/100;
const money=n=>(n<0?'-':'')+'$'+Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const nm=(g,t)=>t===g.home.abbr?g.home.short:g.away.short;
const lab=(l,g)=>l.k==='t'?`Over ${l.s} points`:l.k==='w'?`${nm(g,l.team)} to win`:`${nm(g,l.team)} wins by over ${l.s}`;
const ev=l=>{const g=find(l.gid);return g&&done(g)?mp(g,l)>.5:null};
const st=p=>{const e=p.legs.map(ev);return e.includes(false)?'lost':e.every(x=>x===true)?'won':'open'};
const prod=(L,f)=>Math.max(.01,Math.min(.99,L.reduce((a,l)=>a*f(mp(find(l.gid),l))/100,1)));
const cash=()=>Math.round(100*S.pos.reduce((a,p)=>a-p.n*p.px-p.fee+(p.sold?p.sold.pr:0)+(!p.sold&&st(p)==='won'?p.n:0),START))/100;
const val=p=>p.sold?p.sold.pr:st(p)==='won'?p.n:st(p)==='lost'?0:p.n*prod(p.legs,bid);
const openVal=()=>S.pos.reduce((a,p)=>a+(!p.sold&&st(p)==='open'?val(p):0),0);

/* ---------- view helpers ---------- */
const logo=t=>t.logo?`<img class="mk-logo" src="${esc(t.logo)}" alt="" loading="lazy">`:`<span class="mk-bd" style="background:${esc(t.color||'#556677')}">${esc(t.abbr)}</span>`;
const stx=g=>g.state==='in'?`<span class="mk-live">${esc(g.statusDetail)}</span>`:done(g)?'Final':esc(FG.fmtDate(g.date,{weekday:'short',hour:'numeric',minute:'2-digit'}));
function btn(g,k,team,s,yes){const l={gid:g.id,k,team,s,yes:!!yes},sel=legs.some(x=>x.gid===g.id&&x.k===k&&x.team===team&&x.s===s&&x.yes===!!yes);
 return`<button class="mk-px ${yes?'mk-y':'mk-n'}${sel?' sel':''}" data-l="${[g.id,k,team,s,yes?1:0].join('|')}" aria-pressed="${sel}"${done(g)?' disabled':''}>${yes?'Yes':'No'} ${ask(mp(g,l))}¢</button>`}
const mrow=(g,k,team,s,title,sub)=>`<div class="mk-row"><div class="mk-tm">${esc(title)}<small>${esc(sub||'')}</small></div><div class="mk-pct">${pc(mp(g,{gid:g.id,k,team,s,yes:true}))}%</div>${btn(g,k,team,s,1)}${btn(g,k,team,s,0)}</div>`;
function card(g){let h=`<div class="mk-card"><div class="mk-meta"><span>${stx(g)}</span><a data-go="${esc(g.id)}">All markets ›</a></div>`;
 [g.away,g.home].forEach(t=>{const sc=g.state!=='pre'?`<div class="mk-sc">${t.score}</div>`:'';
  h+=`<div class="mk-row">${logo(t)}<div class="mk-tm">${esc(t.short)}<small>${esc(t.record||(t===g.home?'Home':'Away'))}</small></div>${sc}<div class="mk-pct">${pc(mp(g,{gid:g.id,k:'w',team:t.abbr,s:0,yes:true}))}%</div>${btn(g,'w',t.abbr,0,1)}${btn(g,'w',t.abbr,0,0)}</div>`});
 return h+`<div class="mk-lines">${g.oddsDetail?`<span>Spread ${esc(g.oddsDetail)}</span>`:''}${Number.isFinite(g.totalLine)?`<span>O/U ${g.totalLine}</span>`:''}${g.oddsDetail||Number.isFinite(g.totalLine)?'':'<span>No ESPN line yet – prices are an even-odds estimate</span>'}</div></div>`}
function chart(g){const h=S.hist[g.id]||[];if(h.length<2)return'<div class="mk-empty">The chart fills in as prices move. Keep the site open during the game.</div>';
 const t0=h[0][0],t1=h[h.length-1][0],X=t=>10+(t-t0)/Math.max(1,t1-t0)*580,Y=p=>150-p*140,L=(f,c)=>`<polyline fill="none" stroke="${esc(c)}" stroke-width="2.2" stroke-linejoin="round" points="${h.map(r=>X(r[0]).toFixed(1)+','+Y(f(r[1])).toFixed(1)).join(' ')}"/>`;
 return`<svg class="mk-chart" viewBox="0 0 600 160" role="img" aria-label="Win chance over time">${[0,.5,1].map(v=>`<line x1="10" x2="590" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>`).join('')}${L(p=>1-p,g.away.color||'#888')}${L(p=>p,g.home.color||'#555')}</svg>`}
function detail(g){const p=pm(g,0),b=Math.round(TOT(g)-.5)+.5;
 let h=`<button class="back" data-nav="list">← All markets</button><div class="mk-card mk-hero"><div class="mk-meta"><span>${stx(g)}</span><span>${g.oddsDetail?'Line from ESPN: '+esc(g.oddsDetail):'No ESPN line yet'}</span></div>`;
 [g.away,g.home].forEach(t=>h+=`<div class="mk-row">${logo(t)}<div class="mk-tm mk-big">${esc(t.short)}</div>${g.state!=='pre'?`<div class="mk-bigsc">${t.score}</div>`:''}</div>`);
 h+=`<div class="mk-key"><span><i style="background:${esc(g.away.color||'#888')}"></i>${esc(g.away.short)} ${pc(1-p)}%</span><span><i style="background:${esc(g.home.color||'#555')}"></i>${esc(g.home.short)} ${pc(p)}%</span></div>${chart(g)}</div>`;
 h+=`<div class="mk-tabs">${[['w','Winner'],['p','Spread'],['t','Total']].map(x=>`<button data-tab="${x[0]}" class="${mt===x[0]?'on':''}">${x[1]}</button>`).join('')}</div><div class="mk-card">`;
 if(mt==='w')[g.away,g.home].forEach(t=>h+=mrow(g,'w',t.abbr,0,`${t.short} to win`,'Includes overtime'));
 if(mt==='p')[g.away,g.home].forEach(t=>[3.5,6.5,10.5,13.5].forEach(s=>h+=mrow(g,'p',t.abbr,s,`${t.short} wins by over ${s}`,'Margin of victory')));
 if(mt==='t')[-6,-3,0,3,6].map(d=>b+d).filter(s=>s>0).forEach(s=>h+=mrow(g,'t','',s,`Over ${s} points`,'Combined score, includes overtime'));
 return h+'</div><p class="note">Each contract pays $1.00 if it resolves Yes and $0 if No. Contracts settle on the final score once ESPN marks the game final.</p>'}
function list(){const order={in:0,pre:1,post:2};
 const L=G().filter(g=>flt==='all'||(flt==='live'?g.state==='in':flt==='up'?g.state==='pre':done(g))).sort((a,b)=>(order[a.state]??1)-(order[b.state]??1)||new Date(a.date)-new Date(b.date));
 return`<div class="toolbar"><div class="filters">${[['all','All'],['live','Live'],['up','Upcoming'],['fin','Final']].map(f=>`<button class="filter${flt===f[0]?' active':''}" data-f="${f[0]}">${f[1]}</button>`).join('')}</div></div>`+
 (L.length?L.map(card).join(''):`<div class="empty">${G().length?'No games in this filter.':'Waiting for the ESPN scoreboard…'}</div>`)+
 '<p class="note">Play money only. Prices are model estimates built from ESPN’s betting line and the live score and clock, so they are not real Kalshi or sportsbook prices. Nothing here involves real money, prizes or payouts.</p>'}
function pf(){const c=cash(),ov=openVal(),pl=c+ov-START;
 let h=`<div class="mk-stats" style="margin-bottom:12px"><div class="mk-stat"><small>Total profit / loss</small><b style="color:var(--${pl>=0?'green':'red'})">${pl>0?'+':''}${money(pl)}</b></div><div class="mk-stat"><small>Open positions</small><b>${money(ov)}</b></div></div>`;
 if(!S.pos.length)h+='<div class="empty">No positions yet. Pick a Yes or No price on the Markets tab.</div>';
 S.pos.slice().reverse().forEach(p=>{const s=p.sold?'sold':st(p),v=val(p),cost=p.n*p.px+p.fee,pl=v-cost;
  h+=`<div class="mk-card mk-pos"><div class="mk-top"><span>${p.legs.length>1?p.legs.length+'-leg combo':'Position'}</span><span class="mk-tag ${s}">${{open:'Open',won:'Won',lost:'Lost',sold:'Sold'}[s]}</span></div><ul>`+
  p.legs.map(l=>{const g=find(l.gid),e=ev(l);return`<li class="${e===true?'w':e===false?'l':''}">${e===true?'✓':e===false?'✗':'•'} ${l.yes?'Yes':'No'}: ${esc(lab(l,g))} (${esc(g.away.abbr)} at ${esc(g.home.abbr)})${done(g)?` – final ${g.away.score}-${g.home.score}`:''}</li>`}).join('')+
  `</ul><div class="mk-figs"><span><b>${p.n}</b> contracts</span><span>Avg <b>${(p.px*100).toFixed(p.px<.1?1:0)}¢</b></span><span>Cost <b>${money(cost)}</b></span><span>${s==='open'?'Value':'Returned'} <b>${money(v)}</b></span><span>P&amp;L <b style="color:var(--${pl>=0?'green':'red'})">${pl>0?'+':''}${money(pl)}</b></span>${s==='open'?`<button class="mk-sell" data-sell="${p.id}">Sell at ${pc(prod(p.legs,bid))}¢</button>`:''}</div></div>`});
 return h+(S.pos.length?'<button class="mk-cta gh" id="mkReset" style="max-width:280px">Reset play-money account</button>':'')}
function calc(){const p=prod(legs,ask),c=qty*p,f=fee(qty,p);return{p,c,f,t:c+f}}
function ticket(){if(!legs.length)return'<h3>Order</h3><div class="mk-empty">Select a Yes or No price to start an order. Add legs from two or more games to build a combo.</div>';
 const one=legs.length===1,l0=legs[0];
 let h=`<h3>${one?'Buy '+(l0.yes?'Yes':'No'):legs.length+'-leg combo'}</h3>`;
 if(one){const g=find(l0.gid);h+=`<div class="mk-seg"><button class="mk-y${l0.yes?' on':''}" data-flip="1">Yes ${ask(mp(g,{...l0,yes:true}))}¢</button><button class="mk-n${l0.yes?'':' on'}" data-flip="0">No ${ask(mp(g,{...l0,yes:false}))}¢</button></div>`}
 legs.forEach((l,i)=>{const g=find(l.gid);h+=`<div class="mk-leg"><b>${l.yes?'Yes':'No'}: ${esc(lab(l,g))}<small>${esc(g.away.short)} at ${esc(g.home.short)}</small></b><span>${ask(mp(g,l))}¢</span><button data-x="${i}" aria-label="Remove leg">×</button></div>`});
 return h+`<div class="mk-sum"><span>Price per contract</span><b id="k-p"></b></div><input type="number" id="mkQty" min="1" step="1" value="${qty}" aria-label="Number of contracts"><div class="mk-sum"><span>Cost</span><b id="k-c"></b></div><div class="mk-sum"><span>Fee</span><b id="k-f"></b></div><div class="mk-sum"><span>Payout if Yes hits</span><b id="k-o" style="color:var(--green)"></b></div><div class="mk-sum"><span>Max profit</span><b id="k-m"></b></div><button class="mk-cta" id="mkBuy"></button><button class="mk-cta gh" data-clear="1">Clear</button><div class="mk-err">${esc(msg)}</div>`}
function fill(){if(!legs.length)return;const k=calc(),$=i=>document.getElementById(i);$('k-p').textContent=(k.p*100).toFixed(k.p<.1?1:0)+'¢';$('k-c').textContent=money(k.c);$('k-f').textContent=money(k.f);$('k-o').textContent=money(qty);$('k-m').textContent=money(qty-k.t);
 const b=$('mkBuy');b.textContent=(legs.length>1?'Buy combo · ':'Buy '+(legs[0].yes?'Yes':'No')+' · ')+money(k.t);b.disabled=!(qty>=1&&k.t<=cash())}
function render(){const a=document.activeElement,id=a&&a.id,ss=a&&a.selectionStart,g=view==='game'&&find(vg);
 const head=`<div class="page-head"><div><div class="eyebrow">Play money · no real wagering</div><h1>Markets</h1><p>Trade Yes/No contracts on NFL games, build multi-leg combos, and watch prices move with the live score.</p></div><div class="mk-stats"><div class="mk-stat"><small>Cash</small><b>${money(cash())}</b></div><div class="mk-stat"><small>Portfolio</small><b>${money(cash()+openVal())}</b></div></div></div>`+
  `<div class="toolbar"><div class="filters"><button class="filter${view!=='pf'?' active':''}" data-nav="list">Markets</button><button class="filter${view==='pf'?' active':''}" data-nav="pf">Portfolio${S.pos.length?' ('+S.pos.length+')':''}</button></div></div>`;
 const main=view==='pf'?pf():g?detail(g):list();
 root.innerHTML=head+(view==='pf'?main:`<div class="mk-layout"><div>${main}</div><aside class="mk-side" id="mkSide"><div class="mk-card mk-ticket">${ticket()}</div></aside></div>`)+(legs.length&&view!=='pf'?`<a class="mk-fab" href="#mkSide">Order (${legs.length})</a>`:'');
 fill();if(id&&(id==='mkQty')&&document.getElementById(id)){const e=document.getElementById(id);e.focus();try{e.setSelectionRange(ss,ss)}catch(_){}}}

/* ---------- actions ---------- */
root.addEventListener('click',e=>{const t=e.target.closest('button,a'),d=t&&t.dataset;if(!d)return;msg='';
 if(d.l){const[gid,k,team,s,y]=d.l.split('|'),n={gid,k,team,s:+s,yes:y==='1'},grp=l=>l.gid===gid&&(l.k==='t')===(k==='t'),i=legs.findIndex(grp);
  if(i>=0&&legs[i].k===k&&legs[i].team===team&&legs[i].s===n.s&&legs[i].yes===n.yes)legs.splice(i,1);else if(i>=0)legs[i]=n;else if(legs.length<8)legs.push(n);return render()}
 if(d.go){view='game';vg=d.go;mt='w';scrollTo({top:0});return render()}
 if(d.nav){view=d.nav;return render()}if(d.tab){mt=d.tab;return render()}if(d.f){flt=d.f;return render()}
 if(d.x){legs.splice(+d.x,1);return render()}if(d.clear){legs=[];return render()}if(d.flip){legs[0].yes=d.flip==='1';return render()}
 if(t.id==='mkBuy'){const k=calc();if(!(qty>=1)||k.t>cash()){msg='Not enough play-money cash for that order.';return render()}
  legs.forEach(l=>{S.gs[l.gid]=JSON.parse(JSON.stringify(find(l.gid)))});S.pos.push({id:Date.now(),legs:legs.slice(),n:qty,px:k.p,fee:k.f});legs=[];view='pf';save();render();FG.toast&&FG.toast('Order filled (play money).');return}
 if(d.sell){const p=S.pos.find(x=>x.id==d.sell),b=prod(p.legs,bid);p.sold={pr:Math.round((p.n*b-fee(p.n,b))*100)/100};save();return render()}
 if(t.id==='mkReset'&&confirm('Wipe all Markets positions and start over with $10,000 play money?')){S.pos=[];legs=[];save();render()}});
root.addEventListener('input',e=>{if(e.target.id==='mkQty'){qty=Math.max(0,Math.floor(+e.target.value||0));fill()}});

/* ---------- live updates: record price history, settle, refresh ---------- */
function tick(){const gs=G();if(!gs.length)return;
 gs.forEach(g=>{if(done(g))return;const h=S.hist[g.id]=S.hist[g.id]||[],p=pm(g,0),l=h[h.length-1];if(!l||Math.abs(l[1]-p)>.002||Date.now()-l[0]>3e5){h.push([Date.now(),p]);if(h.length>300)h.shift()}});
 Object.keys(S.hist).forEach(k=>{if(!gs.some(g=>g.id===k))delete S.hist[k]});
 S.pos.forEach(p=>p.legs.forEach(l=>{const g=gs.find(x=>x.id===l.gid);if(g)S.gs[g.id]=JSON.parse(JSON.stringify(g))}));
 legs=legs.filter(l=>{const g=find(l.gid);return g&&!done(g)});save();if(!root.hidden)render()}
FG.marketsRender=render;setInterval(tick,5000);setTimeout(tick,1500);
})();
