function debugExportSingleSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetId = 147571825;
  const sourceSheet = ss.getSheetById(sheetId);
  
  if (!sourceSheet) {
    console.log("ERROR: Sheet with gid " + sheetId + " not found");
    return;
  }
  
  console.log("=== DEBUG EXPORT START ===");
  console.log("Source sheet: " + sourceSheet.getName());
  console.log("Sheet ID: " + sourceSheet.getSheetId());
  
  const lastRow = sourceSheet.getLastRow();
  const lastCol = sourceSheet.getLastColumn();
  console.log("Dimensions: " + lastRow + " rows x " + lastCol + " cols");
  
  // Get formulas and values
  const range = sourceSheet.getRange(1, 1, lastRow, lastCol);
  const formulas = range.getFormulas();
  const values = range.getValues();
  
  console.log("Formulas fetched: " + formulas.length + " rows");
  console.log("Values fetched: " + values.length + " rows");
  
  // Build CSV data
  const headerRow = ["Row"];
  for (let i = 0; i < lastCol; i++) {
    headerRow.push(columnToLetter(i + 1));
  }
  
  const bodyRows = formulas.map((row, r) => {
    const rowData = [r + 1];
    row.forEach((f, c) => {
      rowData.push((f && f !== "") ? f : values[r][c]);
    });
    return rowData;
  });
  
  const combinedData = [headerRow, ...bodyRows];
  console.log("Combined data rows: " + combinedData.length);
  
  // Prepare staging
  let stagingSheet = ss.getSheetById(817844197);
  if (!stagingSheet) {
    stagingSheet = ss.insertSheet("Export_Staging_Debug");
    console.log("Created new staging sheet: " + stagingSheet.getName());
  } else {
    console.log("Using existing staging sheet: " + stagingSheet.getName());
  }
  
  const stagingData = combinedData.map(row => 
    row.map(cell => "'" + cell) 
  );
  
  stagingSheet.clear();
  console.log("Staging sheet cleared");
  
  stagingSheet.getRange(1, 1, stagingData.length, stagingData[0].length).setValues(stagingData);
  console.log("Data written to staging sheet");
  
  SpreadsheetApp.flush();
  console.log("Flush completed");
  
  // Attempt export with logging
  const maxAttempts = 3;
  const delayMs = 3000; // 3 seconds between attempts
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log("\n--- Attempt " + attempt + " ---");
    
    const url = "https://docs.google.com/spreadsheets/d/" + ss.getId() + "/export?format=csv&gid=" + stagingSheet.getSheetId();
    console.log("URL: " + url);
    
    const params = {
      method: "get",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    };
    
    const startTime = new Date().getTime();
    const response = UrlFetchApp.fetch(url, params);
    const fetchTime = new Date().getTime() - startTime;
    
    console.log("Fetch completed in " + fetchTime + "ms");
    console.log("Response code: " + response.getResponseCode());
    
    const content = response.getContentText();
    console.log("Content length: " + content.length + " bytes");
    console.log("First 200 chars: " + content.substring(0, 200));
    
    // Detailed validation
    const isHtml = content.toLowerCase().includes("<html") || 
                   content.toLowerCase().includes("<!doctype") ||
                   content.toLowerCase().includes("<body");
    console.log("Contains HTML: " + isHtml);
    
    const isEmpty = !content || content.trim().length === 0;
    console.log("Is empty: " + isEmpty);
    
    const hasNewlines = content.includes("\n");
    console.log("Has newlines (CSV structure): " + hasNewlines);
    
    const lineCount = content.split("\n").length;
    console.log("Line count: " + lineCount);
    
    if (!isHtml && !isEmpty && hasNewlines && lineCount > 1) {
      console.log("\n✓ VALID CSV - Export successful");
      console.log("Would save: " + sourceSheet.getName() + ".csv");
      return;
    }
    
    console.log("✗ Invalid content detected");
    
    if (attempt < maxAttempts) {
      console.log("Waiting " + delayMs + "ms before retry...");
      Utilities.sleep(delayMs);
    }
  }
  
  console.log("\n=== EXPORT FAILED AFTER 3 ATTEMPTS ===");
}

function columnToLetter(column) {
  let temp, letter = "";
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}