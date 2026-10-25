# js/manager

Manager area: staff, salary, generic, credit, petty cash, attendance, payslips, reports.

## Rules
- May import `js/shared/` and core (`js/*.js`). Importing another domain must be a reviewed link in `tests/static/domain-boundaries.test.js`.
- No new `window.*` globals; no Supabase URLs/keys (use `shared/backend-config.js`); escape HTML via `shared/html.js`.

## Files
- `attendance-bridge.js` — ATTENDANCE BRIDGE  —  reads/writes attendance_events + attendance_devices
- `custom-sections.js` — SALARY — Copy to Next Month
- `manager-attendance.js` — MANAGER — ATTENDANCE  (new tab, sibling to manager-staff.js etc.)
- `manager-credit.js` — MANAGER — STAFF CREDIT LEDGER  (ES module, split from manager.js)
- `manager-export.js`
- `manager-generic.js` — MANAGER — GENERIC WORKING SHEET  (ES module, split from manager.js)
- `manager-incentive.js` — MANAGER — INCENTIVE CALCULATOR  (ES module, split from manager.js)
- `manager-page.js` — MANAGER — PAGE SHELL
- `manager-payslip.js` — MANAGER — STAFF PAYSLIP  (ES module)
- `manager-petty.js` — MANAGER — PETTY CASH  (ES module, split from manager.js)
- `manager-reports.js` — MANAGER — PRINT REPORTS  (ES module, split from manager.js)
- `manager-salary.js` — MANAGER — SALARY SHEET  (ES module, split from the old manager.js)
- `manager-shared.js` — MANAGER — SHARED  (ES module, split from the old manager.js monolith)
- `manager-staff.js` — MANAGER — STAFF REGISTRY  (ES module, split from the old manager.js)
- `manager-unmatched.js` — MANAGER — UNMATCHED TAB  (ES module, split from manager.js)
- `staff-notes.js` — STAFF NOTES  —  V2 plan §4, staff card's 3rd tab
