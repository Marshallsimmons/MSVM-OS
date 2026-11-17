/**
 * MSVM Financial Command Center — Google Apps Script
 * Version 1.2 — aggregate-only secure MSVM-OS sync
 *
 * Install: Extensions > Apps Script; paste this file; Save; run setupMSVM.
 * Configure Script Properties MSVM_SYNC_ENDPOINT and MSVM_SYNC_SECRET
 * before running syncMSVMFinanceSummary.
 * This script never connects to banks, sends payments, or moves money.
 */
const MSVM = {
  SHEETS: { transactions: 'Transactions', allocations: 'Allocations', dashboard: 'Dashboard', reports: 'Daily Reports' },
  FIRST_DATA_ROW: 5,
  LAST_DATA_ROW: 1004
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MSVM')
    .addItem('Run setup / validate workbook', 'setupMSVM')
    .addItem('Create daily closeout report now', 'createDailyCloseout')
    .addItem('Install 8:30 PM daily closeout trigger', 'installDailyCloseoutTrigger')
    .addSeparator()
    .addItem('Sync financial summary to MSVM-OS now', 'syncMSVMFinanceSummary')
    .addItem('Install 15-minute finance sync', 'installFinanceSummarySyncTrigger')
    .addItem('Remove finance sync trigger', 'removeFinanceSummarySyncTrigger')
    .addToUi();
}

function setupMSVM() {
  const ss = SpreadsheetApp.getActive();
  const required = Object.values(MSVM.SHEETS);
  const missing = required.filter(name => !ss.getSheetByName(name));
  if (missing.length) throw new Error('Missing required sheets: ' + missing.join(', '));
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  const tx = ss.getSheetByName(MSVM.SHEETS.transactions);
  const al = ss.getSheetByName(MSVM.SHEETS.allocations);
  tx.getRange('C5:C1004').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Income','Expense'], true).setAllowInvalid(false).build());
  tx.getRange('H5:H1004').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pending','Cleared','Void'], true).setAllowInvalid(false).build());
  al.getRange('G5:G1004').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Reserved','Spent','Released'], true).setAllowInvalid(false).build());
  SpreadsheetApp.flush();
  return 'MSVM setup complete.';
}

function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet(), row = e.range.getRow();
  if (row < MSVM.FIRST_DATA_ROW || row > MSVM.LAST_DATA_ROW) return;
  if (sh.getName() === MSVM.SHEETS.transactions) {
    const idCell = sh.getRange(row, 1);
    if (!idCell.getValue() && [2,3,6].some(col => sh.getRange(row,col).getValue())) idCell.setValue('TX-' + Utilities.getUuid().slice(0,8).toUpperCase());
  } else if (sh.getName() === MSVM.SHEETS.allocations) {
    const idCell = sh.getRange(row, 1);
    if (!idCell.getValue() && [2,5].some(col => sh.getRange(row,col).getValue())) idCell.setValue('AL-' + Utilities.getUuid().slice(0,8).toUpperCase());
  }
}

function createDailyCloseout() {
  const ss = SpreadsheetApp.getActive(), dash = ss.getSheetByName(MSVM.SHEETS.dashboard), report = ss.getSheetByName(MSVM.SHEETS.reports);
  if (!dash || !report) throw new Error('Dashboard or Daily Reports sheet is missing.');
  SpreadsheetApp.flush();
  const now = new Date(), cash = Number(dash.getRange('B5').getValue()) || 0, reserved = Number(dash.getRange('B6').getValue()) || 0, available = Number(dash.getRange('B7').getValue()) || 0;
  const tx = ss.getSheetByName(MSVM.SHEETS.transactions), values = tx.getRange(5,2,1000,7).getValues();
  const todayKey = Utilities.formatDate(now,ss.getSpreadsheetTimeZone(),'yyyy-MM-dd');
  let incomeToday=0, expensesToday=0;
  values.forEach(r => {
    const date=r[0], type=r[1], amount=Number(r[4])||0, status=r[6];
    if(date instanceof Date && Utilities.formatDate(date,ss.getSpreadsheetTimeZone(),'yyyy-MM-dd')===todayKey && status==='Cleared') {
      if(type==='Income') incomeToday+=amount;
      if(type==='Expense') expensesToday+=amount;
    }
  });
  report.appendRow([now,cash,reserved,available,incomeToday,expensesToday,'Automated snapshot. Verify against actual account records.']);
  return {cash,reserved,available,incomeToday,expensesToday};
}

function installDailyCloseoutTrigger() {
  ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==='createDailyCloseout')ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('createDailyCloseout').timeBased().everyDays(1).atHour(20).nearMinute(30).create();
  return 'Daily closeout trigger installed.';
}

/** Transmits only ten aggregate dashboard values; never sends transaction-level data. */
function syncMSVMFinanceSummary() {
  const props=PropertiesService.getScriptProperties(), endpoint=props.getProperty('MSVM_SYNC_ENDPOINT'), secret=props.getProperty('MSVM_SYNC_SECRET');
  if(!endpoint || !secret) throw new Error('Set MSVM_SYNC_ENDPOINT and MSVM_SYNC_SECRET in Project Settings > Script Properties first.');
  const ss=SpreadsheetApp.getActive(), dash=ss.getSheetByName(MSVM.SHEETS.dashboard);
  if(!dash) throw new Error('Dashboard sheet is missing.');
  SpreadsheetApp.flush();
  const payload={
    cash_balance:Number(dash.getRange('B5').getValue())||0,
    reserved_funds:Number(dash.getRange('B6').getValue())||0,
    available_cash:Number(dash.getRange('B7').getValue())||0,
    cleared_income:Number(dash.getRange('B8').getValue())||0,
    cleared_expenses:Number(dash.getRange('B9').getValue())||0,
    net_cash_movement:Number(dash.getRange('B10').getValue())||0,
    pending_transaction_count:Number(dash.getRange('F7').getValue())||0,
    overdue_bill_count:Number(dash.getRange('F8').getValue())||0,
    total_debt:Number(dash.getRange('F9').getValue())||0,
    savings_goal_remaining:Number(dash.getRange('F10').getValue())||0
  };
  const response=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',headers:{'x-msvm-sync-secret':secret},payload:JSON.stringify(payload),muteHttpExceptions:true});
  const code=response.getResponseCode();
  if(code<200 || code>=300) throw new Error('MSVM sync failed ('+code+'): '+response.getContentText());
  const result=JSON.parse(response.getContentText());
  Logger.log('MSVM finance summary synced: '+JSON.stringify(result));
  return result;
}

function installFinanceSummarySyncTrigger() {
  removeFinanceSummarySyncTrigger();
  ScriptApp.newTrigger('syncMSVMFinanceSummary').timeBased().everyMinutes(15).create();
  return 'Finance summary sync trigger installed (every 15 minutes).';
}

function removeFinanceSummarySyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==='syncMSVMFinanceSummary')ScriptApp.deleteTrigger(t);});
  return 'Finance summary sync trigger removed.';
}
