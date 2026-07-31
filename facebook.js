/* ============================================================
   Lockhern — Account Pacing · FACEBOOK tab
   ------------------------------------------------------------
   Loaded after index.html's main script, so it shares its
   globals directly: state, jsonp, ctx, money, pct, xfmt, intf,
   statusOf, meterHTML, esc, labelDate, monthLabel, shiftKey,
   toNum, normMonth, normDate, todayIso, chartSVG, niceMax,
   daysInMonthOf, fmtInt, topbarHTML, render, BURN_* constants.

   Facebook data is CAMPAIGN-level by date. We roll campaigns up
   to an account rollup (level 1) and keep per-campaign pacing
   (level 2), because social managers budget by campaign.

   Budgets are stored per campaign (Account + Campaign + Month)
   in the Facebook_Budgets tab, separate from Google/Microsoft.
   ============================================================ */
(function(){
var FB = window.FB = {};
var FB_RATE_DAYS = 3;                 // recent-rate window for "trending to"
var fbSaveTimers = {};

/* ---- state fields this module owns (index.html doesn't declare them) ---- */
state.fbOpen        = state.fbOpen || {};
state.fbCampOpen    = state.fbCampOpen || {};
state.fbBudgets     = state.fbBudgets || {};
state.fbAccounts    = state.fbAccounts || [];
state.fbCampaignsBy = state.fbCampaignsBy || {};
state.fbRaw         = state.fbRaw || [];
if(state.fbSave==null)       state.fbSave='idle';
if(state.fbDetailDays==null) state.fbDetailDays=30;
/* state.fbSource stays undefined until the first load */

/* ---- one-time CSS (kept with the module) ---- */
(function injectCSS(){
  var css =
    '.fbgrid{display:grid;grid-template-columns:26px 2.5fr .9fr .9fr 1.05fr 1.1fr .95fr 1fr .8fr .8fr .7fr 40px;align-items:center;gap:10px;padding:0 16px;min-width:1120px;}'
  + '.fbhead{height:38px;background:#FAFBFC;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600;}'
  + '.fbrow{height:54px;cursor:pointer;font-size:14px;}'
  + '.fbrow:hover{background:#FAFBFC;}'
  + '.fbblock{border-bottom:1px solid var(--line2);}'
  + '.fbblock:last-child{border-bottom:none;}'
  + '.fbcamps{background:#FBFCFD;border-top:1px dashed var(--line);}'
  + '.fbcrow{height:48px;cursor:pointer;font-size:13px;}'
  + '.fbcrow:hover{background:#F4F7FA;}'
  + '.fbcrow .c-name{padding-left:14px;}'
  + '.fbcblock{border-bottom:1px solid var(--line2);}'
  + '.fbcblock:last-child{border-bottom:none;}'
  + '.fbstatus{font-size:9px;font-weight:700;border-radius:4px;padding:1px 5px;letter-spacing:.03em;text-transform:uppercase;}'
  + '.fbstatus.on{color:var(--good);background:var(--good-bg);}'
  + '.fbstatus.off{color:var(--faint);background:var(--line2);}'
  + '.fbdetail{padding:2px 16px 18px 30px;background:#F7FAFC;border-top:1px dashed var(--line);}'
  + '.fbbudgetbox{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--editbg);border:1px solid var(--editline);border-radius:10px;padding:10px 13px;margin:12px 0;}'
  + '.fbbudgetbox .bb-title{margin:0;}'
  + '.fbmeta{font-size:11px;color:var(--faint);font-weight:600;}';
  var el=document.createElement('style'); el.textContent=css; document.head.appendChild(el);
})();

/* ---- key helpers ---- */
function fbKey(account, campaign){ return account+'||'+campaign; }
function byDate(a,b){ return a.date<b.date?-1:(a.date>b.date?1:0); }

/* ============================================================
   LOAD
   ============================================================ */
FB.load = function(force){
  if(state.fbSource==='loading') return;
  if(!force && state.fbSource==='live') return;
  if(WEBAPP_URL.indexOf('http')!==0){ state.fbSource='sample'; state.fbRaw=[]; FB.rebuild(); render(); return; }
  state.fbSource='loading'; render();
  jsonp({ action:'fbData' }).then(function(res){
    if(!res || !res.ok) throw new Error(res && res.error || 'bad response');
    state.fbRaw = res.rows || [];
    state.fbBudgets = fbBudgetsToMap(res.budgets || []);
    FB.rebuild();
    state.fbSource='live'; render();
  }).catch(function(err){
    state.fbSource='error'; state.fbError=String(err&&err.message||err); render();
  });
};

function fbBudgetsToMap(rows){
  var out={};
  (rows||[]).forEach(function(r){
    var month=normMonth(r.Month), acct=String(r.Account||'').trim(), camp=String(r.Campaign||'').trim();
    if(!month||!acct) return;
    (out[month]=out[month]||{})[fbKey(acct,camp)]={ mode:fbMode(r.Mode), amount:toNum(r.Amount) };
  });
  return out;
}
function fbMode(m){ m=String(m||'manual'); return (m==='lastMonth'||m==='daily')?m:'manual'; }

/* ============================================================
   BUILD — campaigns + account rollups
   ============================================================ */
FB.rebuild = function(){
  var camps={};                                   // account -> campaign -> {..., dayMap}
  (state.fbRaw||[]).forEach(function(r){
    var acct=String(r.a||'').trim(), camp=String(r.c||'').trim(), date=normDate(r.d);
    if(!acct || !date) return;
    var byC = camps[acct] || (camps[acct]={});
    var o = byC[camp] || (byC[camp]={ account:acct, campaign:camp||'(unnamed campaign)', tags:r.tg||'', status:r.st||'', dailyBudget:0, dayMap:{} });
    var db=toNum(r.db); if(db>o.dailyBudget) o.dailyBudget=db;   // Facebook daily budget (max seen)
    if(r.st) o.status=r.st;                                      // latest status wins
    var dm = o.dayMap[date] || (o.dayMap[date]={ date:date, cost:0, imp:0, clk:0, wc:0, fl:0, val:0 });
    dm.cost+=toNum(r.cost); dm.imp+=toNum(r.imp); dm.clk+=toNum(r.clk);
    dm.wc+=toNum(r.wc); dm.fl+=toNum(r.fl); dm.val+=toNum(r.val);
  });

  state.fbCampaignsBy = {};                        // account -> [campaign,...]
  state.fbAccounts = Object.keys(camps).map(function(acct){
    var list = Object.keys(camps[acct]).map(function(camp){
      var o=camps[acct][camp];
      o.daily = Object.keys(o.dayMap).map(function(k){ return o.dayMap[k]; }).sort(byDate);
      delete o.dayMap;
      return o;
    }).sort(function(x,y){ return x.campaign.localeCompare(y.campaign); });
    state.fbCampaignsBy[acct]=list;

    // merged account daily series (sum campaigns by date)
    var mm={};
    list.forEach(function(c){ c.daily.forEach(function(p){
      var d=mm[p.date]||(mm[p.date]={date:p.date,cost:0,imp:0,clk:0,wc:0,fl:0,val:0});
      d.cost+=p.cost; d.imp+=p.imp; d.clk+=p.clk; d.wc+=p.wc; d.fl+=p.fl; d.val+=p.val;
    }); });
    var daily=Object.keys(mm).map(function(k){return mm[k];}).sort(byDate);
    return { account:acct, campaigns:list, daily:daily };
  }).sort(function(x,y){ return x.account.localeCompare(y.account); });
};

/* ============================================================
   AGGREGATION + PACING MATH (shared by campaign & account)
   ============================================================ */
function aggMonth(daily, ym){
  var o={cost:0,wc:0,fl:0,val:0,imp:0,clk:0};
  daily.forEach(function(p){ if(String(p.date).slice(0,7)===ym){ o.cost+=p.cost;o.wc+=p.wc;o.fl+=p.fl;o.val+=p.val;o.imp+=p.imp;o.clk+=p.clk; } });
  return o;
}

// budget for one campaign (with carry-forward; default = the sheet's daily budget × days)
function campGetBudget(camp){
  var month=state.viewMonth, key=fbKey(camp.account,camp.campaign);
  var ex = state.fbBudgets[month] && state.fbBudgets[month][key];
  if(ex) return { mode:ex.mode, amount:ex.amount, inherited:false };
  var k=month;
  for(var i=0;i<12;i++){ k=shiftKey(k,-1); var b=state.fbBudgets[k]&&state.fbBudgets[k][key]; if(b) return { mode:b.mode, amount:b.amount, inherited:true, from:k }; }
  return { mode:'daily', amount:0, inherited:false, isDefault:true };   // no budget set → track against the FB daily budget
}
function campEffBudget(camp, b){
  b = b || campGetBudget(camp);
  if(b.mode==='lastMonth') return aggMonth(camp.daily, shiftKey(state.viewMonth,-1)).cost;
  if(b.mode==='daily')     return (camp.dailyBudget||0) * ctx().dim;
  return b.amount;
}

// generic pace for a "unit" = { mtd, effBudget, daily } (daily rows use .cost as spend)
function unitPace(mtd, effBudget, daily){
  var c=ctx();
  var forecast = c.isLive && c.elapsed>0 ? (mtd/c.elapsed)*c.dim : null;
  var pace = effBudget>0 && forecast!=null ? forecast/effBudget : null;
  var variance = forecast!=null ? forecast-effBudget : null;
  return { forecast:forecast, pace:pace, variance:variance, effBudget:effBudget, mtd:mtd };
}
function unitProjection(daily, effBudget){
  var c=ctx(); if(!c.isLive) return null;
  var hist=daily.filter(function(p){ return String(p.date)<todayIso(); });
  if(!hist.length) return null;
  var spent=0; hist.forEach(function(p){ if(String(p.date).slice(0,7)===state.viewMonth) spent+=p.cost; });
  var recent=hist.slice(-FB_RATE_DAYS), rate=0; recent.forEach(function(p){ rate+=p.cost; });
  rate = recent.length ? rate/recent.length : 0;
  var daysLeft=Math.max(0, c.dim-c.elapsed);
  var proj=spent+rate*daysLeft;
  return { proj:proj, rate:rate, daysLeft:daysLeft, spent:spent, days:recent.length,
           pct:effBudget>0?proj/effBudget:null, gap:effBudget>0?proj-effBudget:null };
}
function unitBurn(mtd, effBudget, daily){
  if(!ctx().isLive) return null;
  var c=ctx(); var daysLeft=Math.max(0,c.dim-c.elapsed);
  var hist=daily.filter(function(p){ return String(p.date)<todayIso(); });
  if(hist.length<3 || daysLeft<2 || !(effBudget>=BURN_MIN_BUDGET)) return null;
  var remaining=effBudget-mtd;
  var recent=hist.slice(-3), rate=0; recent.forEach(function(p){ rate+=p.cost; }); rate/=recent.length;
  if(remaining<=0){
    return { level:'critical', tag:'over budget',
      text:'Budget already spent — '+money(Math.abs(remaining))+' over with '+daysLeft+' day'+(daysLeft===1?'':'s')+' still to go' };
  }
  if(rate<=0) return null;
  var runout=remaining/rate;
  if(runout>=daysLeft) return null;
  var early=daysLeft-runout;
  var lvl = early>=BURN_CRIT_DAYS ? 'critical' : (early>=BURN_WARN_DAYS ? 'warning' : null);
  if(!lvl) return null;
  var out=new Date(); out.setDate(out.getDate()+Math.max(0,Math.round(runout)));
  var iso=out.getFullYear()+'-'+('0'+(out.getMonth()+1)).slice(-2)+'-'+('0'+out.getDate()).slice(-2);
  var e=Math.round(early);
  return { level:lvl, date:iso, tag:'out '+labelDate(iso),
    text:'Burning '+money(rate)+'/day — the '+money(remaining)+' left runs out around '+labelDate(iso)+' ('+e+' day'+(e===1?'':'s')+' early)' };
}

// one bundle of everything a row needs
function campDerive(camp){
  var view=aggMonth(camp.daily, state.viewMonth);
  var b=campGetBudget(camp), eff=campEffBudget(camp,b);
  var p=unitPace(view.cost, eff, camp.daily);
  p.wc=view.wc; p.fl=view.fl; p.val=view.val;
  p.roas = view.val>0 && view.cost>0 ? view.val/view.cost : null;
  p.budget=b; p.proj=unitProjection(camp.daily, eff); p.burn=unitBurn(view.cost, eff, camp.daily);
  return p;
}
function acctDerive(acc){
  // account budget = sum of its campaign effective budgets
  var eff=0, mtd=0, wc=0, fl=0, val=0;
  acc.campaigns.forEach(function(c){
    var b=campGetBudget(c); eff+=campEffBudget(c,b);
    var a=aggMonth(c.daily, state.viewMonth); mtd+=a.cost; wc+=a.wc; fl+=a.fl; val+=a.val;
  });
  var p=unitPace(mtd, eff, acc.daily);
  p.wc=wc; p.fl=fl; p.val=val;
  p.roas = val>0 && mtd>0 ? val/mtd : null;
  p.proj=unitProjection(acc.daily, eff); p.burn=unitBurn(mtd, eff, acc.daily);
  return p;
}

/* ============================================================
   RENDER
   ============================================================ */
FB.render = function(baseHtml){
  var html = baseHtml || topbarHTML();
  var c=ctx(), isLive=c.isLive;

  if(state.fbSource==='loading' || state.fbSource==null){
    html += '<div class="empty">Loading Facebook data from the sheet…</div>';
    document.getElementById('app').innerHTML=html; return;
  }
  if(state.fbSource==='error'){
    html += '<div class="banner warn"><span>Couldn’t load the Facebook sheet'+(state.fbError?(' — '+esc(state.fbError)):'')+'. Check the gateway has access to the FB spreadsheet and was redeployed as a new version.</span><button data-act="fb-refresh">Retry</button></div>';
    document.getElementById('app').innerHTML=html; return;
  }

  var accounts=(state.fbAccounts||[]).slice();
  // summary
  var t={mtd:0,forecast:0,budget:0,proj:0};
  accounts.forEach(function(a){ var d=acctDerive(a); t.mtd+=d.mtd; t.forecast+=d.forecast||0; t.budget+=d.effBudget||0; t.proj+=(d.proj?d.proj.proj:(d.forecast||0)); });
  t.pace = isLive&&t.budget>0 ? t.forecast/t.budget : null;
  t.variance = isLive ? t.forecast-t.budget : null;
  var cellL=function(v){ return isLive?v:'—'; };

  html += '<div class="summary">'
    + stat('MTD spend', cellL(money(t.mtd)))
    + stat('Forecast', cellL(money(t.forecast)))
    + stat('Budget (rollup)', money(t.budget))
    + '<div class="stat stat-pace"><div class="stat-label">Facebook pace</div>'
    + (isLive
        ? '<div class="pace-row"><span class="pace-num t-'+statusOf(t.pace)+'">'+pct(t.pace)+'</span><span class="pace-var t-'+(t.variance>0?'over':'good')+'">'+(t.variance>0?'+':'')+money(t.variance,true)+' vs budget</span></div>'+meterHTML(t.pace,statusOf(t.pace))
        : '<div class="pace-plan">Set budgets for '+esc(monthLabel(state.viewMonth))+'</div>')
    + '</div></div>';

  // toolbar
  html += '<div class="toolbar"><div class="tcount">Accounts <span class="badge">'+accounts.length+'</span>'
    + '<span class="filtertag">Facebook · Active only</span></div>'
    + '<div class="tactions">'
    + (isLive?('<label class="dayctl">Day <input class="dayin" id="fb-day-input" inputmode="numeric" value="'+c.elapsed+'"> of '+c.dim+' <span class="daypct">· '+Math.round(c.elapsed/c.dim*100)+'%</span></label>'):'')
    + '<span class="saveind '+state.fbSave+'" id="fb-saveind">'+fbSaveText()+'</span>'
    + '<button class="btn" data-act="fb-refresh">↻ Refresh</button></div></div>';

  if(!accounts.length){
    html += '<div class="empty"><p class="empty-head">No Facebook accounts</p>'
      + '<p class="empty-sub">No rows in <b>FB - Daily</b> are flagged <b>Active</b> in column M, or the sheet is empty. Mark the accounts you manage, then refresh.</p>'
      + '<button class="btn primary" data-act="fb-refresh">Refresh</button></div>';
    document.getElementById('app').innerHTML=html; return;
  }

  html += '<div class="tablewrap"><div class="tscroll"><div class="fbgrid fbhead">'
    + '<div></div><div class="c-name">Account / Campaign</div>'
    + '<div class="c-num">MTD spend</div><div class="c-num">Forecast</div>'
    + '<div class="c-budget">Budget</div><div class="c-pace">Pace to budget</div>'
    + '<div class="c-num">Δ vs budget</div><div class="c-num">Trending to</div>'
    + '<div class="c-num">Web conv</div><div class="c-num">FB leads</div><div class="c-num">ROAS</div><div></div></div>';

  accounts.forEach(function(a){ html += acctRowHTML(a,isLive); });

  // totals
  html += '<div class="fbgrid totalrow"><div></div><div class="c-name">Facebook total</div>'
    + '<div class="c-num strong">'+cellL(money(t.mtd,true))+'</div>'
    + '<div class="c-num">'+cellL(money(t.forecast,true))+'</div>'
    + '<div class="c-budget total-budget">'+money(t.budget,true)+'</div>'
    + '<div class="c-pace">'+(isLive?('<span class="pacepct t-'+statusOf(t.pace)+'">'+pct(t.pace)+'</span>'+meterHTML(t.pace,statusOf(t.pace))):'<span class="pace-na">—</span>')+'</div>'
    + '<div class="c-num '+(t.variance>0?'neg':'pos')+'">'+(isLive&&t.variance!=null?((t.variance>0?'+':'')+money(t.variance,true)):'—')+'</div>'
    + '<div class="c-num">'+fbTrendTot(t,isLive)+'</div>'
    + '<div class="c-num">—</div><div class="c-num">—</div><div class="c-num">—</div><div></div></div>';

  html += '</div></div>';
  html += '<div class="foot"><span>Account budget = sum of its campaign budgets.</span><span class="foot-dot">·</span>'
    + '<span>Default campaign budget = the sheet’s <b>Daily budget × days in month</b> until you set one.</span><span class="foot-dot">·</span>'
    + '<span>Only rows marked <b>Active</b> (column M) are shown.</span></div>';

  document.getElementById('app').innerHTML=html;
};

function stat(label,value){ return '<div class="stat"><div class="stat-label">'+label+'</div><div class="stat-value">'+value+'</div></div>'; }
function fbSaveText(){ return state.fbSave==='saving'?'Saving…':(state.fbSave==='saved'?'✓ Saved':'Shared with team'); }
function fbUpdateSaveInd(){ var el=document.getElementById('fb-saveind'); if(el){ el.className='saveind '+state.fbSave; el.textContent=fbSaveText(); } }

function trendCellHTML(proj, burn){
  if(!proj) return '<div class="c-num cell-trend">—</div>';
  var st = burn ? 'over' : statusOf(proj.pct);
  var note = burn ? burn.tag
    : (proj.pct==null ? 'no budget'
      : (st==='good' ? 'on track'
      : (proj.gap>0 ? '+'+money(proj.gap,true)+' over' : money(Math.abs(proj.gap),true)+' under')));
  var tip = burn ? burn.text : ('At the recent rate: '+money(proj.spent,true)+' spent + '+money(proj.rate)+'/day × '+proj.daysLeft+' left');
  return '<div class="c-num cell-trend" title="'+esc(tip)+'"><span class="trendval t-'+st+'">'+money(proj.proj,true)+'</span>'
    + '<span class="trendnote t-'+st+(burn?' burn':'')+'">'+esc(note)+'</span></div>';
}
function fbTrendTot(t,isLive){
  if(!isLive) return '—';
  var pctv = t.budget>0 ? t.proj/t.budget : null, gap=t.budget>0?t.proj-t.budget:null, st=statusOf(pctv);
  var note = pctv==null?'—':(st==='good'?'on track':(gap>0?'+'+money(gap,true)+' over':money(Math.abs(gap),true)+' under'));
  return '<span class="trendval t-'+st+'">'+money(t.proj,true)+'</span><span class="trendnote t-'+st+'">'+esc(note)+'</span>';
}

/* ---- account rollup row ---- */
function acctRowHTML(a,isLive){
  var d=acctDerive(a), st=statusOf(d.pace), opn=!!state.fbOpen[a.account], cl=function(v){return isLive?v:'—';};
  var burnDot = d.burn ? ('<span class="alertdot '+(d.burn.level==='critical'?'crit':'')+'" title="'+esc(d.burn.text)+'">⚠</span>') : '';
  var html='<div class="fbblock'+(opn?' open':'')+'" data-fbarow="'+esc(a.account)+'">'
    + '<div class="fbgrid fbrow" data-act="fb-toggle" data-acct="'+esc(a.account)+'">'
    + '<div class="c-chev" style="justify-content:center"><span class="chev">▾</span></div>'
    + '<div class="c-name">'+burnDot+'<span class="acc-name" title="'+esc(a.account)+'">'+esc(a.account)+'</span>'
      + '<span class="acc-plats"><span class="tag">FB</span><span class="tag flat">'+a.campaigns.length+' camp'+(a.campaigns.length===1?'':'s')+'</span></span></div>'
    + '<div class="c-num strong fb-mtd">'+cl(money(d.mtd,true))+'</div>'
    + '<div class="c-num fb-forecast">'+cl(money(d.forecast,true))+'</div>'
    + '<div class="c-budget total-budget fb-abudget">'+money(d.effBudget,true)+'</div>'
    + '<div class="c-pace fb-pace">'+(isLive?('<span class="pacepct t-'+st+'">'+pct(d.pace)+'</span>'+meterHTML(d.pace,st)):'<span class="pace-na">—</span>')+'</div>'
    + '<div class="c-num fb-var '+(d.variance>0?'neg':'pos')+'">'+(isLive&&d.variance!=null?((d.variance>0?'+':'')+money(d.variance,true)):'—')+'</div>'
    + (isLive?trendCellHTML(d.proj,d.burn):'<div class="c-num cell-trend">—</div>')
    + '<div class="c-num">'+cl(intf(d.wc))+'</div>'
    + '<div class="c-num">'+cl(intf(d.fl))+'</div>'
    + '<div class="c-num">'+cl(xfmt(d.roas))+'</div>'
    + '<div class="c-chev"></div></div>';
  if(opn){
    html+='<div class="fbcamps">';
    a.campaigns.forEach(function(camp){ html+=campRowHTML(a,camp,isLive); });
    html+='</div>';
  }
  return html+'</div>';
}

/* ---- campaign pacing row (level 2) ---- */
function campRowHTML(a,camp,isLive){
  var d=campDerive(camp), st=statusOf(d.pace), key=fbKey(camp.account,camp.campaign);
  var opn=!!state.fbCampOpen[key], cl=function(v){return isLive?v:'—';};
  var b=d.budget;
  var statusOn = String(camp.status||'').toUpperCase().indexOf('ACTIVE')>=0;
  var carried = b.inherited ? '<span class="carried" title="Carried from '+esc(monthLabel(b.from))+'">↩</span>' : '';
  var budgetCell;
  if(b.mode==='manual'){
    budgetCell = carried+'<div class="budgetfield'+(b.inherited?' inherited':'')+'"><span class="bf-pre">$</span>'
      + '<input class="bf-in fb-budget-input" data-key="'+esc(key)+'" inputmode="numeric" value="'+(b.amount===0?'':fmtInt(b.amount))+'" placeholder="Set budget"></div>';
  } else {
    var tag = b.mode==='lastMonth'?'LM':'DB';
    var title = b.mode==='lastMonth'?'Using last month’s spend — click to set manually':'Using the Facebook daily budget × days — click to set manually';
    budgetCell = carried+'<button class="lmbudget fb-to-manual" data-key="'+esc(key)+'" data-amt="'+Math.round(d.effBudget)+'" title="'+esc(title)+'">'+money(d.effBudget)+' <span class="lm">'+tag+'</span></button>';
  }
  var burnDot = d.burn ? ('<span class="alertdot '+(d.burn.level==='critical'?'crit':'')+'" title="'+esc(d.burn.text)+'">⚠</span>') : '';
  var html='<div class="fbcblock'+(opn?' open':'')+'" data-fbrow="'+esc(key)+'">'
    + '<div class="fbgrid fbcrow" data-act="fb-camp-toggle" data-key="'+esc(key)+'">'
    + '<div></div>'
    + '<div class="c-name">'+burnDot+'<span class="acc-name" title="'+esc(camp.campaign)+'">'+esc(camp.campaign)+'</span>'
      + '<span class="acc-plats"><span class="fbstatus '+(statusOn?'on':'off')+'">'+(statusOn?'active':'paused')+'</span></span></div>'
    + '<div class="c-num strong fb-mtd">'+cl(money(d.mtd,true))+'</div>'
    + '<div class="c-num fb-forecast">'+cl(money(d.forecast,true))+'</div>'
    + '<div class="c-budget fb-budgetcell" data-noexpand="1">'+budgetCell+'</div>'
    + '<div class="c-pace fb-pace">'+(isLive?('<span class="pacepct t-'+st+'">'+pct(d.pace)+'</span>'+meterHTML(d.pace,st)):'<span class="pace-na">—</span>')+'</div>'
    + '<div class="c-num fb-var '+(d.variance>0?'neg':'pos')+'">'+(isLive&&d.variance!=null?((d.variance>0?'+':'')+money(d.variance,true)):'—')+'</div>'
    + (isLive?trendCellHTML(d.proj,d.burn):'<div class="c-num cell-trend">—</div>')
    + '<div class="c-num">'+cl(intf(d.wc))+'</div>'
    + '<div class="c-num">'+cl(intf(d.fl))+'</div>'
    + '<div class="c-num">'+cl(xfmt(d.roas))+'</div>'
    + '<div class="c-chev"><span class="chev">▾</span></div></div>';
  if(opn) html+=campDetailHTML(camp,d);
  return html+'</div>';
}

/* ---- campaign detail: budget mode + charts + daily table ---- */
function campDetailHTML(camp,d){
  var key=fbKey(camp.account,camp.campaign), b=d.budget;
  var box='<div class="fbbudgetbox"><div class="bb-title">'+esc(monthLabel(state.viewMonth))+' budget</div>'
    + '<div class="segment">'
    + '<button class="'+(b.mode==='manual'?'on':'')+'" data-act="fb-mode" data-key="'+esc(key)+'" data-mode="manual">Set manually</button>'
    + '<button class="'+(b.mode==='lastMonth'?'on':'')+'" data-act="fb-mode" data-key="'+esc(key)+'" data-mode="lastMonth">Use last month</button>'
    + '<button class="'+(b.mode==='daily'?'on':'')+'" data-act="fb-mode" data-key="'+esc(key)+'" data-mode="daily">FB daily budget</button>'
    + '</div>'
    + '<span class="fbmeta">'+(b.mode==='daily'?('FB daily budget '+money(camp.dailyBudget)+' × '+ctx().dim+' days = '+money(d.effBudget)):(b.mode==='lastMonth'?('Last month spend = '+money(d.effBudget)):('Effective '+money(d.effBudget))))+(camp.tags?(' · tags: '+esc(camp.tags)):'')+'</span>'
    + '</div>';
  var charts=fbChartsHTML(camp,d);
  return '<div class="fbdetail">'+box+charts+'</div>';
}

function fbChartsHTML(camp,d){
  var days=state.fbDetailDays||30;
  var all=camp.daily.filter(function(p){ return String(p.date)<todayIso(); });
  if(!all.length) return '<div class="fbmeta">No daily history yet.</div>';
  var daily=all.slice(-days);
  var dim=daysInMonthOf(state.viewMonth);
  var target = d.effBudget>0 ? d.effBudget/dim : 0;
  var cum=0, cexp=0;
  var rows=daily.map(function(p,i){
    cum+=p.cost; cexp+=target;
    return { i:i, date:p.date, cost:p.cost, cum:cum, expected:cexp, target:target,
             wc:p.wc, fl:p.fl, val:p.val, roas:(p.val>0&&p.cost>0)?p.val/p.cost:null, clicks:p.clk, impr:p.imp };
  });
  var n=rows.length, last=rows[n-1];
  var moneyY=function(v){return money(v,true);};
  var xTicks=(function(){ var k=Math.min(6,n),t=[]; for(var i=0;i<k;i++){ var idx=Math.round(i*(n-1)/((k-1)||1)); t.push({x:idx,label:labelDate(rows[idx].date)}); } return t; })();
  function px(key){ return rows.map(function(r){return [r.i,r[key]];}); }
  function pxf(key){ return rows.filter(function(r){return r[key]!=null;}).map(function(r){return [r.i,r[key]];}); }
  var hasRev = rows.some(function(r){return r.val>0;});

  var yDaily=niceMax(Math.max.apply(null,rows.map(function(r){return Math.max(r.cost,r.target);}).concat([1])));
  var dailyChart=chartSVG({xMin:0,xMax:n-1,yMax:yDaily,yFmt:moneyY,xTicks:xTicks,
    bars:{pts:px('cost'),colorFor:function(p){ var r=rows[p[0]]; if(!r.target) return '#9AA6B4';
      return r.cost>r.target*1.15?'#C13B2E':(r.cost<r.target*0.85?'#D9A63C':'#4A5568'); }},
    series:[{pts:px('target'),color:'#3A4FBF',dash:true}]});
  var cumChart=chartSVG({xMin:0,xMax:n-1,yMax:niceMax(Math.max(last.cum,last.expected,1)),yFmt:moneyY,xTicks:xTicks,
    series:[{pts:px('cum'),color:'#4A5568'},{pts:px('expected'),color:'#3A4FBF',dash:true}]});

  var charts='<div class="charts">'
    + '<div class="chartcard"><div class="ch-title">Daily spend vs target</div>'+dailyChart
      + '<div class="legend"><span class="lg"><i style="background:#4A5568"></i>On target</span><span class="lg"><i style="background:#D9A63C"></i>Under</span>'
      + '<span class="lg"><i style="background:#C13B2E"></i>Over</span><span class="lg"><i style="background:#3A4FBF"></i>Target/day</span></div>'
      + (target>0?('<div class="chnote">Target '+money(target)+'/day</div>'):'<div class="chnote">Set a budget to see the daily target</div>')+'</div>'
    + '<div class="chartcard"><div class="ch-title">Cumulative spend — actual vs expected</div>'+cumChart
      + '<div class="legend"><span class="lg"><i style="background:#4A5568"></i>Actual</span><span class="lg"><i style="background:#3A4FBF"></i>Expected</span></div></div>';
  if(hasRev){
    var roasChart=chartSVG({xMin:0,xMax:n-1,yMax:(function(){var v=rows.map(function(r){return r.roas;}).filter(function(x){return x!=null;});return niceMax(v.length?Math.max.apply(null,v):1);})(),yFmt:function(v){return v.toFixed(1)+'x';},xTicks:xTicks,series:[{pts:pxf('roas'),color:'#1B8A5A'}]});
    charts+='<div class="chartcard"><div class="ch-title">ROAS (daily)</div>'+roasChart+'</div>';
  }
  charts+='</div>';

  var rangebar='<div class="rangebar"><span class="rl">Last</span><div class="segment sm">'
    + [30,60,90].map(function(dd){return '<button class="'+(days===dd?'on':'')+'" data-act="fb-range" data-days="'+dd+'">'+dd+'d</button>';}).join('')
    + '</div><span class="rangecount">'+n+' days · '+labelDate(rows[0].date)+' – '+labelDate(last.date)+'</span></div>';

  var tbl='<table class="bd"><thead><tr><th>Day</th><th class="r">Spend</th><th class="r">Cumulative</th><th class="r">Expected</th><th class="r">Web conv</th><th class="r">FB leads</th>'
    + (hasRev?'<th class="r">Value</th><th class="r">ROAS</th>':'')
    + '<th class="r">Clicks</th><th class="r">Impr.</th></tr></thead><tbody>';
  rows.slice().reverse().forEach(function(r){ tbl+='<tr><td>'+labelDate(r.date)+'</td><td class="r">'+money(r.cost)+'</td><td class="r">'+money(r.cum)+'</td><td class="r">'+(r.expected?money(r.expected):'—')+'</td><td class="r">'+intf(r.wc)+'</td><td class="r">'+intf(r.fl)+'</td>'
    + (hasRev?('<td class="r">'+(r.val>0?money(r.val):'—')+'</td><td class="r">'+(r.roas==null?'—':(r.roas.toFixed(2)+'x'))+'</td>'):'')
    + '<td class="r">'+intf(r.clicks)+'</td><td class="r">'+intf(r.impr)+'</td></tr>'; });
  tbl+='</tbody></table>';

  return '<div class="detail">'+rangebar+charts+'<div class="ch-title" style="margin:16px 0 6px">Daily breakdown</div><div class="bd-wrap">'+tbl+'</div></div>';
}

/* ============================================================
   BUDGET SAVE + targeted (focus-preserving) updates
   ============================================================ */
function fbSetBudget(key, patch, skipRender){
  var month=state.viewMonth;
  var parts=key.split('||'), account=parts[0], campaign=parts.slice(1).join('||');
  var camp=fbFindCamp(account,campaign);
  var cur = camp ? campGetBudget(camp) : {mode:'manual',amount:0};
  var next=Object.assign({mode:cur.mode,amount:cur.amount},patch);
  (state.fbBudgets[month]=state.fbBudgets[month]||{})[key]=next;
  fbScheduleSave(account, campaign, month, next);
  if(!skipRender) render();
}
function fbScheduleSave(account, campaign, month, b){
  state.fbSave='saving'; fbUpdateSaveInd();
  var id=account+'||'+campaign+'|'+month;
  clearTimeout(fbSaveTimers[id]);
  fbSaveTimers[id]=setTimeout(function(){
    if(WEBAPP_URL.indexOf('http')!==0){ state.fbSave='idle'; fbUpdateSaveInd(); return; }
    jsonp({ action:'setFbBudget', account:account, campaign:campaign, month:month, mode:b.mode, amount:b.amount })
      .then(function(){ state.fbSave='saved'; fbUpdateSaveInd(); setTimeout(function(){ state.fbSave='idle'; fbUpdateSaveInd(); },1400); })
      .catch(function(){ state.fbSave='idle'; fbUpdateSaveInd(); });
  }, 700);
}
function fbFindCamp(account,campaign){
  var list=state.fbCampaignsBy&&state.fbCampaignsBy[account]; if(!list) return null;
  for(var i=0;i<list.length;i++){ if(list[i].campaign===campaign) return list[i]; }
  return null;
}

// patch just the computed cells for a campaign + its account + totals (keeps input focus)
function fbPatchKey(key){
  var isLive=state.viewMonth===state.liveKey;
  var parts=key.split('||'), account=parts[0], campaign=parts.slice(1).join('||');
  var camp=fbFindCamp(account,campaign); if(!camp) return;
  var cd=campDerive(camp);
  var crow=document.querySelector('[data-fbrow="'+cssEscFb(key)+'"]');
  if(crow) patchComputed(crow, cd, isLive);
  var acc=fbFindAccount(account);
  var arow=document.querySelector('[data-fbarow="'+cssEscFb(account)+'"]');
  if(acc && arow){ var ad=acctDerive(acc); patchComputed(arow, ad, isLive);
    var ab=arow.querySelector('.fb-abudget'); if(ab) ab.textContent=money(ad.effBudget,true); }
}
function patchComputed(row, d, isLive){
  var st=statusOf(d.pace);
  var pc=row.querySelector('.fb-pace'); if(pc) pc.innerHTML=isLive?('<span class="pacepct t-'+st+'">'+pct(d.pace)+'</span>'+meterHTML(d.pace,st)):'<span class="pace-na">—</span>';
  var vr=row.querySelector('.fb-var'); if(vr){ vr.className='c-num fb-var '+(d.variance>0?'neg':'pos'); vr.textContent=isLive&&d.variance!=null?((d.variance>0?'+':'')+money(d.variance,true)):'—'; }
  var tr=row.querySelector('.cell-trend'); if(tr){ var tmp=document.createElement('div'); tmp.innerHTML=isLive?trendCellHTML(d.proj,d.burn):'<div class="c-num cell-trend">—</div>'; var nc=tmp.firstChild; tr.innerHTML=nc.innerHTML; tr.setAttribute('title', nc.getAttribute('title')||''); }
}
function fbFindAccount(account){ for(var i=0;i<state.fbAccounts.length;i++){ if(state.fbAccounts[i].account===account) return state.fbAccounts[i]; } return null; }
function cssEscFb(s){ return String(s).replace(/["\\]/g,'\\$&'); }

/* ============================================================
   EVENTS (namespaced fb-* so the main handler ignores them)
   ============================================================ */
document.addEventListener('click', function(e){
  if(state.view!=='facebook') return;
  var el=e.target.closest('[data-act]'); if(!el) return;
  var act=el.getAttribute('data-act');
  if(act==='fb-refresh'){ FB.load(true); }
  else if(act==='fb-toggle'){ var acct=el.getAttribute('data-acct'); state.fbOpen[acct]=!state.fbOpen[acct]; render(); }
  else if(act==='fb-camp-toggle'){ if(e.target.closest('[data-noexpand]')) return; var k=el.getAttribute('data-key'); state.fbCampOpen[k]=!state.fbCampOpen[k]; render(); }
  else if(act==='fb-to-manual'){ fbSetBudget(el.getAttribute('data-key'),{mode:'manual',amount:Number(el.getAttribute('data-amt'))||0}); }
  else if(act==='fb-mode'){ fbSetBudget(el.getAttribute('data-key'),{mode:el.getAttribute('data-mode')}); }
  else if(act==='fb-range'){ state.fbDetailDays=parseInt(el.getAttribute('data-days'),10)||30; render(); }
});
document.addEventListener('input', function(e){
  if(state.view!=='facebook') return;
  if(e.target.classList.contains('fb-budget-input')){
    var el=e.target, key=el.getAttribute('data-key');
    var digits=el.value.replace(/[^0-9]/g,'');
    var val=digits===''?0:parseInt(digits,10);
    var digitsBefore=el.value.slice(0,el.selectionStart).replace(/[^0-9]/g,'').length;
    var formatted=digits===''?'':val.toLocaleString('en-US');
    el.value=formatted;
    var pos=0,seen=0; while(pos<formatted.length&&seen<digitsBefore){ if(formatted.charCodeAt(pos)>=48&&formatted.charCodeAt(pos)<=57) seen++; pos++; }
    try{ el.setSelectionRange(pos,pos); }catch(err){}
    fbSetBudget(key,{mode:'manual',amount:val}, true);   // skip full re-render → keep focus
    fbPatchKey(key);
  } else if(e.target.id==='fb-day-input'){
    var v=e.target.value.replace(/[^0-9]/g,'');
    state.elapsedOverride = v===''?null:parseInt(v,10);
    saveElapsed(state.elapsedOverride);
    render();
  }
});
})();
