
const fs = require('fs');
function localDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const yieldsText = fs.readFileSync('tests/e2e/YieldsDerivedFromFedInvestPrices.csv', 'utf8');
const yieldsRows = yieldsText.trim().split('\n').slice(1).map(line => {
    const p = line.split(',');
    return { settlementDate: p[0], cusip: p[1], maturity: p[2], coupon: parseFloat(p[3]), baseCpi: parseFloat(p[4]), price: parseFloat(p[5]), yield: parseFloat(p[6]) };
});
const tipsMap = new Map();
for (const r of yieldsRows) {
    tipsMap.set(r.cusip, {
      cusip:    r.cusip,
      maturity: localDate(r.maturity),
      coupon:   r.coupon,
      baseCpi:  r.baseCpi,
      price:    r.price  || null,
      yield:    r.yield  || null,
    });
}
const refCPI = 324.24723; 
const holdingsText = fs.readFileSync('tests/CusipQtyTestLumpy.csv', 'utf8');
const lines = holdingsText.trim().split('\n');
const startIdx = /^[A-Z0-9]{9}$/i.test(lines[0].split(',')[0].trim()) ? 0 : 1;
const holdingsRaw = lines.slice(startIdx).map(line => {
    const p = line.split(',');
    return { cusip: p[0], qty: parseInt(p[1]) };
}).filter(h => h.cusip && !isNaN(h.qty));

let totalCost = 0;
let contiguousCost = 0;
let nonContiguousCost = 0;

const lastYearLimit = 2047;

for (const h of holdingsRaw) {
    const bond = tipsMap.get(h.cusip);
    if (!bond) continue;
    const ir = refCPI / (bond.baseCpi || refCPI);
    const costPerBond = (bond.price / 100) * ir * 1000;
    const cost = h.qty * costPerBond;
    totalCost += cost;
    if (bond.maturity.getFullYear() <= lastYearLimit) {
        contiguousCost += cost;
    } else {
        nonContiguousCost += cost;
        console.log(`Non-contiguous: ${h.cusip} (Year ${bond.maturity.getFullYear()}), Qty ${h.qty}, Cost ${cost.toFixed(2)}`);
    }
}

console.log('Total Cost:', totalCost.toFixed(2));
console.log('Contiguous Cost (up to 2047):', contiguousCost.toFixed(2));
console.log('Non-Contiguous Cost (after 2047):', nonContiguousCost.toFixed(2));
