// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  firstPhaseTotal: 1500000, firstPhaseTerms: 9,
  secondPhaseTotal: 2000000, secondPhaseTerms: 6,
  term1StartDate: '2024-01-01', startTerm: 1,
  interestRate: 8.65, repaymentYears: 10,
  taxBracket: 30, startRepaymentEarly: false, gracePaymentAmount: 0,
  liveRates: null
};

let calc = {};
let amortPage = 1;
const PER = 24;

const BANKS = [
  { bank:"SBI Scholar",         rate:8.65,  gov:true  },
  { bank:"Union Bank",          rate:9.30,  gov:true  },
  { bank:"Bank of Baroda",      rate:9.70,  gov:true  },
  { bank:"Punjab Natl Bank",    rate:9.75,  gov:true  },
  { bank:"Canara Vidya Turant", rate:9.90,  gov:true  },
  { bank:"HDFC Credila",        rate:10.50, gov:false },
  { bank:"IDFC FIRST",          rate:10.50, gov:false },
  { bank:"Axis Bank",           rate:11.00, gov:false },
  { bank:"Avanse",              rate:11.00, gov:false },
];
let bankRates = BANKS.map(b => ({...b}));

// ── Investment simulator state ─────────────────────────────────────────────────
let investState = {
  lumpsumAmount: 0,
  monthlyAmount: 0,
  investYears: 10,
  fdRate: 7.0,
  mfSearchQuery: '',
  mfFunds: [],
  mfLoading: false,
  selectedMF: null,
  mfReturnsRate: 12.0,
  // ✅ NAV cache: schemeCode → { latestNAV, ret1y, ret3y, ret5y }
  navCache: {},
};

// ── Formatting ──────────────────────────────────────────────────────────────
const fmtC = v => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v);
const fmtL = v => '₹'+(v/100000).toFixed(2)+'L';
const fmtD = d => d instanceof Date ? d.toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'}) : d;
const fmtN = v => new Intl.NumberFormat('en-IN',{maximumFractionDigits:2}).format(v);

// ── Core Calculations (aligned with correct logic from TSX) ──────────────────
function compute() {
  const {
    firstPhaseTotal, firstPhaseTerms, secondPhaseTotal, secondPhaseTerms,
    term1StartDate, startTerm, interestRate, repaymentYears,
    taxBracket, startRepaymentEarly, gracePaymentAmount
  } = state;

  const sd = new Date(term1StartDate);
  const tt = firstPhaseTerms + secondPhaseTerms;
  const disbs = [];

  for (let t = startTerm; t <= tt; t++) {
    const mfs = (t-startTerm)*4; // Adjusted for dynamic start term
    const d = new Date(sd); d.setMonth(d.getMonth()+mfs);
    const amount = t <= firstPhaseTerms
      ? firstPhaseTotal / firstPhaseTerms
      : secondPhaseTotal / secondPhaseTerms;
    disbs.push({ term:t, date:d, amount, monthsFromStart:mfs });
  }

  // Course ends 5 years (60 months) from start
  const courseEnd = new Date(sd); courseEnd.setMonth(courseEnd.getMonth()+60);
  // Grace ends 1 year after course
  const graceEnd  = new Date(courseEnd); graceEnd.setMonth(graceEnd.getMonth()+12);
  const repayStart = startRepaymentEarly ? courseEnd : graceEnd;

  // Months from term-1-start to repayment start
  const monthsToRepayStart = startRepaymentEarly ? 60 : 72;

  let totP=0, totSI=0;
  const disbD = disbs.map(d => {
    // SI accrues from disbursement date until repayment starts
    const monthsAccruingSI = Math.max(0, monthsToRepayStart - d.monthsFromStart);
    const si = (d.amount * interestRate * monthsAccruingSI) / (100 * 12);
    totP += d.amount;
    totSI += si;
    return { ...d, masi:monthsAccruingSI, si, total:d.amount+si };
  });

  // Grace period voluntary payments
  let graceSaved = 0;
  let due = totP + totSI;

  if (!startRepaymentEarly && gracePaymentAmount > 0) {
    const totalGracePayment = gracePaymentAmount * 12;
    graceSaved = (totalGracePayment * interestRate) / 100; // Annual SI saved
    due -= totalGracePayment;
  }

  // EMI with COMPOUND INTEREST on due amount
  const mr = interestRate / (12 * 100);
  const nm = repaymentYears * 12;
  const emi = (due * mr * Math.pow(1+mr, nm)) / (Math.pow(1+mr, nm) - 1);

  // Full amortization schedule (compounding each month on balance)
  const amort = [];
  let bal = due, totI = 0, totPP = 0;
  for (let m = 1; m <= nm; m++) {
    const ip = bal * mr;        // Compound interest on current balance
    const pp = emi - ip;
    bal -= pp;
    totI += ip;
    totPP += pp;
    const compoundingEffect = m > 1 ? amort[m-2].bal * mr : 0;
    amort.push({
      m, yr: Math.ceil(m/12), emi, pp, ip,
      bal: Math.max(0, bal),
      cumI: totI, cumP: totPP,
      compoundingEffect
    });
  }

  // Tax benefits (Section 80E — up to 8 years, interest deduction)
  const yearlyTax = [];
  for (let y = 1; y <= Math.min(8, repaymentYears); y++) {
    const yd = amort.filter(a => a.yr === y);
    const yi = yd.reduce((s,a) => s+a.ip, 0);
    const ts = yi * (taxBracket / 100);
    yearlyTax.push({ y, yi, ts, effEMI: emi-(ts/12), mSave: ts/12 });
  }

  const totTax    = yearlyTax.reduce((s,y) => s+y.ts, 0);
  const totIAll   = totSI + totI;
  const totCost   = totP + totIAll;
  const netCost   = totCost - totTax - graceSaved;
  const totRep    = emi * nm;

  const yearSummary = [];
  for (let y = 1; y <= repaymentYears; y++) {
    const yd = amort.filter(a => a.yr === y);
    yearSummary.push({
      y,
      pp:  yd.reduce((s,a) => s+a.pp, 0),
      ip:  yd.reduce((s,a) => s+a.ip, 0),
      bal: yd[yd.length-1]?.bal || 0
    });
  }

  // Prepayment scenario: ₹50K/year extra
  const prepayImpact = calcPrepayImpact(due, mr, nm, emi, 50000/12);

  calc = {
    disbD, totP, totSI, due, courseEnd, graceEnd, repayStart,
    emi, amort, yearlyTax, totI, totIAll, totTax, netCost,
    graceSaved, nm, totRep, yearSummary, mr, interestRate,
    repaymentYears, totCost, prepayImpact
  };
}

// ── Prepayment impact calculator ─────────────────────────────────────────────
function calcPrepayImpact(principal, mr, nm, emi, extraMonthly) {
  // Without prepayment
  const totalWithout = emi * nm;

  // With extra monthly payment
  let bal = principal, m = 0, totalWith = 0;
  while (bal > 0 && m < nm) {
    const ip = bal * mr;
    const pp = Math.min(emi - ip + extraMonthly, bal);
    bal -= pp;
    totalWith += ip + pp;
    m++;
  }
  return {
    monthsSaved: nm - m,
    interestSaved: totalWithout - totalWith,
    newEMI: emi + extraMonthly,
    monthsNew: m
  };
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  try { compute(); } catch(e) { console.error('compute()',e); return; }
  const fns = [updateMetrics, updateSummary, updateDisbTable, updateDates,
                updateAmort, updateCharts, updateBanks, updateAISnapshot,
                updateTips, updateInvestSnapshot, updatePrepayPanel];
  fns.forEach(fn => { try { fn(); } catch(e) { console.error(fn.name+'()',e); } });
}

function txt(id, v)  { const el=document.getElementById(id); if(el) el.textContent=v; }
function html_(id,v) { const el=document.getElementById(id); if(el) el.innerHTML=v;  }

function updateMetrics() {
  txt('m-emi',     fmtC(calc.emi));
  txt('m-emi-sub', `${state.repaymentYears} years`);
  txt('m-cost',    fmtL(calc.totCost));
  txt('m-tax',     fmtL(calc.totTax));
  txt('m-net',     fmtL(calc.netCost));
}

function updateSummary() {
  txt('emiVal',       fmtC(calc.emi));
  txt('emiSub',       `${calc.nm} payments over ${state.repaymentYears} years`);
  txt('s-principal',  fmtC(calc.totP));
  txt('s-si',         fmtC(calc.totSI));
  txt('s-ci',         fmtC(calc.totI));
  txt('s-total',      fmtC(calc.totRep));
  txt('s-tax',        '–'+fmtC(calc.totTax));
  txt('s-net',        fmtC(calc.netCost));
  const pct = (calc.totP / calc.totCost * 100).toFixed(0);
  html_('progressBar', `<div style="width:${pct}%;background:var(--blue)"></div><div style="width:${100-pct}%;background:var(--red)"></div>`);
}

function updateDates() {
  txt('d-start', fmtD(new Date(state.term1StartDate)));
  txt('d-end',   fmtD(calc.courseEnd));
  txt('d-grace', fmtD(calc.graceEnd));
  txt('d-repay', fmtD(calc.repayStart));
}

function updateDisbTable() {
  const rows = calc.disbD.map(d=>`
    <tr>
      <td class="left"><span class="badge badge-blue" style="font-size:11px">T${d.term}</span></td>
      <td class="left" style="color:var(--text2)">${fmtD(d.date)}</td>
      <td style="font-weight:500">${fmtC(d.amount)}</td>
      <td style="color:var(--text3)">${d.masi} mo</td>
      <td style="color:var(--text3)">${fmtC(d.si)}</td>
      <td style="font-weight:700">${fmtC(d.total)}</td>
    </tr>`).join('');
  html_('disbBody', rows);
}

function updateAmort() {
  const totalPages = Math.ceil(calc.amort.length / PER);
  if (amortPage > totalPages) amortPage = 1;
  txt('amortSub', `${calc.amort.length} months · ${state.repaymentYears} years repayment`);
  txt('pageInfo', `${amortPage} / ${totalPages}`);
  document.getElementById('prevBtn').disabled = amortPage===1;
  document.getElementById('nextBtn').disabled = amortPage===totalPages;

  const slice = calc.amort.slice((amortPage-1)*PER, amortPage*PER);
  const rows = slice.map(a=>`
    <tr class="${a.m%12===1?'yr-start':''}">
      <td class="left" style="font-weight:600">${a.m}</td>
      <td class="left" style="color:var(--text3);font-weight:500">Y${a.yr}</td>
      <td style="font-weight:500">${fmtC(a.emi)}</td>
      <td style="color:var(--text2)">${fmtC(a.pp)}</td>
      <td style="color:var(--text3)">${fmtC(a.ip)}</td>
      <td style="font-weight:600">${fmtC(a.bal)}</td>
      <td class="hide-sm" style="color:var(--text3)">${fmtC(a.cumI)}</td>
    </tr>`).join('');
  html_('amortBody', rows);
}

function updateBanks() {
  const nm = state.repaymentYears*12;
  const myRate = state.interestRate;
  const myEMI  = calc.emi;

  const rows = bankRates
    .map(b => {
      const r = b.rate/(12*100);
      const e = (calc.due*r*Math.pow(1+r,nm))/(Math.pow(1+r,nm)-1);
      const tp = e*nm;
      const sav = (myEMI*nm)-tp;
      return {...b, e, tp, sav};
    })
    .sort((a,b)=>a.rate-b.rate);

  txt('bankSub', `EMI for ${fmtC(calc.due)} over ${state.repaymentYears} yrs`);

  const bankRows = rows.map((b,i)=>{
    const isUser = Math.abs(b.rate-myRate)<0.06;
    const isBest = i===0;
    const rateColor = b.rate<=9?'var(--green)':b.rate<=10?'var(--amber)':'var(--red)';
    const savHtml = isUser
      ? '<span style="color:var(--text3)">—</span>'
      : `<span style="color:${b.sav>0?'var(--green)':'var(--red)'};font-weight:600">${b.sav>0?'–':'+'} ${fmtC(Math.abs(b.sav))}</span>`;
    return `<tr style="${isUser?'background:var(--blue-lt)':''}">
      <td class="left">
        ${isBest?'<span class="badge badge-green" style="font-size:10px;padding:2px 6px">Best</span> ':''}
        ${isUser?'<span class="badge badge-blue" style="font-size:10px;padding:2px 6px">Yours</span> ':''}
        ${b.isLive?'<span style="color:var(--green);font-size:11px">●</span> ':''}
        <span style="font-weight:600;color:${isUser?'var(--blue)':'var(--text)'}">${b.bank}</span>
        ${b.gov?' <span style="font-size:11px;color:var(--text3)">🏛</span>':''}
      </td>
      <td><span style="font-weight:700;color:${rateColor}">${b.rate}%</span></td>
      <td style="font-weight:600">${fmtC(b.e)}</td>
      <td class="hide-sm" style="color:var(--text2)">${fmtC(b.tp)}</td>
      <td>${savHtml}</td>
    </tr>`;
  }).join('');
  html_('bankBody', bankRows);

  const maxEMI = Math.max(...rows.map(b=>b.e))*1.05;
  const chartH=180, chartW=480, padL=10, padB=40, padT=10;
  const bw=32, gap=16, totalW=(bw+gap)*rows.length;
  const scaleY = v => (chartH-padB-padT)*(1-v/maxEMI)+padT;

  const bars = rows.map((b,i)=>{
    const isUser=Math.abs(b.rate-myRate)<0.06;
    const fill = isUser?'#2563eb':b.rate<myRate?'#059669':'#cbd5e1';
    const x=padL+i*(bw+gap), y=scaleY(b.e), h=chartH-padB-y;
    const name=b.bank.split(' ')[0];
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${fill}" rx="4"/>
      <text x="${x+bw/2}" y="${chartH-padB+16}" text-anchor="middle" font-size="10" fill="var(--text2)" font-weight="500">${name}</text>
      <text x="${x+bw/2}" y="${y-6}" text-anchor="middle" font-size="10" fill="${fill}" font-weight="600">₹${(b.e/1000).toFixed(0)}K</text>`;
  }).join('');
  html_('bankChart', `<svg viewBox="0 0 ${padL*2+totalW} ${chartH}" style="width:100%;max-width:600px;display:block;margin:0 auto">${bars}</svg>`);
}

// ── Prepayment Panel ──────────────────────────────────────────────────────────
function updatePrepayPanel() {
  const p = calc.prepayImpact;
  if (!p) return;
  const el = document.getElementById('prepayPanel');
  if (!el) return;
  el.innerHTML = `
    <div class="grid4" style="gap:10px;margin-bottom:12px">
      <div class="card2" style="text-align:center">
        <div style="font-size:11px;color:var(--text3)">Extra/month</div>
        <div style="font-weight:800;color:var(--blue)">${fmtC(50000/12)}</div>
      </div>
      <div class="card2" style="text-align:center">
        <div style="font-size:11px;color:var(--text3)">Months saved</div>
        <div style="font-weight:800;color:var(--green)">${p.monthsSaved} months</div>
      </div>
      <div class="card2" style="text-align:center">
        <div style="font-size:11px;color:var(--text3)">Interest saved</div>
        <div style="font-weight:800;color:var(--green)">${fmtL(p.interestSaved)}</div>
      </div>
      <div class="card2" style="text-align:center">
        <div style="font-size:11px;color:var(--text3)">New tenure</div>
        <div style="font-weight:800;color:var(--text)">${(p.monthsNew/12).toFixed(1)} yrs</div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text3);line-height:1.7">
      Adding <strong>₹${Math.round(50000/12).toLocaleString('en-IN')}/month</strong> extra closes your loan
      <strong>${p.monthsSaved} months earlier</strong> and saves <strong>${fmtC(p.interestSaved)}</strong> in interest.
      That's a guaranteed <strong>${((p.interestSaved/(50000/12*calc.nm))*100).toFixed(0)}% return</strong> on your extra payments.
    </div>`;
}

// ── Scenario Comparison ───────────────────────────────────────────────────────
function updateScenarios() {
  const el = document.getElementById('scenarioTable');
  if (!el) return;
  const tenures = [7, 10, 12, 15];
  const mr = calc.mr;
  const rows = tenures.map(yr => {
    const nm = yr*12;
    const e = (calc.due*mr*Math.pow(1+mr,nm))/(Math.pow(1+mr,nm)-1);
    const totI = e*nm - calc.due;
    const taxSav = totI * (Math.min(8,yr)/yr) * (state.taxBracket/100);
    const net = calc.due + totI - taxSav;
    const isCurrent = yr === state.repaymentYears;
    return `<tr style="${isCurrent?'background:var(--blue-lt);font-weight:700':''}">
      <td class="left">${yr} yrs ${isCurrent?'<span class="badge badge-blue" style="font-size:10px">Yours</span>':''}</td>
      <td>${fmtC(e)}</td>
      <td style="color:var(--red)">${fmtL(totI)}</td>
      <td style="color:var(--green)">${fmtL(taxSav)}</td>
      <td style="font-weight:600">${fmtL(net)}</td>
    </tr>`;
  }).join('');
  html_('scenarioTable', rows);
}

function updateCharts() {
  renderPie(); renderBalance(); renderYearly(); renderTaxChart(); renderTaxTable();
  updateScenarios();
}

function renderPie() {
  const vals = [
    {label:'Principal',    v:calc.totP,  color:'#2563eb'},
    {label:'Pre-EMI Int.', v:calc.totSI, color:'#7c3aed'},
    {label:'EMI Interest', v:calc.totI,  color:'#dc2626'},
  ];
  const total = vals.reduce((s,v)=>s+v.v,0);
  const cx=120, cy=105, r=80, ri=48;
  let startAngle = -Math.PI/2;
  let slices='', labels='';
  vals.forEach(v=>{
    const angle=(v.v/total)*2*Math.PI;
    const endAngle=startAngle+angle;
    const x1=cx+r*Math.cos(startAngle), y1=cy+r*Math.sin(startAngle);
    const x2=cx+r*Math.cos(endAngle),   y2=cy+r*Math.sin(endAngle);
    const lx=cx+(r+20)*Math.cos(startAngle+angle/2);
    const ly=cy+(r+20)*Math.sin(startAngle+angle/2);
    const large=angle>Math.PI?1:0;
    slices+=`<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${v.color}"/>`;
    slices+=`<path d="M${cx},${cy} L${cx+ri*Math.cos(startAngle)},${cy+ri*Math.sin(startAngle)} A${ri},${ri} 0 ${large} 1 ${cx+ri*Math.cos(endAngle)},${cy+ri*Math.sin(endAngle)} Z" fill="var(--surface)"/>`;
    labels+=`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="${v.color}" font-weight="700">${(v.v/total*100).toFixed(0)}%</text>`;
    startAngle=endAngle;
  });
  const legend = vals.map((v,i)=>`
    <rect x="250" y="${20+i*34}" width="12" height="12" fill="${v.color}" rx="3"/>
    <text x="268" y="${30+i*34}" font-size="12" fill="var(--text2)" font-weight="500">${v.label}</text>
    <text x="268" y="${46+i*34}" font-size="12" fill="${v.color}" font-weight="700">${fmtL(v.v)}</text>
  `).join('');
  html_('pieChart', `<svg viewBox="0 0 380 210" style="width:100%;max-width:400px;display:block;margin:0 auto">
    ${slices}${labels}${legend}
    <text x="${cx}" y="${cy+4}" text-anchor="middle" font-size="11" fill="var(--text3)">Total</text>
    <text x="${cx}" y="${cy+18}" text-anchor="middle" font-size="12" fill="var(--text)" font-weight="800">${fmtL(total)}</text>
  </svg>`);
}

function renderBalance() {
  const pts = calc.amort.filter((_,i)=>i%6===0||i===calc.amort.length-1);
  const maxBal = Math.max(...pts.map(a=>a.bal));
  const maxI   = Math.max(...pts.map(a=>a.cumI));
  const maxY   = Math.max(maxBal,maxI)*1.05;
  const W=500, H=200, PL=50, PB=30, PR=10, PT=10;
  const iW=W-PL-PR, iH=H-PB-PT;
  const sx=i=>(i/pts.length)*iW+PL;
  const sy=v=>iH*(1-v/maxY)+PT;

  const balPath = pts.map((a,i)=>`${i===0?'M':'L'}${sx(i)},${sy(a.bal)}`).join(' ');
  const intPath = pts.map((a,i)=>`${i===0?'M':'L'}${sx(i)},${sy(a.cumI)}`).join(' ');

  const yTicks = [0,.25,.5,.75,1].map(v=>{
    const val=maxY*v;
    return `<text x="${PL-8}" y="${sy(val)+4}" text-anchor="end" font-size="10" fill="var(--text3)">₹${(val/100000).toFixed(0)}L</text>
    <line x1="${PL}" y1="${sy(val)}" x2="${W-PR}" y2="${sy(val)}" stroke="var(--border)" stroke-dasharray="3 3"/>`;
  }).join('');
  const xTicks = [0,.25,.5,.75,1].map(v=>{
    const i=Math.round(v*(pts.length-1));
    return `<text x="${sx(i)}" y="${H-PB+18}" text-anchor="middle" font-size="10" fill="var(--text3)">M${pts[i]?.m||''}</text>`;
  }).join('');

  html_('balChart', `<svg viewBox="0 0 ${W} ${H}" style="width:100%">
    ${yTicks}${xTicks}
    <path d="${balPath}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
    <path d="${intPath}" fill="none" stroke="#dc2626" stroke-width="2.5"/>
    <circle cx="${W-90}" cy="14" r="5" fill="#2563eb"/><text x="${W-80}" y="18" font-size="11" fill="var(--text2)">Balance</text>
    <circle cx="${W-90}" cy="30" r="5" fill="#dc2626"/><text x="${W-80}" y="34" font-size="11" fill="var(--text2)">Cum. Interest</text>
  </svg>`);
}

function renderYearly() {
  const data = calc.yearSummary;
  const maxV = Math.max(...data.map(d=>d.pp+d.ip))*1.1;
  const W=500, H=200, PL=50, PB=30, PR=10, PT=10;
  const iW=W-PL-PR, iH=H-PB-PT;
  const n=data.length, bw=Math.max(6, Math.min(20,(iW/n)-4));
  const sx=(i,offset)=>PL+(i+.5)*(iW/n)+(offset||0);
  const sy=v=>iH*(1-v/maxV)+PT;
  const sh=v=>(v/maxV)*iH;

  const bars = data.map((d,i)=>{
    const x=sx(i);
    return `<rect x="${x-bw}" y="${sy(d.pp)}" width="${bw}" height="${sh(d.pp)}" fill="#2563eb" rx="2"/>
      <rect x="${x}" y="${sy(d.ip)}" width="${bw}" height="${sh(d.ip)}" fill="#dc2626" rx="2"/>`;
  }).join('');
  const xTick = data.filter((_,i)=>i%Math.ceil(n/6)===0).map(d=>`
    <text x="${sx(d.y-1)}" y="${H-PB+18}" text-anchor="middle" font-size="10" fill="var(--text3)">Y${d.y}</text>
  `).join('');
  const yTicks = [0,.25,.5,.75,1].map(v=>`
    <text x="${PL-8}" y="${sy(maxV*v)+4}" text-anchor="end" font-size="10" fill="var(--text3)">₹${(maxV*v/100000).toFixed(0)}L</text>
    <line x1="${PL}" y1="${sy(maxV*v)}" x2="${W-PR}" y2="${sy(maxV*v)}" stroke="var(--border)" stroke-dasharray="3 3"/>
  `).join('');

  html_('barChart', `<svg viewBox="0 0 ${W} ${H}" style="width:100%">
    ${yTicks}${xTick}${bars}
    <rect x="${PL}" y="12" width="10" height="10" fill="#2563eb" rx="2"/>
    <text x="${PL+14}" y="21" font-size="11" fill="var(--text2)">Principal</text>
    <rect x="${PL+80}" y="12" width="10" height="10" fill="#dc2626" rx="2"/>
    <text x="${PL+94}" y="21" font-size="11" fill="var(--text2)">Interest</text>
  </svg>`);
}

function renderTaxChart() {
  const data = calc.yearlyTax;
  if (!data.length) { html_('taxChart','<p style="color:var(--text3);font-size:13px">No tax bracket selected</p>'); return; }
  const maxI = Math.max(...data.map(d=>d.yi))*1.1;
  const W=440, H=200, PL=50, PB=30, PR=10, PT=10;
  const iW=W-PL-PR, iH=H-PB-PT;
  const n=data.length, bw=Math.max(10,(iW/n)-8);
  const sx=i=>PL+(i+.5)*(iW/n);
  const sy=v=>iH*(1-v/maxI)+PT;
  const sh=v=>(v/maxI)*iH;

  const bars = data.map((d,i)=>`<rect x="${sx(i)-bw/2}" y="${sy(d.yi)}" width="${bw}" height="${sh(d.yi)}" fill="#fecaca" rx="2"/>`).join('');
  const linePath = data.map((d,i)=>`${i===0?'M':'L'}${sx(i)},${sy(d.ts)}`).join(' ');
  const dots = data.map((d,i)=>`<circle cx="${sx(i)}" cy="${sy(d.ts)}" r="4" fill="#059669"/>`).join('');
  const xTick = data.map((d,i)=>`<text x="${sx(i)}" y="${H-PB+18}" text-anchor="middle" font-size="10" fill="var(--text3)">Y${d.y}</text>`).join('');
  const yTicks = [0,.25,.5,.75,1].map(v=>`
    <text x="${PL-8}" y="${sy(maxI*v)+4}" text-anchor="end" font-size="10" fill="var(--text3)">₹${(maxI*v/100000).toFixed(0)}L</text>
    <line x1="${PL}" y1="${sy(maxI*v)}" x2="${W-PR}" y2="${sy(maxI*v)}" stroke="var(--border)" stroke-dasharray="3 3"/>
  `).join('');

  html_('taxChart', `<svg viewBox="0 0 ${W} ${H}" style="width:100%">
    ${yTicks}${xTick}${bars}
    <path d="${linePath}" fill="none" stroke="#059669" stroke-width="2.5" stroke-linejoin="round"/>
    ${dots}
    <rect x="${PL}" y="12" width="10" height="10" fill="#fecaca" rx="2"/>
    <text x="${PL+14}" y="21" font-size="11" fill="var(--text2)">Interest Paid</text>
    <line x1="${PL+100}" y1="17" x2="${PL+114}" y2="17" stroke="#059669" stroke-width="2.5"/>
    <text x="${PL+118}" y="21" font-size="11" fill="var(--text2)">Tax Saving</text>
  </svg>`);
}

function renderTaxTable() {
  const rows = calc.yearlyTax.map(y=>`
    <tr>
      <td class="left" style="color:var(--blue);font-weight:600">Year ${y.y}</td>
      <td style="color:var(--text2)">${fmtC(y.yi)}</td>
      <td style="color:var(--green);font-weight:600">${fmtC(y.ts)}</td>
      <td style="color:var(--text3)">${fmtC(y.mSave)}</td>
      <td style="font-weight:500">${fmtC(y.effEMI)}</td>
    </tr>`).join('');
  html_('taxBody', rows);

  const totYI = calc.yearlyTax.reduce((s,y)=>s+y.yi,0);
  html_('taxFoot', `
    <td class="left">Total</td>
    <td>${fmtC(totYI)}</td>
    <td style="color:var(--green);font-weight:800">${fmtC(calc.totTax)}</td>
    <td style="color:var(--text3)">${fmtC(calc.totTax/96)}</td>
    <td style="color:var(--text3)">—</td>`);
}

function updateAISnapshot() {
  html_('aiSnapshot', [
    ['Principal',      fmtC(calc.totP),    'var(--blue)'],
    ['Monthly EMI',    fmtC(calc.emi),     'var(--purple)'],
    ['Total Interest', fmtC(calc.totIAll), 'var(--red)'],
    ['Tax Savings',    fmtC(calc.totTax),  'var(--green)'],
  ].map(([k,v,c])=>`<div class="card2" style="text-align:center">
    <div style="font-size:12px;color:var(--text3);font-weight:500">${k}</div>
    <div style="font-weight:800;font-size:15px;color:${c};margin-top:4px">${v}</div>
  </div>`).join(''));
}

function updateTips() {
  const bestBank = bankRates.slice().sort((a,b)=>a.rate-b.rate)[0];
  const nm=state.repaymentYears*12;
  const r=bestBank.rate/(12*100);
  const bestEMI=(calc.due*r*Math.pow(1+r,nm))/(Math.pow(1+r,nm)-1);
  const bestSav=(calc.emi*nm)-(bestEMI*nm);
  const emiPct = ((calc.emi / 290000)*100).toFixed(0); // ~₹29L avg IIM CTC/12

  html_('quickTips', [
    {icon:'💡',title:'Section 80E Advantage',
     desc:`At ${state.taxBracket}% bracket you save ${fmtC(calc.totTax)} over 8 yrs — ${fmtC(calc.totTax/8/12)}/month effectively back in pocket.`},
    {icon:'📉',title:'Prepayment Power',
     desc:`Adding ₹${Math.round(50000/12).toLocaleString('en-IN')}/mo extra closes loan ${calc.prepayImpact?.monthsSaved||'~18'} months earlier, saving ${fmtL(calc.prepayImpact?.interestSaved||0)}.`},
    {icon:'🏦',title:'Rate Negotiation',
     desc:`Best market rate is ${bestBank.rate}% vs your ${state.interestRate}%. Switching saves ${fmtC(Math.abs(bestSav))} over full tenure.`},
    {icon:'🎓',title:'IIM EMI Burden',
     desc:`Your EMI is ~${emiPct}% of avg IIM starting salary (₹29L CTC). Budget should aim for EMI < 20% of take-home.`},
  ].map(t=>`<div class="card2">
    <div style="font-size:24px">${t.icon}</div>
    <div style="font-weight:700;font-size:14px;margin:10px 0 4px;color:var(--text)">${t.title}</div>
    <div style="font-size:13px;color:var(--text3);line-height:1.6">${t.desc}</div>
  </div>`).join(''));
}

// ── Prepayment Calculator (full) ─────────────────────────────────────────────
function calcPrepayment() {
  const lumpsum  = +document.getElementById('pp-lumpsum')?.value  || 0;
  const extraMo  = +document.getElementById('pp-monthly')?.value  || 0;
  const applyYr  = +document.getElementById('pp-when')?.value     || 1;
  const resultEl = document.getElementById('pp-result');
  if (!resultEl) return;
  const mr  = calc.mr;
  const emi = calc.emi;
  const totalWithout = emi * calc.nm;
  let bal = calc.due, m = 0, totalWith = 0;
  const applyMonth = applyYr * 12;
  while (bal > 0.01 && m < calc.nm * 2) {
    m++;
    const ip = bal * mr;
    let pp = emi - ip + extraMo;
    if (m === applyMonth) pp += lumpsum;
    pp = Math.min(pp, bal);
    bal -= pp;
    totalWith += ip + pp;
    if (bal <= 0.01) break;
  }
  const monthsSaved   = calc.nm - m;
  const interestSaved = totalWithout - totalWith;
  const extraTotal    = lumpsum + extraMo * m;
  const roi           = extraTotal > 0 ? ((interestSaved / extraTotal)*100).toFixed(0) : 0;
  resultEl.innerHTML = '<div class="grid4" style="gap:10px;margin-top:12px">'
    + '<div class="card2" style="text-align:center"><div style="font-size:11px;color:var(--text3)">Months Saved</div><div style="font-weight:800;font-size:22px;color:var(--green)">' + Math.max(0,monthsSaved) + '</div></div>'
    + '<div class="card2" style="text-align:center"><div style="font-size:11px;color:var(--text3)">Interest Saved</div><div style="font-weight:800;font-size:18px;color:var(--green)">' + fmtL(Math.max(0,interestSaved)) + '</div></div>'
    + '<div class="card2" style="text-align:center"><div style="font-size:11px;color:var(--text3)">New Tenure</div><div style="font-weight:800;font-size:18px;color:var(--blue)">' + (m/12).toFixed(1) + ' yrs</div></div>'
    + '<div class="card2" style="text-align:center"><div style="font-size:11px;color:var(--text3)">Effective ROI</div><div style="font-weight:800;font-size:22px;color:var(--purple)">' + roi + '%</div></div>'
    + '</div>'
    + '<div style="font-size:13px;color:var(--text2);margin-top:10px;line-height:1.7;padding:10px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">'
    + (lumpsum>0 ? 'Paying <strong>' + fmtC(lumpsum) + '</strong> in Year ' + applyYr + ' ' : '')
    + (extraMo>0 ? '+ <strong>' + fmtC(extraMo) + '/month</strong> extra ' : '')
    + 'closes the loan <strong>' + Math.max(0,monthsSaved) + ' months early</strong>, saving <strong>'
    + fmtC(Math.max(0,interestSaved)) + '</strong>. Every extra rupee = guaranteed <strong>' + roi + '% return</strong>.</div>';
}

function updateBreakEven() {
  const lumpsum = +document.getElementById('pp-lumpsum')?.value || 0;
  const applyYr = +document.getElementById('pp-when')?.value    || 1;
  const el      = document.getElementById('pp-breakeven');
  if (!el || lumpsum <= 0) { if(el) el.innerHTML=''; return; }
  const loanR = state.interestRate;
  el.innerHTML = '<div class="card2" style="margin-top:12px;border-left:3px solid var(--amber)"><div style="font-size:13px;color:var(--text2);line-height:1.7">🤔 <strong>Prepay vs Invest?</strong><br>Prepaying is a <strong>guaranteed ' + loanR + '% return</strong> (risk-free). Only invest instead if confident of returns above <strong>' + loanR + '%</strong>.<br>Expected IIM equity SIP: 12–15% → <span style="color:var(--green);font-weight:600">Investing likely wins</span> if fund performs well.</div></div>';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
const PANELS = ['calc','charts','amort','banks','ai','prepay','invest'];
function showTab(id, btn) {
  PANELS.forEach(p=>{
    const el=document.getElementById('tab-'+p);
    if(el) el.style.display = p===id?'block':'none';
  });
  document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll(`[onclick*="showTab('${id}"]`).forEach(el=>el.classList.add('active'));
  document.querySelectorAll('.mnb').forEach(b=>b.classList.remove('active'));
  const mnb=document.getElementById('mnb-'+id);
  if(mnb) mnb.classList.add('active');

  if(id==='charts') updateCharts();
  if(id==='banks')  updateBanks();
  if(id==='invest') updateInvestSnapshot();
}

function toggleEarly() {
  state.startRepaymentEarly = !state.startRepaymentEarly;
  const el=document.getElementById('earlyToggle');
  el.className='toggle-switch '+(state.startRepaymentEarly?'on':'off');
  document.getElementById('gracePay').style.display = state.startRepaymentEarly?'none':'block';
  recalc();
}

function recalc() {
  state.firstPhaseTotal    = +document.getElementById('firstPhaseTotal').value  || 1500000;
  state.secondPhaseTotal   = +document.getElementById('secondPhaseTotal').value || 2000000;
  state.startTerm          = +document.getElementById('startTerm')?.value       || 1; // Added start term support
  state.interestRate       = +document.getElementById('interestRate').value     || 8.65;
  state.repaymentYears     = +document.getElementById('repaymentYears').value   || 10;
  state.term1StartDate     =  document.getElementById('startDate').value        || '2024-01-01';
  state.taxBracket         = +document.getElementById('taxBracket').value;
  state.gracePaymentAmount = +document.getElementById('gracePaymentAmount').value || 0;
  amortPage = 1;
  render();
}

function prevPage() { if(amortPage>1){amortPage--;updateAmort();} }
function nextPage() { const t=Math.ceil(calc.amort.length/PER); if(amortPage<t){amortPage++;updateAmort();} }

// ── Live Rates (Claude API) ────────────────────────────────────────────────────
async function fetchLiveRates() {
  const btn   = document.getElementById('fetchBtn');
  const note  = document.getElementById('rateNote');
  const badge = document.getElementById('rateStatus').querySelector('.badge');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching…';
  badge.className = 'badge badge-blue';
  badge.innerHTML = '<span class="live-dot blue"></span> Fetching live rates…';
  note.textContent = '';

  try {
    const res  = await fetch('/api/rates', { method: 'POST' });
    const data = await res.json();

    if (data.error) throw new Error(data.detail || data.error);
    if (!data.candidates) throw new Error('Unexpected API response from Gemini.');

    const rawText = data.candidates[0].content.parts[0].text;
    const parsed  = JSON.parse(rawText);

    state.liveRates = parsed;

    if (parsed.banks) {
      parsed.banks.forEach(lr => {
        const b = bankRates.find(b => b.bank.toLowerCase().includes(lr.bank.split(' ')[0].toLowerCase()));
        if (b) { b.rate = lr.rate; b.isLive = true; }
      });
    }

    const sbi = parsed.banks?.find(b => b.bank.includes('SBI'));
    if (sbi) {
      document.getElementById('interestRate').value = sbi.rate;
      document.getElementById('rateLabel').textContent = sbi.rate + '%';
      state.interestRate = sbi.rate;
    }

    badge.className = 'badge badge-green';
    badge.innerHTML = '<span class="live-dot green"></span> Live rates active';
    note.textContent = `RBI Repo: ${parsed.repoRate}% · ${parsed.rbi_note || ''}`;

    const lb = document.getElementById('liveBadge');
    if (lb) { lb.className='badge badge-green'; lb.innerHTML='<span class="live-dot green"></span> Live rates'; }

    render();

  } catch(e) {
    console.error('fetchLiveRates error:', e);
    badge.className = 'badge badge-red';
    badge.innerHTML = '<span class="live-dot red"></span> Fetch failed';
    note.textContent = e.message || 'Check console for details.';
  }

  btn.disabled = false;
  btn.textContent = '↻ Refresh Rates';
}

// ── AI Advisor (Claude API) ────────────────────────────────────────────────────
async function fetchAI() {
  const panel = document.getElementById('aiPanel');
  const btn   = document.getElementById('aiBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Analyzing…';
  panel.innerHTML = `<div class="ai-placeholder">
    <div class="ai-dots"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>
    <div style="color:var(--text);font-weight:600;font-size:15px">Claude AI is analyzing your loan…</div>
    <div style="font-size:13px;color:var(--text3);margin-top:6px">Reviewing repayment options, 80E benefits, and market rates</div>
  </div>`;

  const summary = `IIM Student Loan Summary:
- Principal: ${fmtC(calc.totP)}
- Interest Rate: ${state.interestRate}%
- Monthly EMI: ${fmtC(calc.emi)}
- Tenure: ${state.repaymentYears} years (${calc.nm} months)
- Pre-EMI Simple Interest: ${fmtC(calc.totSI)}
- EMI Phase Compound Interest: ${fmtC(calc.totI)}
- Total Interest: ${fmtC(calc.totIAll)}
- Total Repayment: ${fmtC(calc.totRep)}
- Tax Bracket: ${state.taxBracket}% (Section 80E eligible)
- Total Tax Savings (8 yrs): ${fmtC(calc.totTax)}
- Net Cost (after tax): ${fmtC(calc.netCost)}
- Prepayment (₹50K/yr extra) saves: ${fmtC(calc.prepayImpact?.interestSaved||0)} (${calc.prepayImpact?.monthsSaved||0} months early)`;

  try {
    const res  = await fetch('/api/advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary })
    });
    const data = await res.json();

    if (data.error) throw new Error(data.detail || data.error);
    if (!data.candidates) throw new Error('Unexpected API response from Gemini.');

    let txt = data.candidates[0].content.parts[0].text;
    txt = txt.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    txt = txt.replace(/^## (.+)$/gm, '<h4 style="margin:14px 0 4px;color:var(--text);font-size:14px">$1</h4>');
    txt = txt.replace(/^### (.+)$/gm, '<h5 style="margin:10px 0 3px;color:var(--text2);font-size:13px">$1</h5>');
    txt = txt.replace(/^\* (.+)$/gm, '<li style="margin-left:16px;margin-bottom:2px">$1</li>');
    txt = txt.replace(/\n\n/g, '<br><br>');

    if (txt) {
      panel.innerHTML = `<div class="ai-result">${txt}</div>
        <div class="ai-footer">
          <span style="color:var(--text3)">Claude AI · For informational purposes only</span>
          <button class="btn btn-outline btn-sm" onclick="fetchAI()">↻ Regenerate</button>
        </div>`;
    } else {
      throw new Error('No text returned');
    }
  } catch(e) {
    console.error('fetchAI error:', e);
    panel.innerHTML = `<div style="padding:20px;border-radius:8px;background:var(--red-lt);border:1px solid #fecaca">
      <div style="font-size:22px;margin-bottom:8px">❌</div>
      <strong style="color:var(--red)">API Error</strong>
      <p style="margin-top:8px;font-size:13px;color:var(--text2);line-height:1.6">${e.message}</p>
    </div>`;
  }
  btn.disabled = false;
  btn.textContent = '✨ Get AI Advice';
}

// ══════════════════════════════════════════════════════════════════════════════
//  INVESTMENT SIMULATOR
// ══════════════════════════════════════════════════════════════════════════════

function updateInvestSnapshot() {
  const amountEl = document.getElementById('inv-amount');
  if (amountEl && !amountEl.dataset.manuallySet) {
    amountEl.value = Math.round(calc.emi);
  }
  runInvestCalc();
}

function runInvestCalc() {
  const lumpsum = +document.getElementById('inv-lumpsum')?.value || 0; // Added Lumpsum capture
  const monthly = +document.getElementById('inv-amount')?.value || Math.round(calc.emi);
  const years   = +document.getElementById('inv-years')?.value  || 10;
  const fdRate  = +document.getElementById('fd-rate')?.value    || 7.0;
  const mfRate  = +document.getElementById('mf-rate')?.value    || 12.0;

  investState.lumpsumAmount = lumpsum;
  investState.monthlyAmount = monthly;
  investState.investYears   = years;
  investState.fdRate        = fdRate;
  investState.mfReturnsRate = mfRate;

  // Mutual Fund - Compounding for both SIP and Lumpsum
  const mr_mf = mfRate / (12 * 100);
  const nm    = years * 12;
  const lumpsumCorpusMF = lumpsum * Math.pow(1 + mfRate/100, years);
  const sipCorpus   = monthly * ((Math.pow(1+mr_mf, nm)-1) / mr_mf) * (1+mr_mf) + lumpsumCorpusMF;
  const sipInvested = (monthly * nm) + lumpsum;
  const sipGain     = sipCorpus - sipInvested;

  // FD — Quarterly compounding for Lumpsum, Monthly for RD (SIP)
  const monthlyFDRate = Math.pow(1+fdRate/100, 1/12) - 1;
  const lumpsumCorpusFD = lumpsum * Math.pow(1 + fdRate/400, years * 4); 
  const fdCorpus   = monthly * ((Math.pow(1+monthlyFDRate, nm)-1) / monthlyFDRate) * (1+monthlyFDRate) + lumpsumCorpusFD;
  const fdInvested = (monthly * nm) + lumpsum;
  const fdGain     = fdCorpus - fdInvested;

  // Year-by-year growth
  const yearData = [];
  for (let y = 1; y <= years; y++) {
    const n = y*12;
    const lCorpusMF = lumpsum * Math.pow(1 + mfRate/100, y);
    const sip = monthly * ((Math.pow(1+mr_mf,n)-1)/mr_mf) * (1+mr_mf) + lCorpusMF;
    
    const lCorpusFD = lumpsum * Math.pow(1 + fdRate/400, y * 4);
    const fd  = monthly * ((Math.pow(1+monthlyFDRate,n)-1)/monthlyFDRate) * (1+monthlyFDRate) + lCorpusFD;
    yearData.push({ y, invested: lumpsum + (monthly*n), sip, fd });
  }

  renderInvestResults({ monthly, years, mfRate, fdRate, sipCorpus, sipInvested, sipGain, fdCorpus, fdInvested, fdGain, yearData, lumpsum });
}

function renderInvestResults({ monthly, years, mfRate, fdRate, sipCorpus, sipInvested, sipGain, fdCorpus, fdInvested, fdGain, yearData, lumpsum }) {
  txt('inv-sip-corpus',    fmtC(sipCorpus));
  txt('inv-sip-gain',      fmtC(sipGain));
  txt('inv-sip-invested',  'Total invested: ' + fmtC(sipInvested));
  txt('inv-sip-invested2', fmtC(sipInvested));
  txt('inv-sip-xirr',      mfRate.toFixed(1) + '%');

  txt('inv-fd-corpus',     fmtC(fdCorpus));
  txt('inv-fd-gain',       fmtC(fdGain));
  txt('inv-fd-invested',   'Total invested: ' + fmtC(fdInvested));
  txt('inv-fd-invested2',  fmtC(fdInvested));
  txt('inv-fd-xirr',       fdRate.toFixed(1) + '%');

  const diff = sipCorpus - fdCorpus;
  txt('inv-diff', `SIP gives ${fmtC(Math.abs(diff))} ${diff>0?'more':'less'} than FD over ${years} years`);

  // Insight: SIP vs Loan prepayment
  const loanSavingEquiv = calc.totIAll * (mfRate/calc.interestRate);
  const el = document.getElementById('inv-insight');
  if (el) {
    el.innerHTML = `<div class="card2" style="margin-top:12px;border-left:3px solid var(--blue)">
      <div style="font-size:13px;color:var(--text2);line-height:1.7">
        📊 <strong>Invest vs Prepay?</strong><br>
        Your loan rate is <strong>${state.interestRate}%</strong>.
        ${mfRate > state.interestRate
          ? `Expected SIP returns (<strong>${mfRate}%</strong>) exceed loan cost → <span style="color:var(--green);font-weight:700">Invest the surplus</span> while paying minimum EMI.`
          : `Loan cost (<strong>${state.interestRate}%</strong>) exceeds SIP returns → <span style="color:var(--amber);font-weight:700">Prepay the loan</span> for guaranteed savings.`
        }<br>
        Over ${years} yrs, SIP gives <strong>${fmtC(sipGain)}</strong> gain vs guaranteed ${fmtC(calc.totIAll * Math.min(1, years/state.repaymentYears))} loan interest cost.
      </div>
    </div>`;
  }

  renderInvestChart(yearData);

  const rows = yearData.map(d=>`<tr>
    <td class="left">Year ${d.y}</td>
    <td>${fmtC(d.invested)}</td>
    <td style="color:var(--blue);font-weight:600">${fmtC(d.sip)}</td>
    <td style="color:var(--green);font-weight:600">${fmtC(d.sip-d.invested)}</td>
    <td style="color:var(--purple);font-weight:600">${fmtC(d.fd)}</td>
    <td style="color:var(--cyan);font-weight:600">${fmtC(d.fd-d.invested)}</td>
  </tr>`).join('');
  html_('inv-table-body', rows);
}

function renderInvestChart(yearData) {
  const maxV = Math.max(...yearData.map(d=>d.sip))*1.05;
  const W=500, H=200, PL=55, PB=30, PR=10, PT=10;
  const iW=W-PL-PR, iH=H-PB-PT;
  const n=yearData.length;
  const sx=i=>PL+(i/(n-1||1))*iW;
  const sy=v=>iH*(1-v/maxV)+PT;

  const invPath = yearData.map((d,i)=>`${i===0?'M':'L'}${sx(i)},${sy(d.invested)}`).join(' ');
  const sipPath = yearData.map((d,i)=>`${i===0?'M':'L'}${sx(i)},${sy(d.sip)}`).join(' ');
  const fdPath  = yearData.map((d,i)=>`${i===0?'M':'L'}${sx(i)},${sy(d.fd)}`).join(' ');

  const yTicks = [0,.25,.5,.75,1].map(v=>{
    const val=maxV*v;
    return `<text x="${PL-8}" y="${sy(val)+4}" text-anchor="end" font-size="10" fill="var(--text3)">₹${(val/100000).toFixed(0)}L</text>
    <line x1="${PL}" y1="${sy(val)}" x2="${W-PR}" y2="${sy(val)}" stroke="var(--border)" stroke-dasharray="3 3"/>`;
  }).join('');
  const xTick = yearData.filter((_,i)=>i%Math.ceil(n/5)===0||i===n-1).map(d=>`
    <text x="${sx(d.y-1)}" y="${H-PB+18}" text-anchor="middle" font-size="10" fill="var(--text3)">Y${d.y}</text>
  `).join('');

  html_('inv-chart', `<svg viewBox="0 0 ${W} ${H}" style="width:100%">
    ${yTicks}${xTick}
    <path d="${invPath}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="5 3"/>
    <path d="${fdPath}"  fill="none" stroke="#059669" stroke-width="2.5"/>
    <path d="${sipPath}" fill="none" stroke="#2563eb" stroke-width="3"/>
    <circle cx="${W-PR-10}" cy="14" r="5" fill="#94a3b8"/>
    <text x="${W-PR-2}" y="18" font-size="11" fill="var(--text2)" text-anchor="end">Invested</text>
    <circle cx="${W-PR-10}" cy="30" r="5" fill="#059669"/>
    <text x="${W-PR-2}" y="34" font-size="11" fill="var(--text2)" text-anchor="end">FD</text>
    <circle cx="${W-PR-10}" cy="46" r="5" fill="#2563eb"/>
    <text x="${W-PR-2}" y="50" font-size="11" fill="var(--text2)" text-anchor="end">SIP/MF</text>
  </svg>`);
}

// ── MF Fund Search — with NAV CACHE ──────────────────────────────────────────

// Debounce helper
let mfSearchTimer = null;
function debouncedMFSearch() {
  clearTimeout(mfSearchTimer);
  mfSearchTimer = setTimeout(searchMFunds, 400);
}

async function searchMFunds() {
  const q = document.getElementById('mf-search')?.value?.trim();
  if (!q || q.length < 3) return;

  investState.mfLoading = true;
  const listEl = document.getElementById('mf-results');
  if (listEl) listEl.innerHTML = '<div style="color:var(--text3);padding:12px;font-size:13px">🔍 Searching funds…</div>';

  try {
    const res  = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!data || !data.length) {
      listEl.innerHTML = '<div style="color:var(--text3);padding:12px;font-size:13px">No funds found. Try different keywords.</div>';
      return;
    }

    investState.mfFunds = data.slice(0, 10);

    const rows = investState.mfFunds.map((f,i)=>`
      <div class="mf-fund-row" onclick="selectMFund(${i})" style="padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
        <div style="font-weight:600;font-size:13px;color:var(--text)">${f.schemeName}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">Code: ${f.schemeCode}
          ${investState.navCache[f.schemeCode] ? '<span style="color:var(--green);font-size:10px"> ✓ cached</span>' : ''}
        </div>
      </div>`).join('');
    listEl.innerHTML = rows;

  } catch(e) {
    listEl.innerHTML = `<div style="color:var(--red);padding:12px;font-size:13px">⚠️ Failed to search: ${e.message}</div>`;
  }
  investState.mfLoading = false;
}

async function selectMFund(idx) {
  const fund = investState.mfFunds[idx];
  if (!fund) return;

  const listEl   = document.getElementById('mf-results');
  const detailEl = document.getElementById('mf-selected');

  // ✅ CHECK CACHE FIRST — skip network if already loaded
  if (investState.navCache[fund.schemeCode]) {
    applyMFData(fund, investState.navCache[fund.schemeCode], detailEl, listEl);
    return;
  }

  if (listEl) listEl.innerHTML = '<div style="color:var(--text3);padding:12px;font-size:13px">⏳ Loading NAV history…</div>';

  try {
    const res  = await fetch(`https://api.mfapi.in/mf/${fund.schemeCode}`);
    const data = await res.json();

    const navHistory = data.data || [];
    const latestNAV  = navHistory[0]?.nav ? parseFloat(navHistory[0].nav) : 0;

    function calcCAGR(years) {
      // Use approximate daily count: 252 trading days/year
      // But mfapi returns ALL calendar days with NAV — use ~365
      const targetIdx = Math.min(Math.round(years * 365), navHistory.length - 1);
      const old = navHistory[targetIdx];
      if (!old || !latestNAV) return null;
      const oldNAV = parseFloat(old.nav);
      if (oldNAV <= 0) return null;
      return ((Math.pow(latestNAV/oldNAV, 1/years) - 1) * 100).toFixed(1);
    }

    const ret1y = calcCAGR(1);
    const ret3y = calcCAGR(3);
    const ret5y = calcCAGR(5);

    const navData = { latestNAV, ret1y, ret3y, ret5y };
    // ✅ STORE IN CACHE
    investState.navCache[fund.schemeCode] = navData;

    applyMFData(fund, navData, detailEl, listEl);

  } catch(e) {
    if (listEl) listEl.innerHTML = `<div style="color:var(--red);padding:12px;font-size:13px">⚠️ Failed to load fund data: ${e.message}</div>`;
  }
}

function applyMFData(fund, navData, detailEl, listEl) {
  const { latestNAV, ret1y, ret3y, ret5y } = navData;

  investState.selectedMF = { ...fund, latestNAV, ret1y, ret3y, ret5y };

  const useRate = parseFloat(ret3y || ret1y || '0');
  if (useRate > 0 && useRate < 60) {
    document.getElementById('mf-rate').value = useRate.toFixed(1);
    document.getElementById('mf-rate-label').textContent = useRate.toFixed(1) + '%';
    investState.mfReturnsRate = useRate;
  }

  if (detailEl) {
    detailEl.style.display = 'block';
    detailEl.innerHTML = `
      <div class="card2" style="margin-top:12px">
        <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:8px">📊 ${fund.schemeName}</div>
        <div class="grid3" style="gap:8px">
          <div style="text-align:center;padding:8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:11px;color:var(--text3)">Latest NAV</div>
            <div style="font-weight:700;color:var(--blue)">₹${latestNAV.toFixed(2)}</div>
          </div>
          <div style="text-align:center;padding:8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:11px;color:var(--text3)">1Y Returns</div>
            <div style="font-weight:700;color:${parseFloat(ret1y||0)>0?'var(--green)':'var(--red)'}">${ret1y ? ret1y+'%' : 'N/A'}</div>
          </div>
          <div style="text-align:center;padding:8px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">
            <div style="font-size:11px;color:var(--text3)">3Y CAGR</div>
            <div style="font-weight:700;color:${parseFloat(ret3y||0)>0?'var(--green)':'var(--red)'}">${ret3y ? ret3y+'%' : 'N/A'}</div>
          </div>
        </div>
        <p style="font-size:12px;color:var(--text3);margin-top:8px">
          ✅ SIP return rate updated to ${ret3y||ret1y||investState.mfReturnsRate}% · 
          <span style="color:var(--green)">Cached for instant reloads</span>
        </p>
      </div>`;
  }

  if (listEl) listEl.innerHTML = '';
  runInvestCalc();
}

// ══════════════════════════════════════════════════════════════════════════════
//  PROFESSIONAL EXCEL EXPORT
// ══════════════════════════════════════════════════════════════════════════════
function exportExcel() {
  const wb = XLSX.utils.book_new();

  function makeSheet(aoa, cols) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (cols) ws['!cols'] = cols.map(w=>({wch:w}));
    return ws;
  }

  const now = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});

  // Sheet 1: Executive Summary
  const s1 = [
    ['STUDENT LOAN CALCULATOR — EXECUTIVE SUMMARY'],
    [`Generated: ${now}    |    Version: Student Loan Pro`],
    [''],
    ['━━━ LOAN INPUTS ━━━'],
    ['Parameter','Value'],
    ['Phase 1 Total',           fmtC(state.firstPhaseTotal)],
    ['Phase 2 Total',           fmtC(state.secondPhaseTotal)],
    ['Total Loan Principal',    fmtC(calc.totP)],
    ['Interest Rate',           state.interestRate + '%'],
    ['Repayment Tenure',        state.repaymentYears + ' years'],
    ['Tax Bracket',             state.taxBracket + '%'],
    ['Course Start Date',       fmtD(new Date(state.term1StartDate))],
    ['Course End Date',         fmtD(calc.courseEnd)],
    ['Grace Period End',        fmtD(calc.graceEnd)],
    ['Repayment Start',         fmtD(calc.repayStart)],
    [''],
    ['━━━ LOAN RESULTS ━━━'],
    ['Metric','Amount'],
    ['Monthly EMI',                     calc.emi],
    ['Total Principal',                 calc.totP],
    ['Pre-EMI Simple Interest',         calc.totSI],
    ['EMI Phase Compound Interest',     calc.totI],
    ['Total Interest (Pre+EMI)',        calc.totIAll],
    ['Total Repayment Amount',          calc.totRep],
    [''],
    ['━━━ TAX BENEFITS (Section 80E) ━━━'],
    ['Metric','Value'],
    ['Total Tax Savings (8 years)',     calc.totTax],
    ['Avg Monthly Tax Saving',          calc.totTax / 96],
    ['Net Cost After Tax Benefits',     calc.netCost],
    ['Interest as % of Principal',      ((calc.totIAll/calc.totP)*100).toFixed(1)+'%'],
    [''],
    ['━━━ PREPAYMENT SCENARIO (₹50K/yr extra) ━━━'],
    ['Months Saved',    calc.prepayImpact?.monthsSaved || 0],
    ['Interest Saved',  calc.prepayImpact?.interestSaved || 0],
    ['New Tenure (yrs)',(calc.prepayImpact?.monthsNew||0)/12],
  ];
  XLSX.utils.book_append_sheet(wb, makeSheet(s1,[35,20]), 'Summary');

  // Sheet 2: Disbursements
  const s2 = [
    ['DISBURSEMENT SCHEDULE'],[''],
    ['Term','Date','Disbursement (₹)','Months Accruing SI','Simple Interest (₹)','Total Due (₹)'],
    ...calc.disbD.map(d=>['T'+d.term, fmtD(d.date), +d.amount.toFixed(2), d.masi, +d.si.toFixed(2), +d.total.toFixed(2)]),
    [''],
    ['TOTAL','',+calc.totP.toFixed(2),'',+calc.totSI.toFixed(2),+(calc.totP+calc.totSI).toFixed(2)],
  ];
  XLSX.utils.book_append_sheet(wb, makeSheet(s2,[8,14,20,18,20,16]), 'Disbursements');

  // Sheet 3: Full Amortization
  const s3 = [
    ['FULL AMORTIZATION SCHEDULE'],[''],
    ['Month','Year','EMI (₹)','Principal Paid (₹)','Interest Paid (₹)','Balance (₹)','Cum. Interest (₹)','Cum. Principal (₹)'],
    ...calc.amort.map(a=>[a.m,'Y'+a.yr,+a.emi.toFixed(2),+a.pp.toFixed(2),+a.ip.toFixed(2),+a.bal.toFixed(2),+a.cumI.toFixed(2),+a.cumP.toFixed(2)]),
    [''],
    ['TOTAL','',+calc.totRep.toFixed(2),+calc.totP.toFixed(2),+calc.totI.toFixed(2),'0','',''],
  ];
  XLSX.utils.book_append_sheet(wb, makeSheet(s3,[8,6,12,18,17,14,17,17]), 'Amortization');

  // Sheet 4: Yearly Summary
  const s4 = [
    ['YEARLY SUMMARY'],[''],
    ['Year','Principal Paid (₹)','Interest Paid (₹)','Total EMI Paid (₹)','Balance (₹)','Interest %'],
    ...calc.yearSummary.map(d=>['Year '+d.y,+d.pp.toFixed(2),+d.ip.toFixed(2),+(d.pp+d.ip).toFixed(2),+d.bal.toFixed(2),+((d.ip/(d.pp+d.ip))*100).toFixed(1)]),
  ];
  XLSX.utils.book_append_sheet(wb, makeSheet(s4,[8,18,17,18,14,12]), 'Yearly Summary');

  // Sheet 5: Tax Benefits
  const s5 = [
    ['SECTION 80E TAX BENEFIT ANALYSIS'],[''],
    ['Tax Bracket: ' + state.taxBracket + '%'],
    ['Note: Section 80E allows deduction on interest paid for education loans for up to 8 years.'],[''],
    ['Year','Interest Paid (₹)','Tax Saving (₹)','Monthly Saving (₹)','Effective EMI (₹)','Effective Rate (%)'],
    ...calc.yearlyTax.map(y=>['Year '+y.y,+y.yi.toFixed(2),+y.ts.toFixed(2),+y.mSave.toFixed(2),+y.effEMI.toFixed(2),+(state.interestRate*(1-state.taxBracket/100)).toFixed(2)]),
    [''],
    ['TOTAL',+calc.yearlyTax.reduce((s,y)=>s+y.yi,0).toFixed(2),+calc.totTax.toFixed(2),+(calc.totTax/96).toFixed(2),'',''],
  ];
  XLSX.utils.book_append_sheet(wb, makeSheet(s5,[8,18,16,18,16,16]), 'Tax Benefits (80E)');

  // Sheet 6: Bank Comparison
  const nm = state.repaymentYears*12;
  const bankRows = bankRates.map(b=>{
    const r=b.rate/(12*100);
    const e=(calc.due*r*Math.pow(1+r,nm))/(Math.pow(1+r,nm)-1);
    const tp=e*nm;
    const sav=(calc.emi*nm)-tp;
    return {...b,e,tp,sav};
  }).sort((a,b)=>a.rate-b.rate);
  const s6 = [
    ['BANK RATE COMPARISON'],[''],
    [`Loan Amount: ${fmtC(calc.due)}    |    Tenure: ${state.repaymentYears} years`],[''],
    ['Bank','Type','Rate (%)','Monthly EMI (₹)','Total Paid (₹)','Savings vs Yours (₹)','Live Rate?'],
    ...bankRows.map(b=>[b.bank,b.gov?'Govt/PSU':'Private/NBFC',b.rate,+b.e.toFixed(2),+b.tp.toFixed(2),+b.sav.toFixed(2),b.isLive?'Yes':'No']),
    [''],
    ['Note: Rates are indicative. Verify directly with banks.'],
  ];
  XLSX.utils.book_append_sheet(wb, makeSheet(s6,[22,14,10,18,18,22,10]), 'Bank Comparison');

  // Sheet 7: Investment Simulator
  const lumpsum   = investState.lumpsumAmount || 0;
  const monthly   = investState.monthlyAmount || Math.round(calc.emi);
  const invYears  = investState.investYears;
  const mfR       = investState.mfReturnsRate;
  const fdR       = investState.fdRate;
  const mr_mf     = mfR/(12*100);
  const inv_nm    = invYears*12;
  
  const lumpsumCorpusMF = lumpsum * Math.pow(1 + mfR/100, invYears);
  const sipFinal  = monthly*((Math.pow(1+mr_mf,inv_nm)-1)/mr_mf)*(1+mr_mf) + lumpsumCorpusMF;
  
  const monthlyFDRate = Math.pow(1+fdR/100,1/12)-1;
  const lumpsumCorpusFD = lumpsum * Math.pow(1 + fdR/400, invYears * 4);
  const fdFinal   = monthly*((Math.pow(1+monthlyFDRate,inv_nm)-1)/monthlyFDRate)*(1+monthlyFDRate) + lumpsumCorpusFD;

  const invYearData = [];
  for(let y=1;y<=invYears;y++){
    const n=y*12;
    const lCorpusMF = lumpsum * Math.pow(1 + mfR/100, y);
    const sip = monthly*((Math.pow(1+mr_mf,n)-1)/mr_mf)*(1+mr_mf) + lCorpusMF;
    
    const lCorpusFD = lumpsum * Math.pow(1 + fdR/400, y * 4);
    const fd = monthly*((Math.pow(1+monthlyFDRate,n)-1)/monthlyFDRate)*(1+monthlyFDRate) + lCorpusFD;
    invYearData.push({y,invested:lumpsum + monthly*n,sip,fd});
  }

  const s7 = [
    ['INVESTMENT SIMULATOR — WHAT IF YOU INVEST YOUR EMI?'],[''],
    ['Assumptions:'],
    ['Lumpsum Investment Amount', fmtC(lumpsum)],
    ['Monthly Investment Amount', fmtC(monthly)],
    ['Investment Period',         invYears + ' years'],
    ['Mutual Fund / SIP Rate',    mfR + '% p.a. (expected)'],
    ['Fixed Deposit Rate',        fdR + '% p.a. (quarterly compounding)'],
    [''],
    ...(investState.selectedMF?[
      ['Selected Fund', investState.selectedMF.schemeName],
      ['Latest NAV', '₹'+investState.selectedMF.latestNAV?.toFixed(2)],
      ['1Y Returns', (investState.selectedMF.ret1y||'N/A')+'%'],
      ['3Y CAGR', (investState.selectedMF.ret3y||'N/A')+'%'],[''],
    ]:[]),
    ['━━━ FINAL CORPUS ━━━'],
    ['Metric','SIP/MF (₹)','FD (₹)'],
    ['Total Invested',+(lumpsum + monthly*inv_nm).toFixed(2),+(lumpsum + monthly*inv_nm).toFixed(2)],
    ['Final Corpus',+sipFinal.toFixed(2),+fdFinal.toFixed(2)],
    ['Total Gain',+(sipFinal - (lumpsum + monthly*inv_nm)).toFixed(2),+(fdFinal - (lumpsum + monthly*inv_nm)).toFixed(2)],
    ['CAGR',mfR+'%',fdR+'%'],
    [''],['━━━ YEAR BY YEAR GROWTH ━━━'],
    ['Year','Invested (₹)','SIP/MF Corpus (₹)','MF Gain (₹)','FD Corpus (₹)','FD Gain (₹)'],
    ...invYearData.map(d=>['Year '+d.y,+d.invested.toFixed(2),+d.sip.toFixed(2),+(d.sip-d.invested).toFixed(2),+d.fd.toFixed(2),+(d.fd-d.invested).toFixed(2)]),
    [''],
    ['Note: MF returns are not guaranteed. Past performance is not indicative of future results.'],
  ];
  XLSX.utils.book_append_sheet(wb, makeSheet(s7,[28,18,18,14,14,14]), 'Investment Simulator');

  XLSX.writeFile(wb, `StudentLoanPro_${now.replace(/ /g,'_')}.xlsx`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  render();
});