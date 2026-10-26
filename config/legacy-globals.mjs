// LEGACY GLOBAL REGISTRY: the complete, explicit list of names the app still reads as implicit globals.
// ESLint `no-undef` is an ERROR, so any name NOT listed here fails CI. This file may only SHRINK:
// tests/static/legacy-globals.test.js enforces a ratchet (LEGACY_GLOBAL_BUDGET). To retire a name,
// import it explicitly (or delete the dead call), remove it here, and lower the budget in the test.

export const LEGACY_GROUPS = {
  "defined in js/platform/drive.js, which exposes it only via window (add an export and import it to retire)": [
    '_driveAccessToken', '_driveSaveToken', '_driveUpdateBadge', 'driveLog',
  ],
  "defined in js/manager/manager-export.js, which exposes it only via window (add an export and import it to retire)": [
    'months',
  ],
  "defined in js/sales/dashboard-heatmap.js, which exposes it only via window (add an export and import it to retire)": [
    'buildSalesHeatmap',
  ],
  "defined in js/sheets/sheets-api.js, which exposes it only via window (add an export and import it to retire)": [
    'sheetsCreate', 'sheetsDeleteTab', 'sheetsGetAllValues', 'sheetsGetFileInfo', 'sheetsGetMeta', 'sheetsTrash',
    'sheetsWriteTab',
  ],
  "defined in js/sheets/sheets-patch.js, which exposes it only via window (add an export and import it to retire)": [
    'shtFmSave',
  ],
  "defined in js/sheets/sheets-picker.js, which exposes it only via window (add an export and import it to retire)": [
    'sheetsOpenPicker',
  ],
  "defined in js/sheets/sheets-sync.js, which exposes it only via window (add an export and import it to retire)": [
    'sbCacheGet', 'sbCacheWrite', 'sbPushDelete', 'sbPushHistoryAll', 'sbPushRecord', 'sbSheetsClearOrphaned',
    'sbSheetsGetTemplate', 'sbSheetsInsert', 'sbSheetsList', 'sbSheetsMarkOrphaned', 'sbSheetsSetPinned', 'sbSheetsSetTemplate',
    'sbSheetsSoftDelete', 'sbSheetsTouch', 'sbSheetsUnsetTemplate',
  ],
  "defined in js/platform/storage.js, which exposes it only via window (add an export and import it to retire)": [
    '_curPage', '_rc', '_rcKey', 'idbLoadData', 'idbSaveData', 'invalidateRenderCache',
  ],
  "defined in js/ui/ui-extras.js, which exposes it only via window (add an export and import it to retire)": [
    'showPage',
  ],
  "defined in js/ui/ui.js, which exposes it only via window (add an export and import it to retire)": [
    'rebuildAll', 'rebuildDropdowns', 'toast', 'updateGhBadge',
  ],
  "dead optional hooks (typeof-guarded calls to functions defined nowhere; delete the call sites)": [
    '_csecLoad', '_selDate', '_selMy', 'addNewSheet', 'aimBriefingGenerate', 'aimBuildAssistantPayload',
    'aimMergeAssistantIncoming', 'aimSectionZeroAlerts', 'downloadSheetXLSX', 'exportSheetXLSX', 'nsExportXLSX', 'nsNewSheet',
    'nsSaveAll', 'nsSetCellValue', 'saveAllSheets', 'saveSheetData', 'setCellValue', 'sheetNew',
    'sheetSetCell',
  ],
  "module-defined, exposed through window bridges (core->domain coupling; invert via event-bus or shared/)": [
    // Not importable: each of these files is also an index.html entry, so an import would load it twice.
    'initStaffPayslipTab', 'initSyncCenter', 'scCanWrite',
    '_fmCustom',
    'Actions', 'Analytics', 'AttendanceUI', 'CSEC_KEY', 'DAILY', 'EventBus',
    'JC_KEY', 'JC_TALLY_KEY', 'L', 'LEDGER_CUSTOM_TYPES_KEY', 'LEDGER_KEY', 'LedgerStore',
    'MGR_KEY', 'MONTHLY', 'Print', 'Repository', 'STAFF', '_clearPending',
    '_curMon', '_dateVal', '_driveSilentReauth', '_fc2', '_gauthOAuthSignIn', '_hasPending',
    '_jcCurrentBalance', '_nsOpenNote', '_nsSetPanel', '_pettyTotalForMonth', '_populatePrintSelectors', '_printDay',
    '_saLinkExisting', '_sb', '_sbGetChannel', '_scDeviceName', '_scGetUDID', '_sc_channel',
    '_sc_getUDID', '_sc_startSessionRealtime', '_sc_tryReclaimIfUncontested', '_tcLoadGAuthStatus', 'activeStaff', 'aimRulesCheckAll',
    'autoFillEntryDate', 'buildBarRace', 'buildDashboard', 'buildDashboardInsights', 'buildDateList', 'buildPrintHTML',
    'buildRaceForecast', 'calcTotal', 'cdrInit', 'clnSwitchMode', 'closeDay', 'closeMon',
    'closeSectionsDrawer', 'dsInit', 'fc', 'ff', 'fmLoad', 'ghCfg',
    'hideStatusBar', 'initApp', 'latestManagerMonth', 'loadManagerPage', 'manualSync', 'mgrLoad',
    'n', 'normalizeDates', 'openDayModal', 'openStaffCard', 'populateDashWorking', 'pullFromSupabase',
    'pushToSupabase', 'recomputeAllMonths', 'refreshManagerPage', 'refreshStatusBar', 'renderCoverDashboard', 'renderDataTable',
    'renderDiffReport', 'renderEntryList', 'renderIndex', 'renderJazzCash', 'renderLedgerView', 'renderMiscSectionsManager',
    'renderNotesSheets', 'renderReport', 'renderStaffNotesPanel', 'renderStaffRegistry', 'renderTargetList', 'resetSupabaseSync',
    'scSwitchTab', 'sheetsAppBuild', 'sheetsPushRows', 'showStatusBar', 'staffNotesKeyFor', 'startAutoInterval',
    'startSupabaseSync', 'switchMgrTab', 'toggleTcard', 'years',
  ],
  "third-party libraries (CDN script tags)": [
    'Chart', 'XLSX', 'google', 'qrcode', 'supabase',
  ],
};

export const LEGACY_GLOBALS = Object.fromEntries(
  Object.values(LEGACY_GROUPS).flat().map((n) => [n, 'writable']),
);
