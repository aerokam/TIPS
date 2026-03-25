import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
import { uploadToR2 } from './r2.js';

const OBJECT_KEY = "Treasuries/RefCpiNsaSa.csv";
const CPI_CSV_URL = "https://pub-ba11062b177640459f72e0a88d0261ae.r2.dev/bls/CPI.csv";

async function calcAndUploadRefCpi() {
  console.log(`Fetching CPI data from ${CPI_CSV_URL}...`);
  const res = await fetch(CPI_CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch CPI data: ${res.status}`);
  const csv = await res.text();

  const cpiData = {};
  const lines = csv.trim().split("\n");
  lines.slice(1).forEach(line => {
    const [year, period, periodName, NSA, SA] = line.split(",");
    if (!period.startsWith("M")) return;
    cpiData[`${year}-${period}`] = { year, period, NSA, SA };
  });

  // --- Build monthly map: "YYYY-M" -> { nsa, sa } ---
  const monthly = {};
  Object.values(cpiData).forEach(r => {
    if (!r.period || !r.period.startsWith("M")) return;
    monthly[`${parseInt(r.year)}-${parseInt(r.period.slice(1))}`] = { nsa: parseFloat(r.NSA), sa: parseFloat(r.SA) };
  });

  const getMo = (yr, mo) => {
    let y = yr, m = mo;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return monthly[`${y}-${m}`] || null;
  };
  
  const daysInMo = (yr, mo) => new Date(yr, mo, 0).getDate();

  const months = Object.keys(monthly).map(k => k.split("-").map(Number))
    .sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);

  if (months.length === 0) throw new Error("No CPI data found");

  const [fy, fm] = months[0];
  const [ly, lm] = months[months.length - 1];

  // Output month range: earliest = firstCpiMonth + 3 (needs CPI(M-4)=firstCpiMonth)
  //                     latest   = lastCpiMonth  + 3 (day 1 needs CPI(M-4)=lastCpiMonth; days 2+ skipped if CPI(M-3) missing)
  let startYr = fy, startMo = fm + 3;
  while (startMo > 12) { startMo -= 12; startYr++; }
  
  let endYr = ly, endMo = lm + 3;
  while (endMo > 12) { endMo -= 12; endYr++; }

  const rows = [];
  let yr = startYr, mo = startMo;

  while (yr < endYr || (yr === endYr && mo <= endMo)) {
    const M = mo + 1; // anchor month
    const cpiM4 = getMo(yr, M - 4);  // Ref CPI for day 1 of output month
    const cpiM3 = getMo(yr, M - 3);  // Ref CPI for day 1 of M (= day 1 of next output month)
    const D = daysInMo(yr, mo);

    for (let d = 1; d <= D; d++) {
      if (!cpiM4) break;
      if (d > 1 && !cpiM3) break;

      const nsa = d === 1 ? cpiM4.nsa : cpiM4.nsa + (d - 1) / D * (cpiM3.nsa - cpiM4.nsa);
      const sa  = d === 1 ? cpiM4.sa  : cpiM4.sa  + (d - 1) / D * (cpiM3.sa  - cpiM4.sa);

      const dateStr = `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      rows.push([dateStr, nsa.toFixed(5), sa.toFixed(5), (nsa / sa).toFixed(5)]);
    }

    if (++mo > 12) { mo = 1; yr++; }
  }

  // Sort descending (newest first)
  rows.sort((a, b) => b[0].localeCompare(a[0]));

  const outputCsv = [
    ["Ref CPI Date", "Ref CPI NSA", "Ref CPI SA", "SA Factor"].join(","),
    ...rows.map(r => r.join(","))
  ].join("\n");

  await uploadToR2(OBJECT_KEY, outputCsv);
  console.log(`calcAndUploadRefCpi: uploaded ${rows.length} daily rows to ${OBJECT_KEY}`);
}

calcAndUploadRefCpi().catch(err => {
  console.error(err);
  process.exit(1);
});
