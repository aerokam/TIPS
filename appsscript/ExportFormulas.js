function exportAllSheetsWithFormulasToCsv() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folder = DriveApp.createFolder("CsvWithFormulas_" + new Date().getTime());
  
  // Get SheetRef for logging
  const sheetRefSheet = ss.getSheetById(1583471576);
  const sheetRefData = sheetRefSheet.getDataRange().getValues();
  
  let stagingSheet = ss.getSheetById(817844197);
  
  if (!stagingSheet) {
    stagingSheet = ss.insertSheet("FormulaStagingForExport");
  }

  const sheets = ss.getSheets();
  const sheetsToExport = sheets.filter(s => s.getSheetId() !== stagingSheet.getSheetId());

  console.log("Starting export to: " + folder.getUrl());

  sheetsToExport.forEach(sheet => {
    const sheetId = sheet.getSheetId();
    
    // Check if export is enabled for this sheet
    if (!shouldExport(sheetRefData, sheetId)) {
      console.log("SKIPPED (not enabled): " + sheet.getName());
      return;
    }
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    
    if (lastRow === 0 || lastCol === 0) {
      logToSheetRef(sheetRefSheet, sheetRefData, sheetId, "SKIPPED - Empty", 0);
      return;
    }

    // 1. Get Data
    const range = sheet.getRange(1, 1, lastRow, lastCol);
    const formulas = range.getFormulas();
    const values = range.getValues();

    // 2. Build Grid with Headers
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

    // 3. Write to Staging Sheet
    const stagingData = combinedData.map(row => 
      row.map(cell => "'" + cell) 
    );

    stagingSheet.clear();
    stagingSheet.getRange(1, 1, stagingData.length, stagingData[0].length).setValues(stagingData);
    
    SpreadsheetApp.flush(); 
    
    Utilities.sleep(4000);

    // 4. Download with retry tracking
    const result = fetchCsvWithRetry(ss.getId(), stagingSheet.getSheetId(), sheet.getName());
    
    if (!result.content) {
      console.log("FAILED: " + sheet.getName());
      logToSheetRef(sheetRefSheet, sheetRefData, sheetId, "FAILED", result.attempts);
      return;
    }
    
    // 5. Create File in Drive
    folder.createFile(sheet.getName() + ".csv", result.content, MimeType.CSV);
    
    console.log("SUCCESS: " + sheet.getName());
    logToSheetRef(sheetRefSheet, sheetRefData, sheetId, "SUCCESS", result.attempts);
  });

  console.log("Export Complete. Folder: " + folder.getUrl());
}

function shouldExport(sheetRefData, sheetId) {
  for (let i = 0; i < sheetRefData.length; i++) {
    if (sheetRefData[i][1] == sheetId) { // Column B (gid)
      const exportFlag = String(sheetRefData[i][3]).toLowerCase().trim(); // Column D
      return exportFlag === "yes" || exportFlag === "true" || exportFlag === "1";
    }
  }
  return false; // Default to not exporting if not found
}

function fetchCsvWithRetry(spreadsheetId, sheetId, sheetName) {
  const maxAttempts = 3;
  const delayMs = 5000;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/export?format=csv&gid=" + sheetId;
    const params = {
      method: "get",
      headers: { "Authorization": "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, params);
    const content = response.getContentText();
    
    if (isValidCsv(content)) {
      console.log("Successfully fetched " + sheetName + " on attempt " + attempt);
      return { content: content, attempts: attempt };
    }
    
    console.log("Attempt " + attempt + " for " + sheetName + " returned invalid content, retrying...");
    
    if (attempt < maxAttempts) {
      Utilities.sleep(delayMs);
    }
  }
  
  return { content: null, attempts: maxAttempts };
}

function isValidCsv(content) {
  if (content.toLowerCase().includes("<html") || 
      content.toLowerCase().includes("<!doctype") ||
      content.toLowerCase().includes("<body")) {
    return false;
  }
  
  if (!content || content.trim().length === 0) {
    return false;
  }
  
  return true;
}

function logToSheetRef(sheetRefSheet, sheetRefData, sheetId, status, attempts) {
  for (let i = 0; i < sheetRefData.length; i++) {
    if (sheetRefData[i][1] == sheetId) { // Column B (gid)
      const statusText = status + " (attempt " + attempts + ") - " + new Date().toLocaleString();
      sheetRefSheet.getRange(i + 1, 4).setValue(statusText); // Column D
      return;
    }
  }
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