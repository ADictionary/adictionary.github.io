/* Fourth & Goal – play-money markets, built into the Games tab.
   • Each game card shows a win-chance bar and one-tap Yes prices (FG.mk.cardRow).
   • Each game page shows ESPN's win-probability chart plus winner / spread / total contracts (FG.mk.detail).
   • Orders collect in a floating order dock; positions live in the Portfolio tab.
   PRICES FOLLOW ESPN: the home-win price is ESPN's latest win probability for the game (summary feed
   `winprobability`, or its pregame `predictor`). Spread and total ladders are derived from that same number plus
   the live score/clock. If ESPN has no win probability yet, the ESPN betting line is used, then even odds.
   Play money only: no real wagering. Data is kept in localStorage ('fourth-goal-markets-v1'). */
(function(){
'use strict';
const FG=window.FG;if(!FG)return;
const KEY='fourth-goal-markets-v1',START=10000;
let S={pos:[],gs:{}},mt='w',legs=[],qty=10,msg='',expanded=innerWidth>700;
const W={}; // win probability cache: id -> {series:[homeWin 0..1], last, src:'wp'|'pred', t, fin}
try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&Array.isArray(s.pos))S=Object.assign(S,{pos:s.pos,gs:s.gs||{}})}catch(_){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(_){}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);

/* ---------- pricing ---------- */
const Phi=x=>{const t=1/(1+.2316419*Math.abs(x)),p=.3989423*Math.exp(-x*x/2)*t*(.3193815+t*(-.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p};
const Pinv=p=>{let lo=-6,hi=6;for(let i=0;i<40;i++){const m=(lo+hi)/2;Phi(m)<p?lo=m:hi=m}return(lo+hi)/2};
const G=()=>FG.state.games||[],find=id=>G().find(g=>g.id===id)||S.gs[id];
const done=g=>g.state==='post'||!!g.completed;
const secs=g=>{const m=String(g.clock||'').match(/(\d+):(\d+)/);return m?+m[1]*60+ +m[2]:0};
const rem=g=>g.state==='pre'?3600:done(g)?0:g.period>4?secs(g):Math.max(0,4-g.period)*900+secs(g);
const MU=g=>Number.isFinite(g.mu)?g.mu:0,TOT=g=>Number.isFinite(g.totalLine)?g.totalLine:44.5,marg=g=>g.home.score-g.away.score;
const espnWP=g=>{if(done(g))return null;const w=W[g.id];return w&&w.last!=null?w.last:null};
const sd=g=>Math.max(13.5*Math.sqrt(rem(g)/3600),.7);
/* expected final home margin: implied by ESPN's win probability when we have it, else from the betting line */
const E=g=>{const w=espnWP(g);return w!=null?sd(g)*Pinv(Math.min(.99,Math.max(.01,w))):marg(g)+MU(g)*rem(g)/3600};
const pm=(g,s)=>done(g)?(marg(g)>s?1:0):Phi((E(g)-s)/sd(g));
const pt=(g,s)=>{const n=g.home.score+g.away.score;if(done(g))return n>s?1:0;const f=rem(g)/3600;return Phi((n+TOT(g)*f-s)/Math.max(10*Math.sqrt(f),.7))};
const srcOf=g=>{const w=W[g.id];return espnWP(g)!=null?(w.src==='wp'?'ESPN win probability':'ESPN matchup predictor'):Number.isFinite(g.mu)?'ESPN betting line':'No ESPN odds yet (even-odds estimate)'};
/* leg = {gid,k:'w'|'p'|'t',team,s,yes}: w = team wins, p = team wins by over s, t = total points over s */
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

/* ---------- ESPN win probability feed ---------- */
async function fetchWP(g){
  try{
    const j=await FG.getJSON(FG.summaryUrl(g.id),12000),norm=v=>{v=Number(v);return Number.isFinite(v)?(v>1?v/100:v):null};
    const series=(Array.isArray(j.winprobability)?j.winprobability:[]).map(x=>norm(x.homeWinPercentage)).filter(v=>v!==null);
    let last=series.length?series[series.length-1]:null,src=series.length?'wp':null;
    if(last===null){const pr=norm(j.predictor?.homeTeam?.gameProjection);if(pr!==null){last=pr;src='pred'}}
    W[g.id]={series,last,src,t:Date.now(),fin:done(g)};
  }catch(_){W[g.id]=Object.assign({series:[],last:null,src:null},W[g.id]||{},{t:Date.now()})}
}
async function pollWP(){
  const todo=G().filter(g=>{const w=W[g.id];if(!w)return true;const age=Date.now()-w.t;return done(g)?!w.fin:g.state==='in'?age>20000:age>600000});
  for(let i=0;i<todo.length;i+=4)await Promise.all(todo.slice(i,i+4).map(fetchWP));
  if(todo.length)refresh();
}

/* ---------- building blocks ---------- */
const logo=t=>t.logo?`<img class="mk-logo" src="${esc(t.logo)}" alt="" loading="lazy">`:`<span class="mk-bd" style="background:${esc(t.color||'#556677')}">${esc(t.abbr)}</span>`;
function btn(g,k,team,s,yes,text){const l={gid:g.id,k,team,s,yes:!!yes},sel=legs.some(x=>x.gid===g.id&&x.k===k&&x.team===team&&x.s===s&&x.yes===!!yes);
  return`<button type="button" class="mk-px ${yes?'mk-y':'mk-n'}${sel?' sel':''}" data-l="${[g.id,k,team,s,yes?1:0].join('|')}" aria-pressed="${sel}"${done(g)?' disabled':''}>${text||(yes?'Yes':'No')} ${ask(mp(g,l))}¢</button>`}
const mrow=(g,k,team,s,title,sub)=>`<div class="mk-row"><div class="mk-tm">${esc(title)}<small>${esc(sub||'')}</small></div><div class="mk-pct">${pc(mp(g,{gid:g.id,k,team,s,yes:true}))}%</div>${btn(g,k,team,s,1)}${btn(g,k,team,s,0)}</div>`;
const bar=(aw,hw)=>`<div class="mk-bar"><i class="a" style="width:${(aw*100).toFixed(1)}%"></i><i class="h" style="flex:1"></i></div>`;

/* compact market strip inside every game card */
function cardRow(g){
  const hw=pm(g,0),aw=1-hw;
  return`<div class="mk-cardrow"><div class="mk-split"><span class="a">${esc(g.away.abbr)} ${pc(aw)}%</span>${bar(aw,hw)}<span class="h">${pc(hw)}% ${esc(g.home.abbr)}</span></div>
  <div class="mk-btnrow">${btn(g,'w',g.away.abbr,0,1,esc(g.away.abbr)+' wins')}${btn(g,'w',g.home.abbr,0,1,esc(g.home.abbr)+' wins')}</div>
  <div class="mk-lines">${g.oddsDetail?`<span>Spread ${esc(g.oddsDetail)}</span>`:''}${Number.isFinite(g.totalLine)?`<span>O/U ${g.totalLine}</span>`:''}<span>${esc(srcOf(g))}</span></div></div>`}

/* ESPN-style win probability chart */
function chart(g){
  const w=W[g.id],s=w&&w.series||[],hw=pm(g,0);
  if(s.length<2)return`<div class="mk-pre"><div class="mk-split"><span class="a">${esc(g.away.short)} ${pc(1-hw)}%</span>${bar(1-hw,hw)}<span class="h">${pc(hw)}% ${esc(g.home.short)}</span></div><p class="mk-cap">The win-probability chart appears here once the game starts. Until then the prices come from ${esc(srcOf(g))}.</p></div>`;
  const X=i=>(10+i/(s.length-1)*880).toFixed(1),Y=p=>(180-p*170).toFixed(1),line=(f,c)=>`<polyline fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round" points="${s.map((v,i)=>X(i)+','+Y(f(v))).join(' ')}"/>`;
  const last=s[s.length-1];
  return`<svg class="mk-chart" viewBox="0 0 900 190" preserveAspectRatio="none" role="img" aria-label="Win probability for each team through the game"><g stroke="var(--line)"><line x1="10" x2="890" y1="${Y(1)}" y2="${Y(1)}"/><line x1="10" x2="890" y1="${Y(.5)}" y2="${Y(.5)}" stroke-dasharray="4 4"/><line x1="10" x2="890" y1="${Y(0)}" y2="${Y(0)}"/></g>${line(v=>1-v,'var(--blue)')}${line(v=>v,'var(--green)')}</svg>
  <div class="mk-key"><span><i style="background:var(--blue)"></i>${esc(g.away.short)} ${pc(1-(done(g)?(marg(g)>0?1:0):last))}%</span><span><i style="background:var(--green)"></i>${esc(g.home.short)} ${pc(done(g)?(marg(g)>0?1:0):last)}%</span></div>
  <p class="mk-cap">${done(g)?'Final win-probability trace from ESPN.':'ESPN win probability, updated play by play. Contract prices follow this line.'}</p>`}

/* full market panel on the game page */
function detail(g){
  const b=Math.round(TOT(g)-.5)+.5;
  let h=`<div class="panel mk-panel"><div class="panel-head"><h3>Win probability &amp; markets</h3><span>Play money · prices from ${esc(srcOf(g))}</span></div>${chart(g)}
  <div class="mk-tabs" role="tablist">${[['w','Winner'],['p','Spread'],['t','Total']].map(x=>`<button type="button" role="tab" data-mk="tab" data-v="${x[0]}" class="${mt===x[0]?'on':''}">${x[1]}</button>`).join('')}</div><div>`;
  if(mt==='w')[g.away,g.home].forEach(t=>h+=mrow(g,'w',t.abbr,0,`${t.short} to win`,'Includes overtime'));
  if(mt==='p')[g.away,g.home].forEach(t=>[3.5,6.5,10.5,13.5].forEach(s=>h+=mrow(g,'p',t.abbr,s,`${t.short} wins by over ${s}`,'Margin of victory')));
  if(mt==='t')[-6,-3,0,3,6].map(d=>b+d).filter(s=>s>0).forEach(s=>h+=mrow(g,'t','',s,`Over ${s} points`,'Combined score, includes overtime'));
  return h+'</div><p class="mk-cap">Each contract pays $1.00 if it resolves Yes and $0 if No, and settles on the final score. Add legs from different games to build a combo.</p></div>'}

/* ---------- order dock ---------- */
function calc(){const p=prod(legs,ask),c=qty*p,f=fee(qty,p);return{p,c,f,t:c+f}}
function slipVisible(){return legs.length&&['scoreboardView','detailView','portfolioView'].some(id=>$(id)&&!$(id).hidden)}
function slip(){
  let el=$('mkSlip');if(!el){el=document.createElement('aside');el.id='mkSlip';el.className='mk-slip';el.setAttribute('aria-label','Order');document.body.appendChild(el)}
  if(!slipVisible()){el.hidden=true;return}el.hidden=false;
  const one=legs.length===1,l0=legs[0],k=calc();
  let h=`<button type="button" class="mk-slip-head" data-mk="toggle" aria-expanded="${expanded}"><b>${one?'Buy '+(l0.yes?'Yes':'No'):legs.length+'-leg combo'}</b><span>${legs.length} leg${legs.length>1?'s':''} · ${money(k.t)} <i>${expanded?'▾':'▴'}</i></span></button>`;
  if(expanded){
    if(one){const g=find(l0.gid);h+=`<div class="mk-seg"><button type="button" class="mk-y${l0.yes?' on':''}" data-mk="flip" data-v="1">Yes ${ask(mp(g,{...l0,yes:true}))}¢</button><button type="button" class="mk-n${l0.yes?'':' on'}" data-mk="flip" data-v="0">No ${ask(mp(g,{...l0,yes:false}))}¢</button></div>`}
    legs.forEach((l,i)=>{const g=find(l.gid);h+=`<div class="mk-leg"><b>${l.yes?'Yes':'No'}: ${esc(lab(l,g))}<small>${esc(g.away.short)} at ${esc(g.home.short)}</small></b><span>${ask(mp(g,l))}¢</span><button type="button" data-mk="x" data-v="${i}" aria-label="Remove leg">×</button></div>`});
    h+=`<div class="mk-sum"><span>Price per contract</span><b id="k-p"></b></div><label class="mk-sum" for="mkQty"><span>Contracts</span></label><input type="number" id="mkQty" min="1" step="1" value="${qty}"><div class="mk-sum"><span>Cost</span><b id="k-c"></b></div><div class="mk-sum"><span>Fee</span><b id="k-f"></b></div><div class="mk-sum"><span>Payout if Yes hits</span><b id="k-o" style="color:var(--green)"></b></div><div class="mk-sum"><span>Max profit</span><b id="k-m"></b></div><button type="button" class="mk-cta" id="mkBuy" data-mk="buy"></button><button type="button" class="mk-cta gh" data-mk="clear">Clear</button><div class="mk-err">${esc(msg)}</div>`}
  el.innerHTML=h;fill()}
function fill(){if(!legs.length||!expanded||!$('k-p'))return;const k=calc();$('k-p').textContent=(k.p*100).toFixed(k.p<.1?1:0)+'¢';$('k-c').textContent=money(k.c);$('k-f').textContent=money(k.f);$('k-o').textContent=money(qty);$('k-m').textContent=money(qty-k.t);
  const b=$('mkBuy');b.textContent=(legs.length>1?'Buy combo · ':'Buy '+(legs[0].yes?'Yes':'No')+' · ')+money(k.t);b.disabled=!(qty>=1&&k.t<=cash())}

/* ---------- portfolio ---------- */
function portfolio(){
  const host=$('portfolioView');if(!host)return;
  const c=cash(),ov=openVal(),pl=c+ov-START,picks=Object.keys(FG.state.picks||{}).length;
  let h=`<div class="page-head"><div><div class="eyebrow">Play money · no real wagering</div><h1>Portfolio</h1><p>Your open contracts, results and cash. Place new orders from the Games tab.</p></div><div class="mk-stats"><div class="mk-stat"><small>Cash</small><b>${money(c)}</b></div><div class="mk-stat"><small>Open value</small><b>${money(ov)}</b></div><div class="mk-stat"><small>Profit / loss</small><b style="color:var(--${pl>=0?'green':'red'})">${pl>0?'+':''}${money(pl)}</b></div></div></div>`;
  if(!S.pos.length)h+=`<div class="empty"><h3>No positions yet</h3><p>Pick a team’s Yes price on any game card to place your first order.</p><button type="button" class="retry" data-mk="games">Go to Games</button></div>`;
  S.pos.slice().reverse().forEach(p=>{const s=p.sold?'sold':st(p),v=val(p),cost=p.n*p.px+p.fee,pl=v-cost;
    h+=`<div class="mk-card mk-pos"><div class="mk-top"><span>${p.legs.length>1?p.legs.length+'-leg combo':'Position'}</span><span class="mk-tag ${s}">${{open:'Open',won:'Won',lost:'Lost',sold:'Sold'}[s]}</span></div><ul>`+
    p.legs.map(l=>{const g=find(l.gid),e=ev(l);return`<li class="${e===true?'w':e===false?'l':''}">${e===true?'✓':e===false?'✗':'•'} ${l.yes?'Yes':'No'}: ${esc(lab(l,g))} (${esc(g.away.abbr)} at ${esc(g.home.abbr)})${done(g)?` – final ${g.away.score}-${g.home.score}`:''}</li>`}).join('')+
    `</ul><div class="mk-figs"><span><b>${p.n}</b> contracts</span><span>Avg <b>${(p.px*100).toFixed(p.px<.1?1:0)}¢</b></span><span>Cost <b>${money(cost)}</b></span><span>${s==='open'?'Value':'Returned'} <b>${money(v)}</b></span><span>P&amp;L <b style="color:var(--${pl>=0?'green':'red'})">${pl>0?'+':''}${money(pl)}</b></span>${s==='open'?`<button type="button" class="mk-sell" data-mk="sell" data-v="${p.id}">Sell at ${pc(prod(p.legs,bid))}¢</button>`:''}</div></div>`});
  if(S.pos.length)h+='<button type="button" class="mk-cta gh" data-mk="reset" style="max-width:280px">Reset play-money account</button>';
  h+=picks?'<div id="pfPicks" class="pf-picks"></div>':'';
  host.innerHTML=h;if(picks&&FG.renderPicksPage)FG.renderPicksPage();
}

/* ---------- refresh + events ---------- */
function refresh(){
  const vis=id=>$(id)&&!$(id).hidden;
  if(vis('detailView')&&FG.state.selectedId)FG.renderDetail();else if(vis('scoreboardView'))FG.renderGames();
  if(vis('portfolioView'))portfolio();
  slip();
}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-l],[data-mk]');if(!t)return;e.stopPropagation();e.preventDefault&&0;msg='';
  if(t.dataset.l){const[gid,k,team,s,y]=t.dataset.l.split('|'),n={gid,k,team,s:+s,yes:y==='1'},i=legs.findIndex(l=>l.gid===gid&&(l.k==='t')===(k==='t'));
    if(i>=0&&legs[i].k===k&&legs[i].team===team&&legs[i].s===n.s&&legs[i].yes===n.yes)legs.splice(i,1);else if(i>=0)legs[i]=n;else if(legs.length<8)legs.push(n);else msg='Combos max out at 8 legs.';if(innerWidth>700)expanded=true;return refresh()}
  const a=t.dataset.mk,v=t.dataset.v;
  if(a==='tab'){mt=v;return refresh()}if(a==='toggle'){expanded=!expanded;return slip()}
  if(a==='x'){legs.splice(+v,1);return refresh()}if(a==='clear'){legs=[];return refresh()}if(a==='flip'){legs[0].yes=v==='1';return refresh()}
  if(a==='games'){document.getElementById('nav-scoreboard').click();return}
  if(a==='buy'){const k=calc();if(!(qty>=1)||k.t>cash()){msg='Not enough play-money cash for that order.';return slip()}
    legs.forEach(l=>{S.gs[l.gid]=JSON.parse(JSON.stringify(find(l.gid)))});S.pos.push({id:Date.now(),legs:legs.slice(),n:qty,px:k.p,fee:k.f});legs=[];save();FG.toast&&FG.toast('Order filled (play money). See it in Portfolio.');return refresh()}
  if(a==='sell'){const p=S.pos.find(x=>x.id==v),b=prod(p.legs,bid);p.sold={pr:Math.round((p.n*b-fee(p.n,b))*100)/100};save();return refresh()}
  if(a==='reset'&&confirm('Wipe all positions and start over with $10,000 play money?')){S.pos=[];legs=[];save();refresh()}
},true);
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest&&e.target.closest('[data-l]'))e.stopPropagation()},true);
document.addEventListener('input',e=>{if(e.target.id==='mkQty'){qty=Math.max(0,Math.floor(+e.target.value||0));fill()}});

function tick(){
  const gs=G();if(!gs.length)return;
  S.pos.forEach(p=>p.legs.forEach(l=>{const g=gs.find(x=>x.id===l.gid);if(g)S.gs[g.id]=JSON.parse(JSON.stringify(g))}));
  legs=legs.filter(l=>{const g=find(l.gid);return g&&!done(g)});save();pollWP();
}
/* show/hide the order dock as the user moves between tabs */
const mo=new MutationObserver(()=>slip());['scoreboardView','detailView','portfolioView'].forEach(id=>{const el=$(id);if(el)mo.observe(el,{attributes:true,attributeFilter:['hidden']})});
FG.mk={cardRow:g=>{try{return cardRow(g)}catch(_){return''}},detail:g=>{try{return detail(g)}catch(_){return''}},portfolio,refresh,slip};
setInterval(tick,10000);
/* start the first ESPN win-probability fetch the moment the scoreboard has games */
const boot=setInterval(()=>{if(G().length){clearInterval(boot);tick()}},300);
})();
