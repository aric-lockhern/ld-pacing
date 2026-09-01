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
// Social manager — Slack notes from the Social tab tag them by default.
var FB_SOCIAL_MANAGER = { name: 'Xand', id: 'U09214YNE8J' };

/* ---- state fields this module owns (index.html doesn't declare them) ---- */
state.fbOpen        = state.fbOpen || {};
state.fbCampOpen    = state.fbCampOpen || {};
state.fbBudgets     = state.fbBudgets || {};
state.fbAccounts    = state.fbAccounts || [];
state.fbCampaignsBy = state.fbCampaignsBy || {};
state.fbRaw         = state.fbRaw || [];
state.fbSlackFor    = state.fbSlackFor || null;
if(state.fbFilter==null) state.fbFilter='';
if(state.fbFilterDrops==null) state.fbFilterDrops=false;
if(state.fbSave==null)       state.fbSave='idle';
if(state.fbDetailDays==null) state.fbDetailDays=30;
/* state.fbSource stays undefined until the first load */

/* ---- one-time CSS (kept with the module) ---- */
(function injectCSS(){
  var css =
    '.fbgrid{display:grid;grid-template-columns:22px 1.95fr .78fr .78fr .92fr .95fr .8fr .88fr .7fr .66fr .68fr .78fr .6fr 40px;align-items:center;gap:7px;padding:0 12px;min-width:1120px;}'
  + '.fbhead{height:38px;background:#FAFBFC;border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);font-weight:600;}'
  + '.fbrow{min-height:54px;cursor:pointer;font-size:14px;}'
  + '.fbrow:hover{background:#FAFBFC;}'
  + '.fbblock{border-bottom:1px solid var(--line2);}'
  + '.fbblock:last-child{border-bottom:none;}'
  + '.fbcamps{background:#FBFCFD;border-top:1px dashed var(--line);}'
  + '.fbcrow{min-height:48px;cursor:pointer;font-size:13px;}'
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
  + '.fbmeta{font-size:11px;color:var(--faint);font-weight:600;}'
  + '.fbdailycell{display:flex;flex-direction:column;align-items:flex-end;gap:2px;margin-left:auto;}'
  + '.fbdailyfield{display:inline-flex;align-items:center;background:var(--editbg);border:1px solid var(--editline);border-radius:8px;padding:2px 7px;}'
  + '.fbdailyfield.inherited,.fbdailycell.inherited .fbdailyfield{border-style:dashed;border-color:var(--accent);}'
  + '.fbdailyfield:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-bg);background:#fff;}'
  + '.fbdailyfield .pre{color:var(--faint);font-size:13px;}'
  + '.fbdailyfield .suf{color:var(--faint);font-size:11px;padding-left:1px;}'
  + '.fbdailyfield input{border:none;outline:none;background:transparent;text-align:right;width:52px;padding:3px 2px;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink);}'
  + '.fbmohint{font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums;}'
  + '.fbbud{font-size:9px;font-weight:700;color:var(--accent);background:var(--accent-bg);border-radius:4px;padding:1px 5px;white-space:nowrap;letter-spacing:.02em;}'
  + '.fbautoval{display:inline-flex;align-items:center;gap:5px;font-size:14px;font-weight:650;font-variant-numeric:tabular-nums;color:var(--ink);}'
  + '.fbautocell{cursor:pointer;border:1px solid transparent;border-radius:8px;padding:2px 6px;}'
  + '.fbautocell:hover{border-color:var(--editline);background:var(--editbg);}'
  + '.fbautocell:hover .fbautoval{color:var(--accent);}'
  + '.fbedit{color:var(--accent);font-weight:700;}'
  // manage-accounts panel
  + '.mac-modal{max-width:560px;width:92vw;}'
  + '.mac-sub{font-size:12.5px;color:var(--muted);margin:2px 0 10px;line-height:1.45;}'
  + '.mac-count{font-size:12px;color:var(--faint);margin-bottom:8px;display:flex;align-items:center;gap:10px;}'
  + '.mac-list{max-height:52vh;overflow-y:auto;border:1px solid var(--line);border-radius:10px;}'
  + '.mac-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--line2);}'
  + '.mac-row:last-child{border-bottom:none;}'
  + '.mac-tog{position:relative;display:inline-block;width:34px;height:20px;flex:0 0 auto;cursor:pointer;}'
  + '.mac-tog input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer;}'
  + '.mac-slider{position:absolute;inset:0;background:var(--line2);border-radius:999px;transition:background .15s;}'
  + '.mac-slider:before{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.25);}'
  + '.mac-tog input:checked + .mac-slider{background:var(--good);}'
  + '.mac-tog input:checked + .mac-slider:before{transform:translateX(14px);}'
  + '.mac-names{flex:1 1 auto;min-width:0;}'
  + '.mac-names input{width:100%;border:1px solid var(--line);border-radius:7px;padding:5px 8px;font-size:13px;font-weight:600;color:var(--ink);background:#fff;outline:none;}'
  + '.mac-names input:focus{border-color:var(--accent);}'
  + '.mac-raw{font-size:10.5px;color:var(--faint);margin-top:2px;overflow-wrap:anywhere;}'
  + '.mac-state{flex:0 0 auto;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;border-radius:4px;padding:2px 6px;}'
  + '.mac-state.on{color:var(--good);background:var(--good-bg);}'
  + '.mac-state.off{color:var(--faint);background:var(--line2);}'
  + '.mac-empty{padding:18px;text-align:center;color:var(--faint);font-size:13px;}'
  // sortable Social headers (Search uses .head .sortable; the FB table is .fbhead)
  + '.fbhead .sortable{cursor:pointer;user-select:none;}'
  + '.fbhead .sortable:hover{color:var(--muted);}'
  + '.fbhead .sort-active{color:var(--ink);}';
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
  // The FB sheet is large; the gateway caches the heavy read, but a cold read
  // can take a while — allow 60s, and force=refresh bypasses the gateway cache.
  jsonp({ action:'fbData', fresh: force?'1':'' }, 60000).then(function(res){
    if(!res || !res.ok) throw new Error(res && res.error || 'bad response');
    state.fbRaw = res.rows || [];
    state.fbAcctList = res.accounts || [];       // full roster (active + inactive) for the manage panel
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
function fbMode(m){ m=String(m||'auto'); return (m==='lastMonth'||m==='daily'||m==='lifetime'||m==='auto'||m==='manual')?m:'auto'; }

/* ============================================================
   BUILD — campaigns + account rollups
   ============================================================ */
FB.rebuild = function(){
  var camps={};                                   // account -> campaign -> {..., dayMap}
  (state.fbRaw||[]).forEach(function(r){
    var acct=String(r.a||'').trim(), camp=String(r.c||'').trim(), date=normDate(r.d);
    if(!acct || !date) return;
    var byC = camps[acct] || (camps[acct]={});
    var o = byC[camp] || (byC[camp]={ account:acct, campaign:camp||'(unnamed campaign)', tags:r.tg||'', status:r.st||'', dailyBudget:0, lifetimeBudget:0, budgetType:'', budgetLevel:'', budgetStart:'', budgetEnd:'', dayMap:{} });
    var db=toNum(r.db); if(db>o.dailyBudget) o.dailyBudget=db;   // Facebook daily budget (max seen)
    var lb=toNum(r.life); if(lb>o.lifetimeBudget) o.lifetimeBudget=lb; // lifetime budget (max seen)
    if(r.bt) o.budgetType=String(r.bt).toLowerCase();           // daily | lifetime (from sheet)
    if(r.bl) o.budgetLevel=String(r.bl).toLowerCase();          // campaign | ad set (from sheet)
    if(r.bs) o.budgetStart=r.bs; if(r.be) o.budgetEnd=r.be;     // lifetime flight dates
    if(r.st) o.status=r.st;                                      // latest status wins
    var dm = o.dayMap[date] || (o.dayMap[date]={ date:date, cost:0, imp:0, clk:0, wc:0, fl:0, rc:0, val:0 });
    dm.cost+=toNum(r.cost); dm.imp+=toNum(r.imp); dm.clk+=toNum(r.clk);
    dm.wc+=toNum(r.wc); dm.fl+=toNum(r.fl); dm.rc+=toNum(r.rc); dm.val+=toNum(r.val);
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
      var d=mm[p.date]||(mm[p.date]={date:p.date,cost:0,imp:0,clk:0,wc:0,fl:0,rc:0,val:0});
      d.cost+=p.cost; d.imp+=p.imp; d.clk+=p.clk; d.wc+=p.wc; d.fl+=p.fl; d.rc+=p.rc; d.val+=p.val;
    }); });
    var daily=Object.keys(mm).map(function(k){return mm[k];}).sort(byDate);
    return { account:acct, campaigns:list, daily:daily };
  }).sort(function(x,y){ return x.account.localeCompare(y.account); });

  // Freshest COMPLETED data date across the whole portfolio (today's partial
  // export excluded). Spend-drop windows end here so normal export lag — where
  // nobody has yesterday's data yet — doesn't read as a collapse.
  var mx='', ty=todayIso();
  state.fbAccounts.forEach(function(a){ a.campaigns.forEach(function(c){ c.daily.forEach(function(p){ var dstr=String(p.date); if(dstr<ty && dstr>mx) mx=dstr; }); }); });
  state.fbMaxDate = mx || null;

  // display-name map for in-tool account renames (raw account name stays the key)
  state.fbAcctName = {};
  (state.fbAcctList||[]).forEach(function(a){ if(a && a.name) state.fbAcctName[a.account]=a.name; });
};
function fbDisplayName(acct){ return (state.fbAcctName && state.fbAcctName[acct]) || acct; }

/* ============================================================
   AGGREGATION + PACING MATH (shared by campaign & account)
   ============================================================ */
function aggMonth(daily, ym){
  var o={cost:0,wc:0,fl:0,rc:0,val:0,imp:0,clk:0};
  daily.forEach(function(p){ if(String(p.date).slice(0,7)===ym){ o.cost+=p.cost;o.wc+=p.wc;o.fl+=p.fl;o.rc+=(p.rc||0);o.val+=p.val;o.imp+=p.imp;o.clk+=p.clk; } });
  return o;
}

// budget for one campaign (with carry-forward; default = Automatic, i.e. use
// whatever budget the sheet reports for the campaign / ad set)
function campGetBudget(camp){
  var month=state.viewMonth, key=fbKey(camp.account,camp.campaign);
  var ex = state.fbBudgets[month] && state.fbBudgets[month][key];
  if(ex) return { mode:ex.mode, amount:ex.amount, inherited:false };
  var k=month;
  for(var i=0;i<12;i++){ k=shiftKey(k,-1); var b=state.fbBudgets[k]&&state.fbBudgets[k][key]; if(b) return { mode:b.mode, amount:b.amount, inherited:true, from:k }; }
  return { mode:'auto', amount:0, inherited:false, isDefault:true };
}
// What Meta actually has, from the sheet (with sane inference when unlabelled).
function fbMetaType(camp){
  if(camp.budgetType==='lifetime' || camp.budgetType==='daily') return camp.budgetType;
  return (camp.lifetimeBudget>0) ? 'lifetime' : 'daily';
}
function fbMetaLevel(camp){
  var l=String(camp.budgetLevel||'');
  if(l==='ad set'||l==='adset'||l==='ad-set'||l==='abo') return 'ad set';
  if(l==='campaign'||l==='cbo') return 'campaign';
  return '';
}
function fbDaysInc(a,b){ var da=new Date(a+'T00:00:00'), db=new Date(b+'T00:00:00'); return Math.round((db-da)/86400000)+1; }
// A lifetime budget's share of the current view month: prorated across the
// flight when start/end are given, else the whole amount.
function lifetimeMonthly(camp, lifetime){
  if(!(lifetime>0)) return 0;
  var s=camp.budgetStart, e=camp.budgetEnd, ym=state.viewMonth, dim=daysInMonthOf(ym);
  if(s && e && e>=s){
    var mStart=ym+'-01', mEnd=ym+'-'+('0'+dim).slice(-2);
    var ovS=(s>mStart?s:mStart), ovE=(e<mEnd?e:mEnd);
    if(ovE<ovS) return 0;
    return lifetime * (fbDaysInc(ovS,ovE)/fbDaysInc(s,e));
  }
  return lifetime;
}
// The daily budget in effect: the value typed in daily mode, else the sheet's.
function campDailyVal(camp, b){
  b = b || campGetBudget(camp);
  return (b.mode==='daily' && b.amount>0) ? b.amount : (camp.dailyBudget||0);
}
// Monthly budget the tool paces against, per mode:
//   auto      → whatever the sheet reports (daily → spent + daily×days-left; lifetime → prorated)
//   daily     → spent so far + (typed daily budget) × days left
//   lifetime  → prorated lifetime (typed, else the sheet's lifetime)
//   manual    → the flat monthly amount
//   lastMonth → last month's actual spend
function campEffBudget(camp, b){
  b = b || campGetBudget(camp);
  var c=ctx(), daysLeft=Math.max(0, c.dim - c.elapsed);
  var mtd=aggMonth(camp.daily, state.viewMonth).cost;
  // Paused mid-month with spend already on the board: it won't spend any more,
  // so the budget it paces against is exactly what it spent — no projection.
  if(c.isLive && !fbIsActive(camp) && mtd>0) return mtd;
  if(b.mode==='manual')    return b.amount;
  if(b.mode==='lastMonth') return aggMonth(camp.daily, shiftKey(state.viewMonth,-1)).cost;
  if(b.mode==='lifetime')  return lifetimeMonthly(camp, (b.amount>0?b.amount:camp.lifetimeBudget));
  if(b.mode==='auto'){
    if(fbMetaType(camp)==='lifetime') return lifetimeMonthly(camp, camp.lifetimeBudget);
    return mtd + (camp.dailyBudget||0)*daysLeft;
  }
  return mtd + campDailyVal(camp,b)*daysLeft;   // daily
}

// generic pace for a "unit" = { mtd, effBudget, daily } (daily rows use .cost as spend)
function unitPace(mtd, effBudget, daily){
  var c=ctx();
  // live: linear whole-month projection · PAST (completed) month: actual final
  // spend (mtd is already month-scoped) · FUTURE: nothing yet.
  var forecast = c.isLive ? (c.elapsed>0 ? (mtd/c.elapsed)*c.dim : null)
               : (state.viewMonth<state.liveKey ? mtd : null);
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

/* ---- spend collapse: an ACTIVE campaign whose daily spend stalled for a week.
   Compares a 7-DAY recent window (day-of-week balanced — a full week always
   spans the weekend, so campaigns that just spend less on weekends don't
   false-alarm) to the prior ~2 weeks; percentage + floor based. Mirrors the
   Search-side collapse rule. Trade-off: a campaign that stops mid-week takes a
   few days to trip, rather than firing on a single low weekend. ---- */
var FB_DROP_RECENT=7, FB_DROP_BASE=14, FB_DROP_MINHIST=18, FB_DROP_FLOOR=15, FB_DROP_RATIO=0.35, FB_DROP_CRIT=0.15;
// date -> total cost, so we can read spend by CALENDAR day (a day with no export
// row = $0 spent, which is the whole point: a stopped campaign has missing days).
function fbCostMap(daily){ var m={}; (daily||[]).forEach(function(p){ var k=String(p.date); m[k]=(m[k]||0)+p.cost; }); return m; }
// average $/day over the n calendar days ending at endIso (missing days count as $0).
function fbWinAvg(map, endIso, n){ var s=0; for(var i=0;i<n;i++){ s+=(map[isoAdd(endIso,-i)]||0); } return s/n; }
function campSpendDrop(camp){
  if(!ctx().isLive || !fbIsActive(camp)) return null;               // only currently-active campaigns
  if(!camp.daily.length) return null;
  // Measure ending at the freshest COMPLETED data date across the whole
  // portfolio, not this campaign's last row — so a campaign that simply stopped
  // exporting (all zeros since) is still measured against the same recent window,
  // while ordinary export lag (nobody has today's data yet) never false-alarms.
  var ref=state.fbMaxDate; if(!ref) return null;
  var first=String(camp.daily[0].date);                            // daily is sorted ascending
  if(fbDaysInc(first, ref) < FB_DROP_MINHIST) return null;         // not enough history behind the window
  var map=fbCostMap(camp.daily);
  var r=fbWinAvg(map, ref, FB_DROP_RECENT);
  var bs=fbWinAvg(map, isoAdd(ref,-FB_DROP_RECENT), FB_DROP_BASE);
  if(!(bs>=FB_DROP_FLOOR)) return null;                             // baseline must be meaningful
  if(r > bs*FB_DROP_RATIO) return null;                            // not a real collapse
  var pct=(r-bs)/bs;
  function m2(v){ return v<10 ? ('$'+v.toFixed(2)) : money(v); }   // keep cents for small daily spends
  return { level:(r<=bs*FB_DROP_CRIT?'critical':'warning'), recent:r, base:bs, pct:pct,
    text:'Spend dropped '+Math.round(Math.abs(pct)*100)+'% — '+m2(r)+'/day recently vs '+m2(bs)+'/day before' };
}

// one bundle of everything a row needs
function campDerive(camp){
  var view=aggMonth(camp.daily, state.viewMonth);
  var b=campGetBudget(camp), eff=campEffBudget(camp,b);
  var p=unitPace(view.cost, eff, camp.daily);
  p.wc=view.wc; p.fl=view.fl; p.rc=view.rc; p.val=view.val;
  p.leads = view.fl + view.rc;                                   // On Facebook Leads + website registrations
  p.cpl = (p.leads>0 && view.cost>0) ? view.cost/p.leads : null; // cost per lead
  p.roas = view.val>0 && view.cost>0 ? view.val/view.cost : null;
  p.budget=b; p.proj=unitProjection(camp.daily, eff); p.burn=unitBurn(view.cost, eff, camp.daily);
  p.drop=campSpendDrop(camp);
  // Paused mid-month: no more projection. Forecast/trending = what it already
  // spent, pace lands at 100% of that spend, and no burn/over-budget alert.
  var cc=ctx();
  if(cc.isLive && !fbIsActive(camp) && view.cost>0){
    var dl=Math.max(0, cc.dim - cc.elapsed);
    p.forecast=view.cost;
    p.pace = eff>0 ? view.cost/eff : null;
    p.variance = eff>0 ? view.cost-eff : null;
    p.proj = { proj:view.cost, rate:0, daysLeft:dl, spent:view.cost, days:0, paused:true,
               pct:(eff>0?view.cost/eff:null), gap:(eff>0?view.cost-eff:null) };
    p.burn = null;
    p.paused = true;
  }
  return p;
}
// Which campaigns to show for the current view month. Hide the clutter:
//   • 0 impressions this month  → drop (nothing ran), OR
//   • 0 spend this month AND paused → drop (dormant paused campaign).
// So a campaign shows only if it had impressions this month AND (it spent
// this month OR it's still active). Active campaigns delivering this month
// stay; paused campaigns stay only if they actually have this-month data.
function fbIsActive(camp){ return String(camp.status||'').toUpperCase().indexOf('ACTIVE')>=0; }
function campVisible(camp){
  var m=aggMonth(camp.daily, state.viewMonth);
  if(!(m.imp>0)) return false;
  if(!(m.cost>0) && !fbIsActive(camp)) return false;
  return true;
}
function acctVisibleCampaigns(acc){ return (acc.campaigns||[]).filter(campVisible); }

function acctDerive(acc){
  // account = rollup of its VISIBLE campaigns. Forecast/trending are the SUM of
  // the per-campaign values (not a whole-account extrapolation), so a paused
  // campaign contributes only what it spent — no forward projection. For all-
  // active accounts this is identical to the old linear rollup.
  var camps=acctVisibleCampaigns(acc), live=ctx().isLive, isPast=state.viewMonth<state.liveKey;
  var eff=0, mtd=0, wc=0, fl=0, rc=0, val=0, fcast=0, projSum=0, aEff=0, aMtd=0, mm={}, amm={}, drop=null;
  camps.forEach(function(c){
    var cd=campDerive(c);
    eff+=cd.effBudget; mtd+=cd.mtd; wc+=cd.wc; fl+=cd.fl; rc+=cd.rc; val+=cd.val;
    if(live||isPast){ fcast += (cd.forecast!=null?cd.forecast:cd.mtd); }
    if(live){ projSum += (cd.proj?cd.proj.proj:cd.mtd); }
    c.daily.forEach(function(p){ (mm[p.date]||(mm[p.date]={date:p.date,cost:0})).cost+=p.cost; });
    if(fbIsActive(c)){ aEff+=cd.effBudget; aMtd+=cd.mtd; c.daily.forEach(function(p){ (amm[p.date]||(amm[p.date]={date:p.date,cost:0})).cost+=p.cost; }); }
    if(cd.drop && (!drop || (cd.drop.level==='critical'&&drop.level!=='critical'))) drop=cd.drop;
  });
  var daily=Object.keys(mm).map(function(k){return mm[k];}).sort(byDate);
  var activeDaily=Object.keys(amm).map(function(k){return amm[k];}).sort(byDate);
  var forecast = (live||isPast) ? fcast : null;
  var p={ forecast:forecast, effBudget:eff, mtd:mtd,
          pace:(eff>0&&forecast!=null)?forecast/eff:null,
          variance:(forecast!=null)?forecast-eff:null };
  p.wc=wc; p.fl=fl; p.rc=rc; p.val=val; p.nCamps=camps.length;
  p.leads = fl + rc;
  p.cpl = (p.leads>0 && mtd>0) ? mtd/p.leads : null;
  p.roas = val>0 && mtd>0 ? val/mtd : null;
  var dl=Math.max(0, ctx().dim-ctx().elapsed);
  p.proj = live ? { proj:projSum, rate:null, daysLeft:dl, spent:mtd, days:0,
                    pct:(eff>0?projSum/eff:null), gap:(eff>0?projSum-eff:null) } : null;
  // Burn (runout) concerns only campaigns still spending — paused ones can't run out.
  p.burn = unitBurn(aMtd, aEff, activeDaily);
  p.drop=drop;
  return p;
}
// Combined alert dot (spend collapse + budget burn) shown on account/campaign rows.
function fbAlertDot(d){
  if(!d.burn && !d.drop) return '';
  var crit=(d.burn&&d.burn.level==='critical')||(d.drop&&d.drop.level==='critical');
  var parts=[]; if(d.drop) parts.push('⚠ '+d.drop.text); if(d.burn) parts.push(d.burn.text);
  return '<span class="alertdot '+(crit?'crit':'')+'" title="'+esc(parts.join(' · '))+'">⚠</span>';
}

/* ---- column sorting (click a header) — mirrors the Search tab ---- */
function fbToggleSort(key){
  var s=state.fbSort||(state.fbSort={key:null,dir:'desc'});
  if(s.key===key) s.dir = s.dir==='asc' ? 'desc' : 'asc';
  else { s.key=key; s.dir = key==='name' ? 'asc' : 'desc'; }   // names A→Z, numbers high→low
}
function fbTh(label,key,cls){
  var s=state.fbSort||{}, active=s.key===key, arrow=active?(s.dir==='asc'?' ▲':' ▼'):'';
  return '<div class="'+cls+' sortable'+(active?' sort-active':'')+'" data-act="fb-sort" data-key="'+esc(key)+'">'+label+arrow+'</div>';
}
function fbSortVal(acc,key){
  if(key==='name') return fbDisplayName(acc.account);
  var d=acctDerive(acc);
  if(key==='trend') return d.proj?d.proj.proj:null;
  return { mtd:d.mtd, forecast:d.forecast, budget:d.effBudget, pace:d.pace, variance:d.variance,
           wc:d.wc, leads:d.leads, cpl:d.cpl, val:d.val, roas:d.roas }[key];
}
function fbSortAccounts(list){
  var s=state.fbSort; if(!s||!s.key) return list;
  return list.slice().sort(function(a,b){
    var va=fbSortVal(a,s.key), vb=fbSortVal(b,s.key);
    var na=(va==null||(typeof va==='number'&&!isFinite(va)));
    var nb=(vb==null||(typeof vb==='number'&&!isFinite(vb)));
    if(na&&nb) return a.account.localeCompare(b.account);
    if(na) return 1; if(nb) return -1;                          // blanks sink to the bottom
    var cmp = typeof va==='string' ? va.toLowerCase().localeCompare(vb.toLowerCase()) : va-vb;
    return s.dir==='asc' ? cmp : -cmp;
  });
}

/* ============================================================
   RENDER
   ============================================================ */
FB.render = function(baseHtml){
  var html = baseHtml || topbarHTML();
  if(typeof budgetReminderHTML==='function') html += budgetReminderHTML();
  var c=ctx(), isLive=c.isLive;

  if(state.fbSource==='loading' || state.fbSource==null){
    html += (typeof loadingHTML==='function'
      ? loadingHTML('Loading Facebook…','Pulling campaigns from the sheet. The first load can take a few seconds.')
      : '<div class="empty">Loading Facebook data from the sheet…</div>');
    document.getElementById('app').innerHTML=html; return;
  }
  if(state.fbSource==='error'){
    html += '<div class="banner warn"><span>Couldn’t load the Facebook sheet'+(state.fbError?(' — '+esc(state.fbError)):'')+'. Check the gateway has access to the FB spreadsheet and was redeployed as a new version.</span><button data-act="fb-refresh">Retry</button></div>';
    document.getElementById('app').innerHTML=html; return;
  }

  var accounts=(state.fbAccounts||[]).filter(function(a){ return acctVisibleCampaigns(a).length>0; });
  var fq=(state.fbFilter||'').trim().toLowerCase();
  if(fq) accounts=accounts.filter(function(a){ return fbDisplayName(a.account).toLowerCase().indexOf(fq)>=0 || a.account.toLowerCase().indexOf(fq)>=0; });
  // spend-collapse count (campaigns), and optional filter to just those accounts
  var dropCount=0, dropCrit=0;
  accounts.forEach(function(a){ acctVisibleCampaigns(a).forEach(function(c){ var dd=campSpendDrop(c); if(dd){ dropCount++; if(dd.level==='critical') dropCrit++; } }); });
  if(state.fbFilterDrops) accounts=accounts.filter(function(a){ return acctVisibleCampaigns(a).some(function(c){ return campSpendDrop(c); }); });
  // summary
  var t={mtd:0,forecast:0,budget:0,proj:0,wc:0,fl:0,rc:0,val:0};
  accounts.forEach(function(a){ var d=acctDerive(a); t.mtd+=d.mtd; t.forecast+=d.forecast||0; t.budget+=d.effBudget||0; t.proj+=(d.proj?d.proj.proj:(d.forecast||0)); t.wc+=d.wc; t.fl+=d.fl; t.rc+=d.rc; t.val+=d.val; });
  t.leads = t.fl + t.rc;
  t.cpl = (t.leads>0 && t.mtd>0) ? t.mtd/t.leads : null;
  t.roas = t.val>0 && t.mtd>0 ? t.val/t.mtd : null;
  var isPast=state.viewMonth<state.liveKey, showVals=isLive||isPast;
  t.pace = showVals&&t.budget>0 ? t.forecast/t.budget : null;
  t.variance = showVals ? t.forecast-t.budget : null;
  var cellL=function(v){ return showVals?v:'—'; };

  html += '<div class="summary">'
    + stat('MTD spend', cellL(money(t.mtd)))
    + stat('Forecast', cellL(money(t.forecast)))
    + '<div class="stat"><div class="stat-label">Budget (rollup)</div><div class="stat-value" id="fb-sum-budget">'+money(t.budget)+'</div></div>'
    + '<div class="stat stat-pace"><div class="stat-label">Facebook pace</div><div id="fb-sum-pace">'
    + fbSummaryPaceHTML(t,isLive)
    + '</div></div></div>';

  // toolbar
  html += '<div class="toolbar"><div class="tcount">'
    + '<label class="acctfilter" title="Filter accounts by name"><span class="afic">🔎</span><input id="fb-acct-filter" placeholder="Filter accounts…" value="'+esc(state.fbFilter||'')+'">'+(state.fbFilter?'<button class="afclr" data-act="fb-clear-filter" title="Clear">×</button>':'')+'</label>'
    + 'Accounts <span class="badge">'+accounts.length+'</span>'
    + '<span class="filtertag" title="Hidden: campaigns with 0 impressions this month, and paused campaigns with 0 spend this month.">Active + campaigns with data</span>'
    + ((dropCount>0||state.fbFilterDrops)?('<button class="filtertag issues'+(state.fbFilterDrops?' on':'')+(dropCrit?' hascrit':'')+'" data-act="fb-toggle-drops" title="Active campaigns whose daily spend suddenly dropped vs the prior 2 weeks">'+(dropCrit?'🚨':'⚠')+' Spend drops ('+dropCount+')</button>'):'')
    + '</div>'
    + '<div class="tactions">'
    + (isLive?('<label class="dayctl">Day <input class="dayin" id="fb-day-input" inputmode="numeric" value="'+c.elapsed+'"> of '+c.dim+' <span class="daypct">· '+Math.round(c.elapsed/c.dim*100)+'%</span></label>'):'')
    + '<span class="saveind '+state.fbSave+'" id="fb-saveind">'+fbSaveText()+'</span>'
    + '<button class="btn" data-act="fb-manage" title="Choose which accounts are managed, and rename them for the tool">⚙ Manage accounts'+(state.fbAcctList&&state.fbAcctList.length?(' <span class="badge">'+state.fbAcctList.length+'</span>'):'')+'</button>'
    + '<button class="btn" data-act="fb-refresh">↻ Refresh</button></div></div>';

  if(!accounts.length && fq){
    html += '<div class="empty"><p class="empty-head">No accounts match “'+esc(state.fbFilter)+'”</p><button class="btn" data-act="fb-clear-filter">Clear filter</button></div>';
    document.getElementById('app').innerHTML=html; return;
  }
  if(!accounts.length){
    html += '<div class="empty"><p class="empty-head">No Facebook accounts</p>'
      + '<p class="empty-sub">No rows in <b>FB - Daily</b> are flagged <b>Active</b> in column M, or the sheet is empty. Mark the accounts you manage, then refresh.</p>'
      + '<button class="btn primary" data-act="fb-refresh">Refresh</button></div>';
    document.getElementById('app').innerHTML=html; return;
  }

  html += '<div class="tablewrap"><div class="tscroll"><div class="fbgrid fbhead">'
    + '<div></div>'
    + fbTh('Account / Campaign','name','c-name')
    + fbTh('MTD spend','mtd','c-num') + fbTh('Forecast','forecast','c-num')
    + fbTh('Budget','budget','c-budget') + fbTh('Pace to budget','pace','c-pace')
    + fbTh('Δ vs budget','variance','c-num') + fbTh('Trending to','trend','c-num')
    + fbTh('Conversions','wc','c-num') + fbTh('Leads','leads','c-num') + fbTh('CPL','cpl','c-num')
    + fbTh('Revenue','val','c-num') + fbTh('ROAS','roas','c-num') + '<div></div></div>';

  fbSortAccounts(accounts).forEach(function(a){ html += acctRowHTML(a,isLive); });

  // totals
  html += '<div class="fbgrid totalrow"><div></div><div class="c-name">Facebook total</div>'
    + '<div class="c-num strong">'+cellL(money(t.mtd,true))+'</div>'
    + '<div class="c-num">'+cellL(money(t.forecast,true))+'</div>'
    + '<div class="c-budget total-budget" id="fb-tr-budget">'+money(t.budget,true)+'</div>'
    + '<div class="c-pace" id="fb-tr-pace">'+(showVals?('<span class="pacepct t-'+statusOf(t.pace)+'">'+pct(t.pace)+'</span>'+meterHTML(t.pace,statusOf(t.pace))):'<span class="pace-na">—</span>')+'</div>'
    + '<div class="c-num '+(t.variance>0?'neg':'pos')+'" id="fb-tr-var">'+(showVals&&t.variance!=null?((t.variance>0?'+':'')+money(t.variance,true)):'—')+'</div>'
    + '<div class="c-num" id="fb-tr-trend">'+fbTrendTot(t,isLive)+'</div>'
    + '<div class="c-num">'+cellL(intf(t.wc))+'</div>'
    + '<div class="c-num">'+cellL(intf(t.leads))+'</div>'
    + '<div class="c-num">'+cellL(t.cpl!=null?money(t.cpl):'—')+'</div>'
    + '<div class="c-num">'+cellL(t.val>0?money(t.val,true):'—')+'</div>'
    + '<div class="c-num">'+cellL(xfmt(t.roas))+'</div><div></div></div>';

  html += '</div></div>';
  html += '<div class="foot"><span>Account budget = sum of its campaign budgets.</span><span class="foot-dot">·</span>'
    + '<span>Budget per campaign: <b>Automatic</b> (from the sheet — daily → spent + daily × days left; lifetime → prorated), or set <b>Daily / Monthly / Lifetime</b> in the row. Badge shows campaign- vs ad-set-level.</span><span class="foot-dot">·</span>'
    + '<span>Only <b>active</b> accounts are shown — set which accounts are managed under <b>⚙ Manage accounts</b>.</span></div>';

  html += fbSlackModalHTML();
  html += fbManageModalHTML();
  document.getElementById('app').innerHTML=html;
};

/* ---- Slack note (Social) — mirrors the Search tab's "Note to #pacing" ---- */
function fbSlackTarget(){
  var s=state.fbSlackFor; if(!s) return null;
  if(s.kind==='campaign'){
    var camp=fbFindCamp(s.account,s.campaign); if(!camp) return null;
    return { name:fbDisplayName(s.account)+' · '+s.campaign, d:campDerive(camp), unit:'campaign' };
  }
  var acc=fbFindAccount(s.account); if(!acc) return null;
  return { name:fbDisplayName(s.account), d:acctDerive(acc), unit:'account' };
}
function fbStatsLine(d){
  return 'MTD '+money(d.mtd,true)+' · Forecast '+money(d.forecast,true)+' · Budget '+money(d.effBudget,true)
    + ' · Pace '+pct(d.pace)+' · Conv '+intf(d.wc)
    + (d.leads>0?(' · Leads '+intf(d.leads)+(d.cpl!=null?(' · CPL '+money(d.cpl)):'')):'')
    + (d.val>0?(' · Rev '+money(d.val,true)+' · ROAS '+xfmt(d.roas)):'');
}
function fbSlackModalHTML(){
  var tgt=fbSlackTarget(); if(!tgt) return '';
  var d=tgt.d, from=lsGet('lk_slackname','');
  var al = d.drop || d.burn;   // spend collapse takes priority in the note
  var pre = al ? (((al.level==='critical')?'🚨 ':'⚠ ')+al.text) : '';
  var alChip = al ? '<div class="modal-alert '+(al.level==='critical'?'critical':'warning')+'">Alert included — edit or add below</div>' : '';
  return '<div class="modal-overlay" data-act="fb-slack-cancel"><div class="modal">'
    + '<div class="modal-head"><span class="modal-title">Note to #pacing</span><button class="modal-x" data-act="fb-slack-cancel">×</button></div>'
    + '<div class="modal-acc">'+esc(tgt.name)+'</div><div class="modal-stats">'+esc(fbStatsLine(d))+'</div>'
    + (FB_SOCIAL_MANAGER && FB_SOCIAL_MANAGER.id ? '<div class="modal-notify">Will notify <b>@'+esc(FB_SOCIAL_MANAGER.name)+'</b> in Slack</div>' : '')
    + alChip
    + '<textarea id="fb-slack-note" class="modal-note" placeholder="What are you seeing? e.g. paused the top campaign Friday, expect pace to normalize by mid-week">'+esc(pre)+'</textarea>'
    + '<input id="fb-slack-from" class="modal-from" placeholder="Your name (optional)" value="'+esc(from)+'">'
    + '<div id="fb-slack-err" class="modal-err"></div>'
    + '<div class="modal-actions"><button class="btn" data-act="fb-slack-cancel">Cancel</button><button id="fb-slack-send" class="btn primary" data-act="fb-slack-send">Send to #pacing</button></div>'
    + '</div></div>';
}
function fbCloseSlack(){ state.fbSlackFor=null; render(); }
function fbSendSlack(){
  var tgt=fbSlackTarget(); if(!tgt) return;
  var noteEl=document.getElementById('fb-slack-note'), fromEl=document.getElementById('fb-slack-from');
  var note=(noteEl&&noteEl.value.trim())||'', from=(fromEl&&fromEl.value.trim())||'';
  if(!note){ if(noteEl) noteEl.focus(); return; }
  if(from) lsSet('lk_slackname', from);
  var d=tgt.d;
  var mention = (FB_SOCIAL_MANAGER && FB_SOCIAL_MANAGER.id) ? ('<@'+FB_SOCIAL_MANAGER.id+'> ') : '';
  var text=mention+'*'+tgt.name+'* — Facebook pacing note\n> '+note+'\n'+fbStatsLine(d)+(from?('\n_— '+from+'_'):'');
  var btn=document.getElementById('fb-slack-send'), err=document.getElementById('fb-slack-err');
  if(btn){ btn.disabled=true; btn.textContent='Sending…'; } if(err) err.textContent='';
  jsonp({action:'postSlack', text:text}).then(function(r){
    if(r&&r.ok){ fbCloseSlack(); toast('Sent to #pacing'); }
    else {
      if(btn){btn.disabled=false;btn.textContent='Send to #pacing';}
      var reason=(r&&r.error)?r.error:((r&&r.code)?('Slack '+r.code):'redeploy the gateway as a new version');
      if(err) err.textContent='Couldn’t send — '+reason;
    }
  }).catch(function(){ if(btn){btn.disabled=false;btn.textContent='Send to #pacing';} if(err) err.textContent='Couldn’t reach the gateway.'; });
}

function stat(label,value){ return '<div class="stat"><div class="stat-label">'+label+'</div><div class="stat-value">'+value+'</div></div>'; }
function fbSummaryPaceHTML(t,isLive){
  var showVals = isLive || state.viewMonth<state.liveKey;   // live OR completed month
  return showVals
    ? '<div class="pace-row"><span class="pace-num t-'+statusOf(t.pace)+'">'+pct(t.pace)+'</span><span class="pace-var t-'+(t.variance>0?'over':'good')+'">'+(t.variance>0?'+':'')+money(t.variance,true)+' vs budget</span></div>'+meterHTML(t.pace,statusOf(t.pace))
    : '<div class="pace-plan">Set budgets for '+esc(monthLabel(state.viewMonth))+'</div>';
}
// Recompute portfolio totals and refresh the summary + total-row cells that a
// budget edit changes (budget, pace, variance, trending). Keeps input focus.
function fbPatchTotals(){
  var isLive=state.viewMonth===state.liveKey;
  var accounts=(state.fbAccounts||[]).filter(function(a){ return acctVisibleCampaigns(a).length>0; });
  var t={mtd:0,forecast:0,budget:0,proj:0};
  accounts.forEach(function(a){ var d=acctDerive(a); t.mtd+=d.mtd; t.forecast+=d.forecast||0; t.budget+=d.effBudget||0; t.proj+=(d.proj?d.proj.proj:(d.forecast||0)); });
  var showVals=isLive||state.viewMonth<state.liveKey;
  t.pace=showVals&&t.budget>0?t.forecast/t.budget:null;
  t.variance=showVals?t.forecast-t.budget:null;
  t.projPct=isLive&&t.budget>0?t.proj/t.budget:null; t.projGap=isLive&&t.budget>0?t.proj-t.budget:null;
  function byId(id){ return document.getElementById(id); }
  var sb=byId('fb-sum-budget'); if(sb) sb.textContent=money(t.budget);
  var sp=byId('fb-sum-pace'); if(sp) sp.innerHTML=fbSummaryPaceHTML(t,isLive);
  var tb=byId('fb-tr-budget'); if(tb) tb.textContent=money(t.budget,true);
  var tp=byId('fb-tr-pace'); if(tp) tp.innerHTML=showVals?('<span class="pacepct t-'+statusOf(t.pace)+'">'+pct(t.pace)+'</span>'+meterHTML(t.pace,statusOf(t.pace))):'<span class="pace-na">—</span>';
  var tv=byId('fb-tr-var'); if(tv){ tv.className='c-num '+(t.variance>0?'neg':'pos'); tv.textContent=(showVals&&t.variance!=null)?((t.variance>0?'+':'')+money(t.variance,true)):'—'; }
  var tt=byId('fb-tr-trend'); if(tt) tt.innerHTML=fbTrendTot(t,isLive);
}
function fbSaveText(){ return state.fbSave==='saving'?'Saving…':(state.fbSave==='saved'?'✓ Saved':'Shared with team'); }
function fbUpdateSaveInd(){ var el=document.getElementById('fb-saveind'); if(el){ el.className='saveind '+state.fbSave; el.textContent=fbSaveText(); } }
function fbUpdateMacSaveInd(){ var el=document.getElementById('fb-mac-saveind'); if(el){ el.className='saveind '+state.fbSave; el.textContent=fbSaveText(); } }

/* ---- Manage accounts: choose which accounts are managed (active) + rename them
   for the tool. The full roster (active + inactive) comes from the gateway; only
   active accounts pull data & pace. Renames and active flags are team-wide. ---- */
function fbManageModalHTML(){
  if(!state.fbManageOpen) return '';
  var list=(state.fbAcctList||[]).slice().sort(function(x,y){
    var xn=(fbDisplayName(x.account)).toLowerCase(), yn=(fbDisplayName(y.account)).toLowerCase();
    return xn<yn?-1:(xn>yn?1:0);
  });
  var nActive=0; list.forEach(function(a){ if(a.active) nActive++; });
  function rowHTML(a){
    var nm = state.fbAcctName[a.account]!=null ? state.fbAcctName[a.account] : (a.name||'');
    return '<div class="mac-row'+(a.active?' on':'')+'">'
      + '<label class="mac-tog" title="'+(a.active?'Managed — pulling data':'Not managed — no data pulled')+'"><input type="checkbox" class="fb-acct-active" data-acct="'+esc(a.account)+'"'+(a.active?' checked':'')+'><span class="mac-slider"></span></label>'
      + '<div class="mac-names"><input class="fb-acct-rename" data-acct="'+esc(a.account)+'" value="'+esc(nm)+'" placeholder="'+esc(a.account)+'" spellcheck="false">'
      + '<div class="mac-raw" title="Account name in the sheet (unchanged)">'+esc(a.account)+'</div></div>'
      + '<span class="mac-state '+(a.active?'on':'off')+'">'+(a.active?'Active':'Inactive')+'</span></div>';
  }
  var body = list.length ? list.map(rowHTML).join('') : '<div class="mac-empty">No accounts found in the sheet yet.</div>';
  return '<div class="modal-overlay" data-act="fb-manage-close"><div class="modal mac-modal">'
    + '<div class="modal-head"><span class="modal-title">Manage Facebook accounts</span><button class="modal-x" data-act="fb-manage-close">×</button></div>'
    + '<div class="mac-sub">Toggle which accounts are <b>managed</b> — only active accounts pull data and pace. <b>Rename</b> is tool-only and doesn’t touch the sheet. Changes are shared with the team.</div>'
    + '<div class="mac-count"><b>'+nActive+'</b> active · '+(list.length-nActive)+' inactive <span class="saveind '+state.fbSave+'" id="fb-mac-saveind">'+fbSaveText()+'</span></div>'
    + '<div class="mac-list">'+body+'</div>'
    + '<div class="modal-actions"><button class="btn primary" data-act="fb-manage-close">Done</button></div>'
    + '</div></div>';
}
var fbRenameTimers={};
function fbScheduleRename(acct, name){
  state.fbSave='saving'; fbUpdateSaveInd(); fbUpdateMacSaveInd();
  clearTimeout(fbRenameTimers[acct]);
  fbRenameTimers[acct]=setTimeout(function(){
    if(WEBAPP_URL.indexOf('http')!==0){ state.fbSave='idle'; fbUpdateSaveInd(); fbUpdateMacSaveInd(); return; }
    jsonp({ action:'setFbRename', account:acct, name:name })
      .then(function(){ state.fbSave='saved'; fbUpdateSaveInd(); fbUpdateMacSaveInd(); setTimeout(function(){ if(state.fbSave==='saved'){ state.fbSave='idle'; fbUpdateSaveInd(); fbUpdateMacSaveInd(); } },1400); })
      .catch(function(){ state.fbSave='idle'; fbUpdateSaveInd(); fbUpdateMacSaveInd(); });
  }, 700);
}
// Silent refetch after an account is (de)activated — updates the table's data
// without flipping the whole view to the boot/loading screen.
function fbReloadAccounts(){
  if(WEBAPP_URL.indexOf('http')!==0){ state.fbSave='idle'; render(); return; }
  jsonp({ action:'fbData', fresh:'1' }, 60000).then(function(res){
    if(res && res.ok){ state.fbRaw=res.rows||[]; state.fbAcctList=res.accounts||[]; state.fbBudgets=fbBudgetsToMap(res.budgets||[]); FB.rebuild(); }
    state.fbSave='saved'; render(); fbUpdateMacSaveInd();
    setTimeout(function(){ if(state.fbSave==='saved'){ state.fbSave='idle'; fbUpdateSaveInd(); fbUpdateMacSaveInd(); } },1400);
  }).catch(function(){ state.fbSave='idle'; render(); });
}

function trendCellHTML(proj, burn){
  if(!proj) return '<div class="c-num cell-trend">—</div>';
  var st = proj.paused ? 'good' : (burn ? 'over' : statusOf(proj.pct));
  var note = proj.paused ? 'paused'
    : burn ? burn.tag
    : (proj.pct==null ? 'no budget'
      : (st==='good' ? 'on track'
      : (proj.gap>0 ? '+'+money(proj.gap,true)+' over' : money(Math.abs(proj.gap),true)+' under')));
  var tip = proj.paused ? ('Paused — no more spend projected; landed at '+money(proj.proj,true))
    : burn ? burn.text
    : (proj.rate==null ? ('Projected month-end spend: '+money(proj.proj,true))
      : ('At the recent rate: '+money(proj.spent,true)+' spent + '+money(proj.rate)+'/day × '+proj.daysLeft+' left'));
  return '<div class="c-num cell-trend" title="'+esc(tip)+'"><span class="trendval t-'+st+'">'+money(proj.proj,true)+'</span>'
    + '<span class="trendnote t-'+st+(burn?' burn':'')+'">'+esc(note)+'</span></div>';
}
// Completed (past) month: the "Forecast" column shows the ACTUAL final spend.
function fbTrendCellPast(d){
  if(d.forecast==null) return '<div class="c-num cell-trend">—</div>';
  var st=statusOf(d.pace);
  var note = d.variance==null ? 'final'
    : (st==='good' ? 'on budget'
      : (d.variance>0 ? '+'+money(d.variance,true)+' over' : money(Math.abs(d.variance),true)+' under'));
  return '<div class="c-num cell-trend" title="Actual final spend for '+esc(monthLabel(state.viewMonth))+'"><span class="trendval t-'+st+'">'+money(d.forecast,true)+'</span>'
    + '<span class="trendnote t-'+st+'">'+esc(note)+'</span></div>';
}
function fbTrendTot(t,isLive){
  var isPast=state.viewMonth<state.liveKey;
  if(isPast){
    var pctv = t.budget>0 ? t.forecast/t.budget : null, gap=t.budget>0?t.forecast-t.budget:null, stp=statusOf(pctv);
    var np = pctv==null?'final':(stp==='good'?'on budget':(gap>0?'+'+money(gap,true)+' over':money(Math.abs(gap),true)+' under'));
    return '<span class="trendval t-'+stp+'">'+money(t.forecast,true)+'</span><span class="trendnote t-'+stp+'">'+esc(np)+'</span>';
  }
  if(!isLive) return '—';
  var pctv = t.budget>0 ? t.proj/t.budget : null, gap=t.budget>0?t.proj-t.budget:null, st=statusOf(pctv);
  var note = pctv==null?'—':(st==='good'?'on track':(gap>0?'+'+money(gap,true)+' over':money(Math.abs(gap),true)+' under'));
  return '<span class="trendval t-'+st+'">'+money(t.proj,true)+'</span><span class="trendnote t-'+st+'">'+esc(note)+'</span>';
}

/* ---- account rollup row ---- */
function acctRowHTML(a,isLive){
  var isPast=state.viewMonth<state.liveKey, showVals=isLive||isPast;
  var d=acctDerive(a), st=statusOf(d.pace), opn=!!state.fbOpen[a.account], cl=function(v){return showVals?v:'—';};
  var camps=acctVisibleCampaigns(a);
  var burnDot = fbAlertDot(d);
  var html='<div class="fbblock'+(opn?' open':'')+'" data-fbarow="'+esc(a.account)+'">'
    + '<div class="fbgrid fbrow" data-act="fb-toggle" data-acct="'+esc(a.account)+'">'
    + '<div class="c-chev" style="justify-content:center"><span class="chev">▾</span></div>'
    + '<div class="c-name">'+burnDot+'<span class="acc-name" title="'+esc(fbDisplayName(a.account)===a.account?a.account:(fbDisplayName(a.account)+'  ·  '+a.account))+'">'+esc(fbDisplayName(a.account))+'</span>'
      + '<span class="acc-plats"><span class="tag">FB</span><span class="tag flat">'+camps.length+' camp'+(camps.length===1?'':'s')+'</span></span></div>'
    + '<div class="c-num strong fb-mtd">'+cl(money(d.mtd,true))+'</div>'
    + '<div class="c-num fb-forecast">'+cl(money(d.forecast,true))+'</div>'
    + '<div class="c-budget total-budget fb-abudget">'+money(d.effBudget,true)+'</div>'
    + '<div class="c-pace fb-pace">'+(showVals?('<span class="pacepct t-'+st+'">'+pct(d.pace)+'</span>'+meterHTML(d.pace,st)):'<span class="pace-na">—</span>')+'</div>'
    + '<div class="c-num fb-var '+(d.variance>0?'neg':'pos')+'">'+(showVals&&d.variance!=null?((d.variance>0?'+':'')+money(d.variance,true)):'—')+'</div>'
    + (isLive?trendCellHTML(d.proj,d.burn):(isPast?fbTrendCellPast(d):'<div class="c-num cell-trend">—</div>'))
    + '<div class="c-num">'+cl(intf(d.wc))+'</div>'
    + '<div class="c-num">'+cl(intf(d.leads))+'</div>'
    + '<div class="c-num">'+cl(d.cpl!=null?money(d.cpl):'—')+'</div>'
    + '<div class="c-num">'+cl(d.val>0?money(d.val,true):'—')+'</div>'
    + '<div class="c-num">'+cl(xfmt(d.roas))+'</div>'
    + '<div class="c-chev" data-noexpand="1"><button class="rowmsg" data-act="fb-slack" data-kind="account" data-acct="'+esc(a.account)+'" title="Note to #pacing">✎</button></div></div>';
  if(opn){
    html+='<div class="fbcamps">';
    camps.forEach(function(camp){ html+=campRowHTML(a,camp,isLive); });
    html+='</div>';
  }
  return html+'</div>';
}

// Badge showing where Meta holds the budget: Campaign (CBO) vs Ad set (ABO),
// and 'lifetime' when it's a lifetime budget. Blank until the sheet has the
// Budget level / Budget type columns.
function fbLevelBadge(camp){
  var lvl=fbMetaLevel(camp), typ=fbMetaType(camp), bits=[];
  if(lvl) bits.push(lvl==='ad set'?'Ad set':'Campaign');
  if(typ==='lifetime') bits.push('lifetime');
  if(!bits.length) return '';
  return '<span class="fbbud" title="Budget held at '+esc(lvl||'unknown')+' level · '+esc(typ)+'">'+esc(bits.join(' · '))+'</span>';
}
// The budget cell, which varies by mode.
function campBudgetCell(camp,d,b,key){
  // Clicked an Automatic cell to edit, but nothing typed yet: show an editable
  // daily field WITHOUT saving. Blurring it empty reverts to Automatic; typing a
  // value commits it (see the fb-daily-input handler + focusout below).
  if(state.fbPendingDaily===key && b.mode==='auto'){
    return '<div class="fbdailycell">'
      +'<div class="fbdailyfield"><span class="pre">$</span><input class="fb-daily-input" data-key="'+esc(key)+'" data-pending="1" inputmode="numeric" value="" placeholder="'+fmtInt(campDailyVal(camp,b)||0)+'"><span class="suf">/day</span></div>'
      +'<div class="fbmohint">Type a daily budget · blank keeps Automatic</div></div>';
  }
  var carried = b.inherited ? '<span class="carried" title="Carried from '+esc(monthLabel(b.from))+'">↩</span>' : '';
  var inh = b.inherited?' inherited':'';
  if(b.mode==='manual'){
    return carried+'<div class="budgetfield'+inh+'"><span class="bf-pre">$</span>'
      +'<input class="bf-in fb-budget-input" data-key="'+esc(key)+'" inputmode="numeric" value="'+(b.amount===0?'':fmtInt(b.amount))+'" placeholder="Set budget"></div>';
  }
  if(b.mode==='lastMonth'){
    return carried+'<button class="lmbudget fb-to-manual" data-key="'+esc(key)+'" data-amt="'+Math.round(d.effBudget)+'" title="Using last month’s spend — click to set manually">'+money(d.effBudget)+' <span class="lm">LM</span></button>';
  }
  if(b.mode==='lifetime'){
    var lv=(b.amount>0?b.amount:camp.lifetimeBudget)||0;
    return carried+'<div class="fbdailycell'+inh+'">'
      +'<div class="fbdailyfield"><span class="pre">$</span><input class="fb-life-input" data-key="'+esc(key)+'" inputmode="numeric" value="'+(lv?fmtInt(lv):'')+'" placeholder="0"><span class="suf">life</span></div>'
      +'<div class="fbmohint" title="Lifetime budget prorated to this month">'+money(d.effBudget,true)+'/mo</div></div>';
  }
  if(b.mode==='auto'){
    var typ=fbMetaType(camp);
    var sub = typ==='lifetime' ? (money(camp.lifetimeBudget,true)+' lifetime') : (money(camp.dailyBudget)+'/day');
    // Clicking the auto value drops straight into an editable daily budget.
    return '<div class="fbdailycell fbautocell" data-act="fb-to-daily" data-key="'+esc(key)+'" title="Automatic — from the sheet. Click to set a daily budget.">'
      +'<div class="fbautoval">'+money(d.effBudget,true)+'<span class="lm">AUTO</span></div>'
      +'<div class="fbmohint">'+esc(sub)+' · <span class="fbedit">edit</span></div></div>';
  }
  // daily
  var dv=campDailyVal(camp,b);
  return carried+'<div class="fbdailycell'+inh+'">'
    +'<div class="fbdailyfield"><span class="pre">$</span><input class="fb-daily-input" data-key="'+esc(key)+'" inputmode="numeric" value="'+(dv?fmtInt(dv):'')+'" placeholder="0"><span class="suf">/day</span></div>'
    +'<div class="fbmohint" title="Monthly = spent so far + daily × days left">'+money(d.effBudget,true)+'/mo</div></div>';
}

/* ---- campaign pacing row (level 2) ---- */
function campRowHTML(a,camp,isLive){
  var isPast=state.viewMonth<state.liveKey, showVals=isLive||isPast;
  var d=campDerive(camp), st=statusOf(d.pace), key=fbKey(camp.account,camp.campaign);
  var opn=!!state.fbCampOpen[key], cl=function(v){return showVals?v:'—';};
  var b=d.budget;
  var statusOn = String(camp.status||'').toUpperCase().indexOf('ACTIVE')>=0;
  var budgetCell = campBudgetCell(camp,d,b,key);
  var burnDot = fbAlertDot(d);
  var html='<div class="fbcblock'+(opn?' open':'')+'" data-fbrow="'+esc(key)+'">'
    + '<div class="fbgrid fbcrow" data-act="fb-camp-toggle" data-key="'+esc(key)+'">'
    + '<div></div>'
    + '<div class="c-name">'+burnDot+'<span class="acc-name" title="'+esc(camp.campaign)+'">'+esc(camp.campaign)+'</span>'
      + '<span class="acc-plats"><span class="fbstatus '+(statusOn?'on':'off')+'">'+(statusOn?'active':'paused')+'</span>'+fbLevelBadge(camp)+'</span></div>'
    + '<div class="c-num strong fb-mtd">'+cl(money(d.mtd,true))+'</div>'
    + '<div class="c-num fb-forecast">'+cl(money(d.forecast,true))+'</div>'
    + '<div class="c-budget fb-budgetcell" data-noexpand="1">'+budgetCell+'</div>'
    + '<div class="c-pace fb-pace">'+(showVals?('<span class="pacepct t-'+st+'">'+pct(d.pace)+'</span>'+meterHTML(d.pace,st)):'<span class="pace-na">—</span>')+'</div>'
    + '<div class="c-num fb-var '+(d.variance>0?'neg':'pos')+'">'+(showVals&&d.variance!=null?((d.variance>0?'+':'')+money(d.variance,true)):'—')+'</div>'
    + (isLive?trendCellHTML(d.proj,d.burn):(isPast?fbTrendCellPast(d):'<div class="c-num cell-trend">—</div>'))
    + '<div class="c-num">'+cl(intf(d.wc))+'</div>'
    + '<div class="c-num">'+cl(intf(d.leads))+'</div>'
    + '<div class="c-num">'+cl(d.cpl!=null?money(d.cpl):'—')+'</div>'
    + '<div class="c-num">'+cl(d.val>0?money(d.val,true):'—')+'</div>'
    + '<div class="c-num">'+cl(xfmt(d.roas))+'</div>'
    + '<div class="c-chev"><button class="rowmsg" data-noexpand="1" data-act="fb-slack" data-kind="campaign" data-acct="'+esc(camp.account)+'" data-camp="'+esc(camp.campaign)+'" title="Note to #pacing">✎</button><span class="chev">▾</span></div></div>';
  if(opn) html+=campDetailHTML(camp,d);
  return html+'</div>';
}

/* ---- campaign detail: budget mode + charts + daily table ---- */
function campDetailHTML(camp,d){
  var key=fbKey(camp.account,camp.campaign), b=d.budget;
  var cx=ctx(), daysLeft=Math.max(0,cx.dim-cx.elapsed), dv=campDailyVal(camp,b), mtd=aggMonth(camp.daily,state.viewMonth).cost;
  var lvl=fbMetaLevel(camp), typ=fbMetaType(camp);
  var flight = (camp.budgetStart&&camp.budgetEnd) ? (' over '+labelDate(camp.budgetStart)+'–'+labelDate(camp.budgetEnd)) : '';
  var meta;
  if(b.mode==='auto'){
    meta = 'Automatic — Meta has a '+(lvl?lvl+'-level ':'')+typ+' budget'
      + (typ==='lifetime' ? (' of '+money(camp.lifetimeBudget)+flight+' → '+money(d.effBudget)+' this month')
                          : (' of '+money(camp.dailyBudget)+'/day → '+money(mtd)+' spent + '+money(camp.dailyBudget)+' × '+daysLeft+' left = '+money(d.effBudget)));
  } else if(b.mode==='daily'){
    meta = 'Daily budget '+money(dv)+'/day → '+money(mtd)+' spent + '+money(dv)+' × '+daysLeft+' day'+(daysLeft===1?'':'s')+' left = '+money(d.effBudget);
  } else if(b.mode==='lifetime'){
    var lval=(b.amount>0?b.amount:camp.lifetimeBudget)||0;
    meta = 'Lifetime budget '+money(lval)+flight+' → '+money(d.effBudget)+' this month';
  } else if(b.mode==='lastMonth'){
    meta = 'Last month spend = '+money(d.effBudget);
  } else {
    meta = 'Manual monthly budget = '+money(d.effBudget);
  }
  function mbtn(m,label){ return '<button class="'+(b.mode===m?'on':'')+'" data-act="fb-mode" data-key="'+esc(key)+'" data-mode="'+m+'">'+label+'</button>'; }
  var box='<div class="fbbudgetbox"><div class="bb-title">'+esc(monthLabel(state.viewMonth))+' budget</div>'
    + '<div class="segment">'+mbtn('auto','Automatic')+mbtn('daily','Daily')+mbtn('manual','Monthly')+mbtn('lifetime','Lifetime')+'</div>'
    + '<span class="fbmeta">'+esc(meta)+(camp.tags?(' · tags: '+esc(camp.tags)):'')+'</span>'
    + '</div>';
  var charts=fbChartsHTML(camp,d);
  return '<div class="fbdetail">'+box+charts+'</div>';
}

function fbChartsHTML(camp,d){
  var days=state.fbDetailDays||30;
  if(!camp.daily.length) return '<div class="fbmeta">No daily history yet.</div>';
  // Per-day data keyed by date so we can walk a CONTINUOUS calendar and fill
  // days with no export row as $0 — that's what makes a drop-to-zero visible.
  var rich={};
  camp.daily.forEach(function(p){ var k=String(p.date); var o=rich[k]||(rich[k]={cost:0,imp:0,clk:0,wc:0,fl:0,rc:0,val:0}); o.cost+=p.cost;o.imp+=p.imp;o.clk+=p.clk;o.wc+=p.wc;o.fl+=p.fl;o.rc+=(p.rc||0);o.val+=p.val; });
  var first=String(camp.daily[0].date);                       // sorted ascending
  var monthEnd=state.viewMonth+'-'+('0'+daysInMonthOf(state.viewMonth)).slice(-2);
  var yest=isoAdd(todayIso(),-1);
  // Range ends at yesterday for the live month (so every elapsed day shows,
  // data or not), or the month's last day when browsing a past month.
  var isPast=state.viewMonth<state.liveKey;
  var end=(state.viewMonth===state.liveKey) ? (yest<monthEnd?yest:monthEnd) : monthEnd;
  if(end<first) return '<div class="fbmeta">No daily history for '+esc(monthLabel(state.viewMonth))+'.</div>';
  // Past month → scope the window to that calendar month; live month → rolling
  // last-N-days window ending yesterday.
  var start = isPast ? (state.viewMonth+'-01') : isoAdd(end,-(days-1));
  if(start<first) start=first;                                // don't pad with dead days before the campaign existed
  if(start>end) return '<div class="fbmeta">No daily history for '+esc(monthLabel(state.viewMonth))+'.</div>';
  var dim=daysInMonthOf(state.viewMonth);
  var target = d.effBudget>0 ? d.effBudget/dim : 0;
  var cum=0, cexp=0, rows=[], iso=start, i=0;
  while(iso<=end){
    var rr=rich[iso]||{cost:0,imp:0,clk:0,wc:0,fl:0,rc:0,val:0};
    cum+=rr.cost; cexp+=target;
    rows.push({ i:i, date:iso, cost:rr.cost, cum:cum, expected:cexp, target:target,
                wc:rr.wc, fl:rr.fl, rc:rr.rc, leads:(rr.fl+rr.rc), val:rr.val, roas:(rr.val>0&&rr.cost>0)?rr.val/rr.cost:null, clicks:rr.clk, impr:rr.imp });
    iso=isoAdd(iso,1); i++;
  }
  if(!rows.length) return '<div class="fbmeta">No daily history yet.</div>';
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

  var rangebar = isPast
    ? '<div class="rangebar"><span class="rl">'+esc(monthLabel(state.viewMonth))+'</span><span class="rangecount">'+n+' days · '+labelDate(rows[0].date)+' – '+labelDate(last.date)+'</span></div>'
    : '<div class="rangebar"><span class="rl">Last</span><div class="segment sm">'
    + [30,60,90].map(function(dd){return '<button class="'+(days===dd?'on':'')+'" data-act="fb-range" data-days="'+dd+'">'+dd+'d</button>';}).join('')
    + '</div><span class="rangecount">'+n+' days · '+labelDate(rows[0].date)+' – '+labelDate(last.date)+'</span></div>';

  var tbl='<table class="bd"><thead><tr><th>Day</th><th class="r">Spend</th><th class="r">Cumulative</th><th class="r">Expected</th><th class="r">Conversions</th><th class="r">Leads</th>'
    + (hasRev?'<th class="r">Revenue</th><th class="r">ROAS</th>':'')
    + '<th class="r">Clicks</th><th class="r">Impr.</th></tr></thead><tbody>';
  rows.slice().reverse().forEach(function(r){ tbl+='<tr><td>'+labelDate(r.date)+'</td><td class="r">'+money(r.cost)+'</td><td class="r">'+money(r.cum)+'</td><td class="r">'+(r.expected?money(r.expected):'—')+'</td><td class="r">'+intf(r.wc)+'</td><td class="r">'+intf(r.leads)+'</td>'
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
function fbCampByKey(key){ var p=key.split('||'); return fbFindCamp(p[0], p.slice(1).join('||')); }

// patch just the computed cells for a campaign + its account + totals (keeps input focus)
function fbPatchKey(key){
  var isLive=state.viewMonth===state.liveKey;
  var parts=key.split('||'), account=parts[0], campaign=parts.slice(1).join('||');
  var camp=fbFindCamp(account,campaign); if(!camp) return;
  var cd=campDerive(camp);
  var crow=document.querySelector('[data-fbrow="'+cssEscFb(key)+'"]');
  if(crow){ patchComputed(crow, cd, isLive); var mh=crow.querySelector('.fbmohint'); if(mh) mh.textContent=money(cd.effBudget,true)+'/mo'; }
  var acc=fbFindAccount(account);
  var arow=document.querySelector('[data-fbarow="'+cssEscFb(account)+'"]');
  if(acc && arow){ var ad=acctDerive(acc); patchComputed(arow, ad, isLive);
    var ab=arow.querySelector('.fb-abudget'); if(ab) ab.textContent=money(ad.effBudget,true); }
  fbPatchTotals();
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
  else if(act==='fb-sort'){ fbToggleSort(el.getAttribute('data-key')); render(); }
  else if(act==='fb-clear-filter'){ state.fbFilter=''; render(); var fce=document.getElementById('fb-acct-filter'); if(fce) fce.focus(); }
  else if(act==='fb-toggle-drops'){ state.fbFilterDrops=!state.fbFilterDrops; render(); }
  else if(act==='fb-to-daily'){
    var k=el.getAttribute('data-key');
    state.fbPendingDaily=k;   // local, unsaved edit — nothing persists until a value is typed
    render();
    var din=document.querySelector('[data-fbrow="'+cssEscFb(k)+'"] .fb-daily-input');
    if(din){ din.focus(); try{ din.select(); }catch(e){} }
  }
  else if(act==='fb-toggle'){ var acct=el.getAttribute('data-acct'); state.fbOpen[acct]=!state.fbOpen[acct]; render(); }
  else if(act==='fb-camp-toggle'){ if(e.target.closest('[data-noexpand]')) return; var k=el.getAttribute('data-key'); state.fbCampOpen[k]=!state.fbCampOpen[k]; render(); }
  else if(act==='fb-to-manual'){ fbSetBudget(el.getAttribute('data-key'),{mode:'manual',amount:Number(el.getAttribute('data-amt'))||0}); }
  else if(act==='fb-mode'){
    var mkey=el.getAttribute('data-key'), mode=el.getAttribute('data-mode'), patch={mode:mode}, mc=fbCampByKey(mkey);
    if(mode==='auto'||mode==='daily') patch.amount=0;                   // start from the sheet's value
    else if(mode==='lifetime') patch.amount=mc?Math.round(mc.lifetimeBudget||0):0;
    else if(mode==='manual'){ if(mc) patch.amount=Math.round(campEffBudget(mc)); }  // seed with current monthly
    fbSetBudget(mkey,patch);
  }
  else if(act==='fb-range'){ state.fbDetailDays=parseInt(el.getAttribute('data-days'),10)||30; render(); }
  else if(act==='fb-slack'){ state.fbSlackFor={kind:el.getAttribute('data-kind'),account:el.getAttribute('data-acct'),campaign:el.getAttribute('data-camp')||''}; render(); var n=document.getElementById('fb-slack-note'); if(n) n.focus(); }
  else if(act==='fb-slack-send'){ fbSendSlack(); }
  else if(act==='fb-slack-cancel'){ if(el.classList.contains('modal-overlay') && e.target!==el) return; fbCloseSlack(); }
  else if(act==='fb-manage'){ state.fbManageOpen=true; render(); }
  else if(act==='fb-manage-close'){ if(el.classList.contains('modal-overlay') && e.target!==el) return; state.fbManageOpen=false; render(); }
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
  } else if(e.target.classList.contains('fb-daily-input')){
    var del=e.target, dkey=del.getAttribute('data-key');
    var ddig=del.value.replace(/[^0-9]/g,'');
    var dval=ddig===''?0:parseInt(ddig,10);
    var dbefore=del.value.slice(0,del.selectionStart).replace(/[^0-9]/g,'').length;
    var dfmt=ddig===''?'':dval.toLocaleString('en-US');
    del.value=dfmt;
    var dp=0,ds=0; while(dp<dfmt.length&&ds<dbefore){ if(dfmt.charCodeAt(dp)>=48&&dfmt.charCodeAt(dp)<=57) ds++; dp++; }
    try{ del.setSelectionRange(dp,dp); }catch(err){}
    // A pending (just-clicked Automatic) cell only commits once a real value is
    // typed — an empty pending field stays revertible (see focusout below).
    var dpending = del.getAttribute('data-pending')==='1' && state.fbPendingDaily===dkey;
    if(dpending && !(dval>0)) return;
    if(dpending) state.fbPendingDaily=null;               // value typed → commit
    fbSetBudget(dkey,{mode:'daily',amount:dval}, true);  // store the DAILY budget; keep focus
    fbPatchKey(dkey);
  } else if(e.target.classList.contains('fb-life-input')){
    var lel=e.target, lkey=lel.getAttribute('data-key');
    var ldig=lel.value.replace(/[^0-9]/g,''); var lval=ldig===''?0:parseInt(ldig,10);
    var lbefore=lel.value.slice(0,lel.selectionStart).replace(/[^0-9]/g,'').length;
    var lfmt=ldig===''?'':lval.toLocaleString('en-US'); lel.value=lfmt;
    var lp=0,ls=0; while(lp<lfmt.length&&ls<lbefore){ if(lfmt.charCodeAt(lp)>=48&&lfmt.charCodeAt(lp)<=57) ls++; lp++; }
    try{ lel.setSelectionRange(lp,lp); }catch(err){}
    fbSetBudget(lkey,{mode:'lifetime',amount:lval}, true);  // store the LIFETIME budget; keep focus
    fbPatchKey(lkey);
  } else if(e.target.id==='fb-day-input'){
    var v=e.target.value.replace(/[^0-9]/g,'');
    state.elapsedOverride = v===''?null:parseInt(v,10);
    saveElapsed(state.elapsedOverride);
    render();
  } else if(e.target.id==='fb-acct-filter'){
    state.fbFilter=e.target.value;
    var fpos=e.target.selectionStart;
    render();
    var fel=document.getElementById('fb-acct-filter');
    if(fel){ fel.focus(); try{ fel.setSelectionRange(fpos,fpos); }catch(err){} }
  } else if(e.target.classList.contains('fb-acct-rename')){
    // tool-only display rename — update live (no re-render, keep focus), save debounced
    var racct=e.target.getAttribute('data-acct'), rname=e.target.value;
    state.fbAcctName[racct]=rname;
    (state.fbAcctList||[]).forEach(function(a){ if(a.account===racct) a.name=rname; });
    fbScheduleRename(racct, String(rname).trim());
  }
});
// Toggling an account active/inactive (checkbox in the manage panel).
document.addEventListener('change', function(e){
  if(state.view!=='facebook') return;
  if(!e.target.classList || !e.target.classList.contains('fb-acct-active')) return;
  var acct=e.target.getAttribute('data-acct'), on=!!e.target.checked;
  (state.fbAcctList||[]).forEach(function(a){ if(a.account===acct) a.active=on; });   // optimistic
  state.fbSave='saving'; render(); fbUpdateMacSaveInd();
  if(WEBAPP_URL.indexOf('http')!==0){ state.fbSave='idle'; return; }
  jsonp({ action:'setFbActive', account:acct, active:on?'1':'0' }).then(function(r){
    if(r && r.ok){ fbReloadAccounts(); }                 // refetch so the table gains/loses this account's data
    else { (state.fbAcctList||[]).forEach(function(a){ if(a.account===acct) a.active=!on; }); state.fbSave='idle'; render(); toast('Couldn’t update — redeploy the gateway as a new version'); }
  }).catch(function(){ (state.fbAcctList||[]).forEach(function(a){ if(a.account===acct) a.active=!on; }); state.fbSave='idle'; render(); toast('Couldn’t reach the gateway'); });
});
// Leaving an untouched Automatic→daily edit reverts it to Automatic (nothing was
// saved). If a value was typed, the input handler already committed + cleared the
// pending flag, so this is a no-op.
document.addEventListener('focusout', function(e){
  if(state.view!=='facebook') return;
  var t=e.target;
  if(!t.classList || !t.classList.contains('fb-daily-input') || t.getAttribute('data-pending')!=='1') return;
  if(!state.fbPendingDaily) return;                       // already committed
  var digits=(t.value||'').replace(/[^0-9]/g,'');
  if(digits==='' || parseInt(digits,10)===0){ state.fbPendingDaily=null; render(); }
});
})();
