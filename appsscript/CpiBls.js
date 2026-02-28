function fetchCpiBls() {
  const sheetId = 483711737; //Sheet ID for CPI_BLS sheet
  const start = Date.now();
  console.log(`Script started at ${new Date().toISOString()}`);

  const url = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
  const headers = { "Content-Type": "application/json" };

  const payload = JSON.stringify({
    seriesid: [
      "CUUR0000SA0",  // CPI-U, NSA
      "CUSR0000SA0"   // CPI-U, SA
    ],
    startyear: "2024",
    endyear: "2026"
  });

  // --- Fetch step ---
  const tFetchStart = Date.now();
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    headers,
    payload
  });
  const tFetchEnd = Date.now();
  console.log(`Fetch completed in ${tFetchEnd - tFetchStart} ms`);

  // --- Parse + build lookup ---
  const data = JSON.parse(response.getContentText());
  const lookup = {};

  data.Results.series.forEach(series => {
    const id = series.seriesID;
    series.data.forEach(item => {
      const key = `${item.year}-${item.period}`;
      if (!lookup[key]) {
        lookup[key] = {
          year: item.year,
          period: item.period,
          periodName: item.periodName
        };
      }
      if (id === "CUUR0000SA0") {
        lookup[key].NSA = item.value;
      } else if (id === "CUSR0000SA0") {
        lookup[key].SA = item.value;
      }
    });
  });

  // --- Hardcode missing Oct 2025 values if NSA/SA are dashes ---
  const hardKey = "2025-M10";
  if (lookup[hardKey]) {
    console.log(`Before override: NSA=${lookup[hardKey].NSA}, SA=${lookup[hardKey].SA}`);
    if (lookup[hardKey].NSA === "-" || lookup[hardKey].NSA === undefined) {
      lookup[hardKey].NSA = "325.604";
      console.log("NSA patched to 325.604");
    }
    if (lookup[hardKey].SA === "-" || lookup[hardKey].SA === undefined) {
      lookup[hardKey].SA = "325.551";
      console.log("SA patched to 325.551");
    }
    console.log(`After override: NSA=${lookup[hardKey].NSA}, SA=${lookup[hardKey].SA}`);
  }

  // --- Sort step (descending: newest first) ---
  const tSortStart = Date.now();
  const rows = Object.values(lookup).sort((a, b) => {
    if (a.year === b.year) {
      return b.period.localeCompare(a.period); // reverse month order
    }
    return b.year - a.year; // reverse year order
  });
  const tSortEnd = Date.now();
  console.log(`Sort completed in ${tSortEnd - tSortStart} ms`);

  // --- Prepare array for bulk write ---
  const values = [["Year", "Period", "PeriodName", "NSA", "SA"]];
  rows.forEach(r => {
    values.push([r.year, r.period, r.periodName, r.NSA || "", r.SA || ""]);
  });

  // --- Clear only target range + bulk write ---
  const tWriteStart = Date.now();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetById(sheetId);
  const targetRange = sheet.getRange(1, 3, values.length, values[0].length);
  targetRange.clearContent(); // clears only values, preserves formatting/formulas
  targetRange.setValues(values);
  const tWriteEnd = Date.now();
  console.log(`Write completed in ${tWriteEnd - tWriteStart} ms`);

  const end = Date.now();
  console.log(`Total script time: ${end - start} ms`);
}