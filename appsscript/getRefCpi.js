function getRefCpi() {

  const targetSheetGid = 237587759; // refCPI
  const cusip = "912810FD5"; // CUSIP with the longest refCPI history

  const dateHeader = "indexDate";

  const finalColumnOrder = [
    "indexDate",
    "refCpi"
  ];

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = spreadsheet.getSheetById(targetSheetGid);

  if (!targetSheet) {
    Logger.log('ERROR: Target sheet not found.');
    return;
  }

  // 1. Fetch Data for the hardcoded CUSIP
  const apiUrl =
    `https://www.treasurydirect.gov/TA_WS/secindex/search?cusip=${cusip}` +
    `&format=jsonp&callback=jQuery_CUSIP_FETCHER&filterscount=0&groupscount=0` +
    `&sortdatafield=indexDate&sortorder=desc&pagenum=0&pagesize=1000` +
    `&recordstartindex=0&recordendindex=1000&_=${new Date().getTime()}`;

  const response = UrlFetchApp.fetch(apiUrl);
  if (response.getResponseCode() !== 200) {
    Logger.log('FETCH FAILURE: CUSIP %s (HTTP Code: %s)', cusip, response.getResponseCode());
    return;
  }

  const jsonpText = response.getContentText();
  const jsonMatch = jsonpText.match(/\[[\s\S]*\]/);

  if (!jsonMatch || jsonMatch.length === 0) {
    Logger.log('FETCH FAILURE: CUSIP %s (Parse Error)', cusip);
    return;
  }

  const cusipDataArray = JSON.parse(jsonMatch[0]);

  Logger.log('FETCH SUCCESS: CUSIP %s (Retrieved %s rows)', cusip, cusipDataArray.length);

  if (cusipDataArray.length === 0) {
    Logger.log('No valid data was retrieved. Nothing to write.');
    return;
  }

  // 2. Prepare Final Data
  Logger.log('Converting array of objects to 2D array of values');

  const valuesToWrite = cusipDataArray.map(dataObject => {

    // Strip time component from indexDate
    if (dataObject[dateHeader]) {
      dataObject[dateHeader] = dataObject[dateHeader].split('T')[0];
    }

    // Map values using finalColumnOrder
    return finalColumnOrder.map(key => {
      const value = dataObject[key];

      if (value === undefined || value === null || value === '') {
        return '';
      }
      return value;
    });
  });

  // Add custom headers
  // const headerRow = ["Index date", "ref CPI"];
  // const dataToWrite = [headerRow, ...valuesToWrite];

  // 3. Write to Target Sheet
  Logger.log('START WRITE: Clearing and writing to sheet GID %s.', targetSheetGid);

  const numRowsToWrite = valuesToWrite.length;
  const numColsToWrite = finalColumnOrder.length;

  const targetRange = targetSheet.getRange(3, 1, numRowsToWrite, numColsToWrite);

  // Clear content from Row 3 downward
  const maxRowsInSheet = targetSheet.getMaxRows();
  const clearRange = targetSheet.getRange(3, 1, maxRowsInSheet - 1, numColsToWrite);
  clearRange.clearContent();

  // Batch write
  targetRange.setValues(valuesToWrite);

  Logger.log(
    'END WRITE: Successfully wrote %s total records to sheet GID %s.',
    numRowsToWrite - 1,
    targetSheetGid
  );
}