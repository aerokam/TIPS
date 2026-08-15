// SA / SAO residual analysis harness — reproduces every table in
// knowledge/2.2_SAO_Residual_Analysis.md against live R2 data.
import { yieldFromPrice, calculateDuration, daysBetween } from '../../shared/src/bond-math.js';

const R2 = 'https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev';
const fetchText = async u => (await fetch(u, { cache: 'no-cache' })).text();
const yieldsRaw = (await fetchText(`${R2}/Treasuries/YieldsFromFedInvestPrices.csv`)).trim().split('\n');
const settleStr = yieldsRaw[0].trim();
const yHeader = yieldsRaw[1].split(',');
const yRows = yieldsRaw.slice(2).map(l => {
  const c = l.split(',');
  const o = {}; yHeader.forEach((h, i) => o[h] = c[i]); return o;
});

const refRaw = (await fetchText(`${R2}/TIPS/RefCpiNsaSa.csv`)).trim().split('\n');
const rHeader = refRaw[0].split(',');
const rRows = refRaw.slice(1).map(l => {
  const c = l.split(',');
  const o = {}; rHeader.forEach((h, i) => o[h] = c[i]); return o;
});

const localDate = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };

// TIPS only
const tips = yRows.filter(r => /TIPS|INFLATION/i.test(r.type) || r.datedDateCpi);
// Actually identify by type field
const tipsRows = yRows.filter(r => /TIPS/i.test(r.type));

const settleDate = localDate(settleStr);
const mmddSettle = settleStr.slice(5, 10);
const rSettle = rRows.find(r => r["Ref CPI Date"] && r["Ref CPI Date"].includes(`-${mmddSettle}`));
const saSettle = parseFloat(rSettle?.["SA Factor"]);

const bonds = tipsRows.map(b => {
  const coupon = parseFloat(b.coupon);
  const price = parseFloat(b.price);
  const matureDate = localDate(b.maturity);
  const mmddMature = b.maturity.slice(5, 10);
  const rMature = rRows.find(r => r["Ref CPI Date"] && r["Ref CPI Date"].includes(`-${mmddMature}`));
  const saMature = parseFloat(rMature?.["SA Factor"]);
  if (isNaN(saSettle) || isNaN(saMature)) return null;
  const askYield = yieldFromPrice(price, coupon, settleDate, matureDate);
  const saYield = yieldFromPrice(price * (saSettle / saMature), coupon, settleDate, matureDate);
  const dur = calculateDuration(settleDate, matureDate, coupon, saYield);
  return { cusip: b.cusip, maturity: b.maturity, coupon, price, askYield, saYield, saMature, saRatio: saSettle/saMature, maturityDate: matureDate, dur };
}).filter(Boolean).sort((a,b) => a.maturityDate - b.maturityDate);

// SAO replicate
function calculateSAO(bonds) {
  const n = bonds.length; const sao = new Array(n); const now = settleDate;
  for (let i = n-1; i >= 0; i--) {
    const bond = bonds[i];
    const yearsToMat = (bond.maturityDate - now) / 31557600000;
    if (yearsToMat > 7 || i > n-4) { sao[i] = bond.saYield; bond.tw = null; bond.proj = null; continue; }
    const windowSize = 4; const actualWindow = Math.min(windowSize, n-1-i);
    let sumX=0,sumY=0,sumXY=0,sumX2=0;
    for (let j=1;j<=actualWindow;j++){
      const x=daysBetween(bond.maturityDate, bonds[i+j].maturityDate); const y=sao[i+j];
      sumX+=x;sumY+=y;sumXY+=x*y;sumX2+=x*x;
    }
    const slope=(actualWindow*sumXY-sumX*sumY)/(actualWindow*sumX2-sumX*sumX);
    const intercept=(sumY-slope*sumX)/actualWindow; const projected=intercept;
    let tw=0.2;
    if (yearsToMat<0.5) tw=0.9; else if(yearsToMat<2) tw=0.15; else if(yearsToMat<5) tw=0.25;
    sao[i]=projected*tw+bond.saYield*(1-tw);
    bond.tw=tw; bond.proj=projected;
  }
  return sao;
}
const sao = calculateSAO(bonds);
bonds.forEach((b,i)=>b.saoYield=sao[i]);

console.log(`Settlement: ${settleStr}   saSettle factor: ${saSettle}`);
console.log(`Total TIPS: ${bonds.length}`);
const pct = x => x==null?'   -  ':(x*100).toFixed(3);
const bp  = x => x==null?'  -  ':((x)*10000).toFixed(1);
console.log('');
console.log('mat        cpn   yrs   ask     SA      SAO    SA-SAO  SAmat   SAratio  dur');
for (const b of bonds) {
  const yrs = ((b.maturityDate-settleDate)/31557600000).toFixed(2);
  if (b.maturityDate.getFullYear() > 2031) break;
  console.log(
    `${b.maturity} ${b.coupon.toFixed(3)} ${yrs.padStart(5)} ${pct(b.askYield)} ${pct(b.saYield)} ${pct(b.saoYield)} ${((b.saYield-b.saoYield)*10000).toFixed(1).padStart(6)} ${b.saMature.toFixed(5)} ${b.saRatio.toFixed(5)} ${b.dur? b.dur.toFixed(2):' - '}`
  );
}

// ===== Residual analysis: detrend SA curve, group by maturity month & coupon =====
const region = bonds.filter(b => {
  const yr = b.maturityDate.getFullYear();
  return yr >= 2027 && yr <= 2031;   // flat, reliable region (exclude near-mat noise)
});
// Smooth trend: quadratic least-squares fit of SA yield vs yearsToMat
const X = region.map(b => (b.maturityDate-settleDate)/31557600000);
const Y = region.map(b => b.saYield*100);
// design matrix [1, x, x^2]
function quadFit(xs, ys){
  let S=[[0,0,0],[0,0,0],[0,0,0]], T=[0,0,0];
  for(let k=0;k<xs.length;k++){const x=xs[k],y=ys[k];const b=[1,x,x*x];
    for(let a=0;a<3;a++){T[a]+=b[a]*y;for(let c=0;c<3;c++)S[a][c]+=b[a]*b[c];}}
  // solve 3x3
  const M=S.map((r,i)=>[...r,T[i]]);
  for(let c=0;c<3;c++){let p=c;for(let r=c+1;r<3;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;[M[c],M[p]]=[M[p],M[c]];
    for(let r=0;r<3;r++)if(r!==c){const f=M[r][c]/M[c][c];for(let k=c;k<4;k++)M[r][k]-=f*M[c][k];}}
  return [M[0][3]/M[0][0],M[1][3]/M[1][1],M[2][3]/M[2][2]];
}
const [a0,a1,a2]=quadFit(X,Y);
const trend = x => a0+a1*x+a2*x*x;
region.forEach((b,k)=>{ b.resid = Y[k]-trend(X[k]); });  // residual in bp-ish (pct*100... actually pct units)

const mon = d => d.getMonth()+1;
const byMonth = {};
for(const b of region){const m=mon(b.maturityDate);(byMonth[m]=byMonth[m]||[]).push(b.resid);}
console.log('\n=== SA residual vs smooth quadratic trend, grouped by MATURITY MONTH (region 2027-2031) ===');
console.log('month  n   mean_resid(bp)   values(bp)');
for(const m of Object.keys(byMonth).sort((a,b)=>a-b)){
  const v=byMonth[m]; const mean=v.reduce((s,x)=>s+x,0)/v.length;
  console.log(`  ${String(m).padStart(2)}  ${v.length}   ${(mean*100).toFixed(2).padStart(7)}        ${v.map(x=>(x*100).toFixed(1)).join(', ')}`);
}

console.log('\n=== SAME-DATE coupon pairs (only coupon differs; same saRatio) ===');
const byDate={};
for(const b of bonds){(byDate[b.maturity]=byDate[b.maturity]||[]).push(b);}
console.log('date         lowCpn->SA      highCpn->SA     dSA(bp, high-low)   dDur');
for(const d of Object.keys(byDate).sort()){
  const g=byDate[d]; if(g.length<2) continue;
  g.sort((a,b)=>a.coupon-b.coupon); const lo=g[0],hi=g[g.length-1];
  if(hi.maturityDate.getFullYear()>2031) continue;
  console.log(`${d}  ${lo.coupon.toFixed(3)}->${(lo.saYield*100).toFixed(3)}   ${hi.coupon.toFixed(3)}->${(hi.saYield*100).toFixed(3)}    ${((hi.saYield-lo.saYield)*10000).toFixed(1).padStart(6)}            ${lo.dur&&hi.dur?(hi.dur-lo.dur).toFixed(2):'-'}`);
}

console.log('\n=== How much does CURRENT SAO correct the month residual? (April & October) ===');
for(const b of region){
  const m=mon(b.maturityDate);
  if(m===4||m===10){
    console.log(`${b.maturity} m${m} SAresid=${(b.resid*100).toFixed(1)}bp  SA->SAO moved ${((b.saoYield-b.saYield)*10000).toFixed(1)}bp  (tw=${b.tw})`);
  }
}

// ===== Test user's hypothesis: does INDEX RATIO track the SA residual? =====
const rSettleNSA = parseFloat(rRows.find(r=>r["Ref CPI Date"]===settleStr)?.["Ref CPI NSA"]
   || rRows.find(r=>r["Ref CPI Date"]&&r["Ref CPI Date"].endsWith(mmddSettle))?.["Ref CPI NSA"]);
// attach index ratio from datedDateCpi
const rawByCusip={}; for(const r of yRows) rawByCusip[r.cusip]=r;
for(const b of bonds){
  const dcpi=parseFloat(rawByCusip[b.cusip]?.datedDateCpi);
  b.indexRatio = rSettleNSA/dcpi;
}
console.log(`\nRefCPI NSA @ settle ${settleStr} = ${rSettleNSA}`);
console.log('\n=== Region 2027-2031: residual vs INDEX RATIO and MONTH ===');
console.log('mat         mon  cpn    SAresid(bp)  indexRatio');
const reg = region.slice().sort((a,b)=>a.indexRatio-b.indexRatio);
for(const b of reg){
  console.log(`${b.maturity}  ${String(mon(b.maturityDate)).padStart(2)}  ${b.coupon.toFixed(3)}  ${(b.resid*100).toFixed(1).padStart(6)}      ${b.indexRatio.toFixed(4)}`);
}
// correlation of resid with indexRatio, and resid with month-dummy(april=-1,oct=+1,else from mean)
function corr(xs,ys){const n=xs.length;const mx=xs.reduce((a,b)=>a+b)/n,my=ys.reduce((a,b)=>a+b)/n;
  let sxy=0,sx=0,sy=0;for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sx+=(xs[i]-mx)**2;sy+=(ys[i]-my)**2;}return sxy/Math.sqrt(sx*sy);}
const resids=reg.map(b=>b.resid), irs=reg.map(b=>b.indexRatio);
const monthResidMean={4:-3.89,7:0.75,1:1.33,10:3.20};
const monthPred=reg.map(b=>monthResidMean[mon(b.maturityDate)]);
console.log(`\ncorr(resid, indexRatio)      = ${corr(resids,irs).toFixed(3)}`);
console.log(`corr(resid, month-mean-pred) = ${corr(resids,monthPred).toFixed(3)}`);
// Does indexRatio confound with month? mean IR by month
const irByMonth={}; for(const b of region){const m=mon(b.maturityDate);(irByMonth[m]=irByMonth[m]||[]).push(b.indexRatio);}
console.log('\nmean index ratio by maturity month:');
for(const m of Object.keys(irByMonth).sort((a,b)=>a-b)){const v=irByMonth[m];console.log(`  m${m}: ${(v.reduce((a,b)=>a+b)/v.length).toFixed(4)}  (n=${v.length})`);}

// ===== Test mechanism: Canty Eq17 (semiannual two-month seasonal) vs Eq14 (single month) =====
// raw SA factor for a given month (use day-15 row, any year)
function saFactorForMonth(mm){
  const r = rRows.find(x=>x["Ref CPI Date"] && x["Ref CPI Date"].slice(5)===`${String(mm).padStart(2,'0')}-15`);
  return r? parseFloat(r["SA Factor"]) : null;
}
const Sset = saSettle; // S_settle (already month-15-ish of settle)
function eq17_saYield(b){
  const mat=b.maturityDate; const matMon=mat.getMonth()+1;
  const otherMon=((matMon+6-1)%12)+1;
  // build semiannual cashflows from maturity backward to settle
  const ry=b.saYield; // use Eq14 SA yield as discount proxy (real yield)
  let w_mat=0, w_other=0; // weighted PV grouped by month
  const semi=b.coupon/2*100;
  // iterate coupon dates
  let d=new Date(mat); let cfs=[];
  while(d> settleDate){
    const isMat = d.getTime()===mat.getTime();
    const cf = semi + (isMat?100:0);
    const yrs=(d-settleDate)/31557600000;
    const pv=cf/Math.pow(1+ry/2, 2*yrs);
    const mon=d.getMonth()+1;
    if(mon===matMon) w_mat+=pv; else w_other+=pv;
    d=new Date(d); d.setMonth(d.getMonth()-6);
  }
  const Smat=saFactorForMonth(matMon), Soth=saFactorForMonth(otherMon);
  const blend=(w_mat/Smat + w_other/Soth)/(w_mat+w_other); // = (1/S)_eff
  const SACP17 = b.price * Sset * blend;
  const SACP14 = b.price * (Sset/Smat);
  return { y17: yieldFromPrice(SACP17,b.coupon,settleDate,b.maturityDate),
           y14: yieldFromPrice(SACP14,b.coupon,settleDate,b.maturityDate),
           Smat, Soth, w_other_frac: w_other/(w_mat+w_other) };
}
console.log('\n=== Canty Eq17 (2-month) vs our Eq14 (1-month): does it cut the residual? ===');
console.log('mat        cpn    Eq14_SA  Eq17_SA  d(bp)  othMonWt%  SAresid14(bp)');
for(const b of region){
  if(b.maturityDate.getFullYear()>2031) continue;
  const e=eq17_saYield(b);
  console.log(`${b.maturity} ${b.coupon.toFixed(3)}  ${(e.y14*100).toFixed(3)}  ${(e.y17*100).toFixed(3)}  ${((e.y17-e.y14)*10000).toFixed(1).padStart(5)}   ${(e.w_other_frac*100).toFixed(1).padStart(4)}     ${(b.resid*100).toFixed(1)}`);
}

// ===== PROTOTYPE: de-mean month residual O-step =====
function calculateSAO_demean(bonds){
  const n=bonds.length; const now=settleDate;
  const out=new Array(n);
  // non-anchor set
  const idx=[]; for(let i=0;i<n;i++){const y=(bonds[i].maturityDate-now)/31557600000; if(!(y>7||i>n-4)) idx.push(i);}
  const xs=idx.map(i=>(bonds[i].maturityDate-now)/31557600000);
  const ys=idx.map(i=>bonds[i].saYield*100);
  const [c0,c1,c2]=quadFit(xs,ys); const tr=x=>c0+c1*x+c2*x*x;
  // per-month mean residual
  const mm={};
  idx.forEach((i,k)=>{const m=bonds[i].maturityDate.getMonth()+1;const r=ys[k]-tr(xs[k]);(mm[m]=mm[m]||[]).push(r);});
  const monthMean={}; for(const m in mm) monthMean[m]=mm[m].reduce((a,b)=>a+b,0)/mm[m].length;
  for(let i=0;i<n;i++){
    const y=(bonds[i].maturityDate-now)/31557600000;
    if(y>7||i>n-4){ out[i]=bonds[i].saYield; continue; }
    const m=bonds[i].maturityDate.getMonth()+1;
    out[i]=bonds[i].saYield - (monthMean[m]||0)/100;
  }
  return {out, monthMean};
}
const dm=calculateSAO_demean(bonds);
console.log('\n=== De-mean O-step: per-month mean residual subtracted (bp) ===');
for(const m of Object.keys(dm.monthMean).sort((a,b)=>a-b)) console.log(`  m${m}: ${dm.monthMean[m].toFixed(2)}`);
console.log('\nmat        cpn    SA     SAO_old  SAO_new  oldMove newMove');
for(let i=0;i<bonds.length;i++){
  const b=bonds[i]; if(b.maturityDate.getFullYear()>2031) continue;
  console.log(`${b.maturity} ${b.coupon.toFixed(3)}  ${(b.saYield*100).toFixed(3)}  ${(b.saoYield*100).toFixed(3)}   ${(dm.out[i]*100).toFixed(3)}   ${((b.saoYield-b.saYield)*10000).toFixed(1).padStart(5)}  ${((dm.out[i]-b.saYield)*10000).toFixed(1).padStart(5)}`);
}

// ===== PROTOTYPE v2: centered ~1yr moving-average trend, then de-mean by month =====
function calculateSAO_v2(bonds, {halfWin=0.6}={}){
  const n=bonds.length; const now=settleDate; const out=new Array(n);
  const yrs=bonds.map(b=>(b.maturityDate-now)/31557600000);
  const isAnchor=i=>(yrs[i]>7||i>n-4);
  const isNoise=i=>yrs[i]<0.5; // near-maturity, unreliable SA
  // centered local trend: mean SA of bonds within ±halfWin yrs (removes 1yr seasonal cycle)
  const trend=new Array(n);
  for(let i=0;i<n;i++){
    let s=0,c=0;
    for(let j=0;j<n;j++){ if(Math.abs(yrs[j]-yrs[i])<=halfWin && !isNoise(j)){ s+=bonds[j].saYield; c++; } }
    trend[i]= c? s/c : bonds[i].saYield;
  }
  // per-month mean residual over reliable, non-anchor region
  const mm={};
  for(let i=0;i<n;i++){ if(isAnchor(i)||isNoise(i)) continue; const m=bonds[i].maturityDate.getMonth()+1;
    (mm[m]=mm[m]||[]).push(bonds[i].saYield-trend[i]); }
  const monthMean={}; for(const m in mm){const v=mm[m]; monthMean[m]=v.reduce((a,b)=>a+b,0)/v.length;}
  for(let i=0;i<n;i++){
    if(isAnchor(i)){ out[i]=bonds[i].saYield; continue; }
    if(isNoise(i)){ out[i]=trend[i]; continue; } // replace noisy near-mat with local trend
    const m=bonds[i].maturityDate.getMonth()+1;
    out[i]=bonds[i].saYield-(monthMean[m]||0);
  }
  return {out, monthMean};
}
const v2=calculateSAO_v2(bonds);
console.log('\n=== v2 de-mean: per-month mean residual (bp) ===');
for(const m of Object.keys(v2.monthMean).sort((a,b)=>a-b)) console.log(`  m${m}: ${(v2.monthMean[m]*10000).toFixed(2)}`);
console.log('\nmat        cpn    SA      SAO_old SAO_v2  v2Move(bp)');
for(let i=0;i<bonds.length;i++){
  const b=bonds[i]; if(b.maturityDate.getFullYear()>2031) continue;
  console.log(`${b.maturity} ${b.coupon.toFixed(3)}  ${(b.saYield*100).toFixed(3)}  ${(b.saoYield*100).toFixed(3)}  ${(v2.out[i]*100).toFixed(3)}   ${((v2.out[i]-b.saYield)*10000).toFixed(1).padStart(6)}`);
}

// ===== PROTOTYPE v3: seasonal residual ~ A_month / duration (amortizing) =====
function calculateSAO_v3(bonds,{halfWin=0.6}={}){
  const n=bonds.length, now=settleDate, out=new Array(n);
  const yrs=bonds.map(b=>(b.maturityDate-now)/31557600000);
  const isAnchor=i=>(yrs[i]>7||i>n-4), isNoise=i=>yrs[i]<0.5;
  const dur=i=>bonds[i].dur||yrs[i];
  const trend=new Array(n);
  for(let i=0;i<n;i++){let s=0,c=0;for(let j=0;j<n;j++)if(Math.abs(yrs[j]-yrs[i])<=halfWin&&!isNoise(j)){s+=bonds[j].saYield;c++;}trend[i]=c?s/c:bonds[i].saYield;}
  // amplitude per month: A_m = mean( resid * duration )
  const am={};
  for(let i=0;i<n;i++){if(isAnchor(i)||isNoise(i))continue;const m=bonds[i].maturityDate.getMonth()+1;(am[m]=am[m]||[]).push((bonds[i].saYield-trend[i])*dur(i));}
  const A={};for(const m in am){const v=am[m];A[m]=v.reduce((a,b)=>a+b,0)/v.length;}
  for(let i=0;i<n;i++){
    if(isAnchor(i)){out[i]=bonds[i].saYield;continue;}
    if(isNoise(i)){out[i]=trend[i];continue;}
    const m=bonds[i].maturityDate.getMonth()+1;
    out[i]=bonds[i].saYield-(A[m]||0)/dur(i);
  }
  return {out,A};
}
const v3=calculateSAO_v3(bonds);
// smoothness check: residual vs fresh local trend for each method
function residSpread(vals){
  const n=bonds.length,now=settleDate;const yrs=bonds.map(b=>(b.maturityDate-now)/31557600000);
  const isNoise=i=>yrs[i]<0.5, isAnchor=i=>(yrs[i]>7||i>n-4);
  const tr=new Array(n);for(let i=0;i<n;i++){let s=0,c=0;for(let j=0;j<n;j++)if(Math.abs(yrs[j]-yrs[i])<=0.6&&!isNoise(j)){s+=vals[j];c++;}tr[i]=c?s/c:vals[i];}
  const mm={};let mx=0;for(let i=0;i<n;i++){if(isAnchor(i)||isNoise(i))continue;const m=bonds[i].maturityDate.getMonth()+1;const r=(vals[i]-tr[i])*10000;(mm[m]=mm[m]||[]).push(r);if(Math.abs(r)>mx)mx=Math.abs(r);}
  const out={};for(const m in mm)out[m]=(mm[m].reduce((a,b)=>a+b,0)/mm[m].length).toFixed(1);
  return {monthMeans:out,maxAbs:mx.toFixed(1)};
}
console.log('\n=== Smoothness after each method (residual vs local trend, bp) ===');
console.log('SA      :', JSON.stringify(residSpread(bonds.map(b=>b.saYield))));
console.log('SAO old :', JSON.stringify(residSpread(bonds.map(b=>b.saoYield))));
console.log('SAO v2  :', JSON.stringify(residSpread(v2.out)));
console.log('SAO v3  :', JSON.stringify(residSpread(v3.out)));
console.log('\nv3 amplitude A_month (bp*yr):',Object.fromEntries(Object.entries(v3.A).map(([m,a])=>[m,(a*10000).toFixed(1)])));
console.log('\nmat        cpn    SA     old    v2     v3');
for(let i=0;i<bonds.length;i++){const b=bonds[i];if(b.maturityDate.getFullYear()>2031)continue;
  console.log(`${b.maturity} ${b.coupon.toFixed(3)}  ${(b.saYield*100).toFixed(3)} ${(b.saoYield*100).toFixed(3)} ${(v2.out[i]*100).toFixed(3)} ${(v3.out[i]*100).toFixed(3)}`);}

// ===== FOCUS: why does Jan-2028 sit above the SAO curve? =====
(function(){
  const n=bonds.length, now=settleDate;
  const yrs=bonds.map(b=>(b.maturityDate-now)/31557600000);
  const isNoise=i=>yrs[i]<0.5;
  // local trend of the v3 SAO itself
  const tr=new Array(n);
  for(let i=0;i<n;i++){let s=0,c=0;for(let j=0;j<n;j++)if(Math.abs(yrs[j]-yrs[i])<=0.6&&!isNoise(j)){s+=v3.out[j];c++;}tr[i]=c?s/c:v3.out[i];}
  console.log('\n=== 2027-2028 region: SA, v3 SAO, dev of SAO from local trend, A_month/dur applied ===');
  console.log('mat        cpn    SAresid(bp)  SA      SAO_v3  SAOdev(bp)  Amonth(bp*yr)  offset(bp)  dur');
  for(let i=0;i<n;i++){
    const b=bonds[i]; const y=yrs[i]; if(y<0.3||y>2.6) continue;
    const m=b.maturityDate.getMonth()+1;
    const off=(v3.A[m]||0)/(b.dur||y);
    console.log(`${b.maturity} ${b.coupon.toFixed(3)}  ${(b.resid!=null?(b.resid*100).toFixed(1):' - ').padStart(6)}     ${(b.saYield*100).toFixed(3)}  ${(v3.out[i]*100).toFixed(3)}  ${((v3.out[i]-tr[i])*10000).toFixed(1).padStart(6)}      ${((v3.A[m]||0)*10000).toFixed(1).padStart(5)}        ${(-off*10000).toFixed(1).padStart(5)}     ${(b.dur||y).toFixed(2)}`);
  }
})();

// ===== PROTOTYPE: Nelson-Siegel-Svensson smooth curve as SAO =====
function _nssBasis(tau,l1,l2){const a=tau/l1,b=tau/l2;
  const f1=a>1e-6?(1-Math.exp(-a))/a:1; const t2=f1-Math.exp(-a);
  const fb=b>1e-6?(1-Math.exp(-b))/b:1; const t3=fb-Math.exp(-b);
  return [1,f1,t2,t3];}
function _ols4(X,y){const A=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],bv=[0,0,0,0];
  for(let k=0;k<X.length;k++){const xi=X[k];for(let i=0;i<4;i++){bv[i]+=xi[i]*y[k];for(let j=0;j<4;j++)A[i][j]+=xi[i]*xi[j];}}
  const M=A.map((r,i)=>[...r,bv[i]]);
  for(let c=0;c<4;c++){let p=c;for(let r=c+1;r<4;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    if(Math.abs(M[p][c])<1e-12)return null;[M[c],M[p]]=[M[p],M[c]];
    for(let r=0;r<4;r++)if(r!==c){const f=M[r][c]/M[c][c];for(let k=c;k<5;k++)M[r][k]-=f*M[c][k];}}
  return [M[0][4]/M[0][0],M[1][4]/M[1][1],M[2][4]/M[2][2],M[3][4]/M[3][3]];}
function fitNSS(taus,ys){let best=null;const grid=[0.5,1,1.5,2,2.5,3,4,5,7,10,15,20,30];
  for(const l1 of grid)for(const l2 of grid){if(l2<=l1)continue;
    const X=taus.map(t=>_nssBasis(t,l1,l2));const beta=_ols4(X,ys);if(!beta)continue;
    let ssr=0;for(let k=0;k<taus.length;k++){const xb=_nssBasis(taus[k],l1,l2);const yh=xb[0]*beta[0]+xb[1]*beta[1]+xb[2]*beta[2]+xb[3]*beta[3];ssr+=(ys[k]-yh)**2;}
    if(!best||ssr<best.ssr)best={l1,l2,beta,ssr};}
  if(!best)return null;
  const fn=tau=>{const xb=_nssBasis(tau,best.l1,best.l2);return xb[0]*best.beta[0]+xb[1]*best.beta[1]+xb[2]*best.beta[2]+xb[3]*best.beta[3];};
  fn._p=best;return fn;}

const allYrs=bonds.map(b=>(b.maturityDate-settleDate)/31557600000);
const fitIdx=[];for(let i=0;i<bonds.length;i++)if(allYrs[i]>=0.5)fitIdx.push(i);
const nss=fitNSS(fitIdx.map(i=>allYrs[i]),fitIdx.map(i=>bonds[i].saYield));
console.log('\n=== NSS smooth-curve SAO ===');
console.log('best lambda1,lambda2 =',nss._p.l1,nss._p.l2,' RMSE(bp)=',(Math.sqrt(nss._p.ssr/fitIdx.length)*10000).toFixed(1));
console.log('\nmat        cpn    yrs   SA      NSS_SAO  dev(bp)');
let maxdev=0,sumsq=0,cnt=0;
for(let i=0;i<bonds.length;i++){const b=bonds[i];const y=allYrs[i];if(y>=0.5&&b.maturityDate.getFullYear()<=2055){const fit=nss(y);const dev=(b.saYield-fit)*10000;if(b.maturityDate.getFullYear()<=2031)console.log(`${b.maturity} ${b.coupon.toFixed(3)} ${y.toFixed(2).padStart(5)}  ${(b.saYield*100).toFixed(3)}  ${(fit*100).toFixed(3)}  ${dev.toFixed(1).padStart(6)}`);maxdev=Math.max(maxdev,Math.abs(dev));sumsq+=dev*dev;cnt++;}}
console.log(`\nAcross full curve: max |dev| ${maxdev.toFixed(1)}bp, RMS ${Math.sqrt(sumsq/cnt).toFixed(1)}bp  (these are how far SA sat off the smooth SAO; SAO itself is perfectly smooth)`);
// monotonic-smoothness: print NSS at integer maturities
console.log('NSS curve @ 1..10,15,20,30y:',[1,2,3,4,5,6,7,8,9,10,15,20,30].map(t=>(nss(t)*100).toFixed(3)).join(' '));
