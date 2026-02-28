function formatHeader() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const headerRange = sheet.getRange(1, 1, 1, sheet.getMaxColumns());

  headerRange.setFontWeight("bold");
  headerRange.setHorizontalAlignment("center");
  headerRange.setWrap(true);

  sheet.setFrozenRows(1);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ladder Builder')
    .addItem('Rebalance holdings for duration match', 'rebalanceHoldingsForGapDurationMatch')
    .addToUi();
}

function writeSheetNamesAndGids() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = ss.getSheets();
  
  // Get the target sheet by GID
  const targetSheet = ss.getSheetById(1583471576);
  
  if (!targetSheet) {
    throw new Error('Sheet with GID 1583471576 not found');
  }
  
  // Prepare a 2D array for bulk writing
  // Headers: Name, GID, Is Hidden
  const outputData = [['Sheet Name', 'GID', 'Is Hidden']];
  
  for (const sheet of allSheets) {
    const isHidden = sheet.isSheetHidden();

    // OPTION: To completely exclude hidden sheets, uncomment the line below:
    // if (isHidden) continue;

    outputData.push([
      sheet.getName(), 
      sheet.getSheetId(), 
      isHidden
    ]);
  }
  
  // Clear existing data in columns A, B, and C
  const maxRows = targetSheet.getMaxRows();
  if (maxRows > 0) {
    targetSheet.getRange(1, 1, maxRows, 3).clearContent();
  }
  
  // Write all data at once
  if (outputData.length > 0) {
    targetSheet.getRange(1, 1, outputData.length, 3).setValues(outputData);
  }
  
  // Format headers
  const headerRange = targetSheet.getRange('A1:C1');
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#f0f0f0');
  
  SpreadsheetApp.flush();
  Logger.log(`Successfully wrote ${outputData.length - 1} sheets to target sheet`);
}