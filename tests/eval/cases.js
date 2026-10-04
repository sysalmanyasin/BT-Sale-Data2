// Evaluation cases for the assistant. Each case says what a good run looks like:
//   say        what the owner types
//   specialist which specialist should take it (sales|manager|inventory|analyst|general)
//   domains    exact tool groups offered ([] = app tools only)
//   offer      tools that MUST be offered to the model for this question
//   writes     true if the question needs the change tools (unlocked)
//   prev       previous specialist id, for follow-up messages
//   call       a canonical tool call + the facts its result must contain (partial match)
// Every registered tool must appear in at least one `offer` list (coverage test),
// so a new tool cannot ship without an evaluation case.
const S = 'sales', M = 'manager', I = 'inventory', A = 'analyst', G = 'general';
const ALL = ['sales', 'manager', 'inventory'];

export const CASES = [
  // ── Sales ──────────────────────────────────────────────────────────
  { say: "How are today's sales?", specialist: S, domains: [S], offer: ['get_daily_sales'] },
  { say: 'Sales for 2 October 2026', specialist: S, domains: [S], offer: ['get_daily_sales'], call: { tool: 'get_daily_sales', args: { date: '2026-10-02' }, expect: { total_sale: 6000 } } },
  { say: 'Summary of September 2026', specialist: S, domains: [S], offer: ['get_sales_summary'], call: { tool: 'get_sales_summary', args: { month_year: 'September 2026' }, expect: { total_sale: 4000, diff: 100, target: 10000, days_entered: 2, customers: 20 } } },
  { say: 'Compare September with August', specialist: S, domains: [S], offer: ['compare_sales_months'], call: { tool: 'compare_sales_months', args: { month_a: 'September 2026', month_b: 'August 2026' }, expect: { difference_a_minus_b: { total_sale: { change: -7500 } } } } },
  { say: 'Best 3 days in 2022', specialist: S, domains: [S], offer: ['top_sales_days'], call: { tool: 'top_sales_days', args: { year: '2022', count: 3 }, expect: { scope: '2022', days: [{ date: '11/Jan/2022' }, { date: '09/Feb/2022' }, { date: '03/Mar/2022' }] } } },
  { say: 'Worst day in August 2026', specialist: S, domains: [S], offer: ['top_sales_days'], call: { tool: 'top_sales_days', args: { month_year: 'August 2026', order: 'lowest', count: 1 }, expect: { days: [{ total_sale: 500 }] } } },
  { say: 'Total sales in 2022', specialist: S, domains: [S], offer: ['get_year_overview'], call: { tool: 'get_year_overview', args: { year: '2022' }, expect: { year_total: 2761586 } } },
  { say: 'Which months do we have data for in 2026?', specialist: S, domains: [S], offer: ['list_sales_months'], call: { tool: 'list_sales_months', args: { year: '2026' }, expect: { count: 3 } } },
  { say: 'Are we on target this month?', specialist: S, domains: [S], offer: ['get_target_pace', 'get_sales_summary'] },
  { say: "What is our target for October 2026?", specialist: S, domains: [S], offer: ['get_sales_summary'], call: { tool: 'get_sales_summary', args: { month_year: 'October 2026' }, expect: { target: 20000 } } },
  { say: 'How many customers did we serve in September?', specialist: S, domains: [S], offer: ['get_sales_summary'] },
  { say: 'Show daily sales for August 2026', specialist: S, domains: [S], offer: ['get_daily_sales'], call: { tool: 'get_daily_sales', args: { month_year: 'August 2026' }, expect: { count: 3 } } },
  { say: 'Aaj ki bikri kitni hai', specialist: S, domains: [S], offer: ['get_daily_sales'] },
  { say: 'Add sales for yesterday: cash 150000, COMP 170000, customers 140', specialist: S, domains: [S], writes: true, offer: ['add_daily_sales_entry'] },
  { say: 'Correct the cash sale on 2 October to 12000', specialist: S, domains: [S], writes: true, offer: ['edit_daily_sales_field'] },
  { say: 'Set the sales target for November 2026 to 1.5 million', specialist: S, domains: [S], writes: true, offer: ['set_monthly_target'] },
  { say: 'Delete the sales entry for 3 August 2026', specialist: S, domains: [S], writes: true, offer: ['delete_daily_sales_entry'] },
  { say: 'What was the diff yesterday?', specialist: S, domains: [S], offer: ['get_daily_sales'] },

  // ── Staff & money ──────────────────────────────────────────────────
  { say: 'List active staff', specialist: M, domains: [M], offer: ['list_staff'], call: { tool: 'list_staff', args: {}, expect: { count: 3 } } },
  { say: 'Find staff EMP-003', specialist: M, domains: [M], offer: ['find_staff'], call: { tool: 'find_staff', args: { query: 'EMP-003' }, expect: { count: 1, matches: [{ name: 'Bilal' }] } } },
  { say: 'How much does Ali owe this month?', specialist: M, domains: [M], offer: ['get_staff_credit'], call: { tool: 'get_staff_credit', args: { staff: 'Ali Khan', month_year: 'October 2026' }, expect: { opening_balance: 2000, net_owed: 1900 } } },
  { say: 'Who has credit pending?', specialist: M, domains: [M], offer: ['get_staff_credit'], call: { tool: 'get_staff_credit', args: { month_year: 'October 2026' }, expect: { people_with_balance: 1, total_net_owed: 1900 } } },
  { say: 'What is the JazzCash balance?', specialist: M, domains: [M], offer: ['list_ledger_types'], call: { tool: 'list_ledger_types', args: {}, expect: [{ id: 'jazzcash' }] } },
  { say: 'Show the last petty cash entries', specialist: M, domains: [M], offer: ['get_ledger_entries', 'list_ledger_types'] },
  { say: 'Petty expenses in September', specialist: M, domains: [M], offer: ['get_ledger_month_totals'] },
  { say: 'Show notes about Ali Khan', specialist: M, domains: [M], offer: ['get_staff_notes'], call: { tool: 'get_staff_notes', args: { staff: 'Ali Khan' }, expect: { staff: 'Ali Khan', notes: [{}, {}] } } },
  { say: 'Add a note for Sara: arrived late today', specialist: M, domains: [M], writes: true, offer: ['add_staff_note'] },
  { say: 'Ali took Rs 800 on credit for medicine', specialist: M, domains: [M], writes: true, offer: ['add_staff_credit_entry'] },
  { say: 'Ali paid back 500', specialist: M, domains: [M], writes: true, offer: ['add_staff_credit_entry'] },
  { say: 'Add Rs 500 petty expense', specialist: M, domains: [M], writes: true, offer: ['add_ledger_entry'] },
  { say: 'Delete the last JazzCash entry', specialist: M, domains: [M], writes: true, offer: ['delete_ledger_entry', 'get_ledger_entries'] },
  { say: "Remove Ali's credit entry number 2", specialist: M, domains: [M], writes: true, offer: ['delete_staff_credit_entry', 'get_staff_credit'] },
  { say: 'Delete the note I added for Sara', specialist: M, domains: [M], writes: true, offer: ['delete_staff_note', 'get_staff_notes'] },
  { say: "What is each staff member's salary deduction?", specialist: M, domains: [M], offer: ['get_staff_credit', 'list_staff'] },
  { say: 'Mian Usman Credit detail for September 2026', specialist: M, domains: [M], offer: ['get_staff_credit'], call: { tool: 'get_staff_credit', args: { staff: 'Mian Usman', month_year: 'September 2026' }, expect: { found: true, staff: 'Mian Muhammad Usman', net_owed: 1500, entries: [{ n: 1 }, { n: 2 }] } } },
  { say: 'Credit of Waqas in September', specialist: M, domains: [M], offer: ['get_staff_credit'], call: { tool: 'get_staff_credit', args: { staff: 'waqas', month_year: 'September 2026' }, expect: { found: true, staff: 'Mian Waqas', net_owed: 300 } } },
  { say: 'Ali ka udhar kitna hai', specialist: M, domains: [M], offer: ['get_staff_credit'] },
  { say: 'Who is Ali Khan?', specialist: G, domains: ALL, offer: ['find_staff', 'search_inventory'] },

  // ── Inventory ──────────────────────────────────────────────────────
  { say: 'Inventory overview', specialist: I, domains: [I], offer: ['inventory_overview'], call: { tool: 'inventory_overview', args: {}, expect: { products: 5, zero_stock: 1 } } },
  { say: 'Do we have Panadol in stock?', specialist: I, domains: [I], offer: ['search_inventory'], call: { tool: 'search_inventory', args: { query: 'Panadol' }, expect: { count: 1, products: [{ name: 'Panadol', qty: 3 }] } } },
  { say: 'What is low on stock?', specialist: I, domains: [I], offer: ['low_stock_items'], call: { tool: 'low_stock_items', args: { max_qty: 5 }, expect: { matching: 2 } } },
  { say: 'What should I reorder?', specialist: I, domains: [I], offer: ['low_cover_items'], call: { tool: 'low_cover_items', args: { max_days: 5 }, expect: { items: [{ name: 'Gone Item' }] } } },
  { say: 'Show me dead stock', specialist: I, domains: [I], offer: ['slow_moving_stock'], call: { tool: 'slow_moving_stock', args: { days: 90 }, expect: { items: [{ name: 'Old Syrup' }], total_value: 4000 } } },
  { say: 'Which items are slow moving?', specialist: I, domains: [I], offer: ['slow_moving_stock'] },
  { say: 'Stock cover for Panadol', specialist: I, domains: [I], offer: ['search_inventory'] },
  { say: 'How many products are out of stock?', specialist: I, domains: [I], offer: ['inventory_overview'] },
  { say: 'What is the stock value?', specialist: I, domains: [I], offer: ['inventory_overview'] },
  { say: 'Stock kitna hai Panadol ka', specialist: I, domains: [I], offer: ['search_inventory'] },
  { say: 'Search paracetamol', specialist: G, domains: ALL, offer: ['search_inventory'] },

  // ── App / briefing / small talk ────────────────────────────────────
  { say: 'What needs my attention today?', specialist: G, domains: [], offer: ['daily_briefing'] },
  { say: 'Give me the morning briefing', specialist: G, domains: [], offer: ['daily_briefing'] },
  { say: 'Anything I should know?', specialist: G, domains: [], offer: ['daily_briefing'] },
  { say: 'Open the ledger page', specialist: G, domains: [], offer: ['navigate_to', 'list_pages'] },
  { say: 'What pages can you open?', specialist: G, domains: [], offer: ['list_pages'] },
  { say: "What is today's date?", specialist: G, domains: [], offer: ['get_app_context'] },
  { say: 'Hello', specialist: G, domains: ALL, offer: ['get_app_context'] },

  // ── Cross-domain: the Analyst ──────────────────────────────────────
  { say: 'Compare September sales with staff credit', specialist: A, domains: [S, M], offer: ['get_sales_summary', 'get_staff_credit'] },
  { say: "Do we have enough stock for this month's sales target?", specialist: A, domains: [S, I], offer: ['get_target_pace', 'low_cover_items'] },
  { say: 'Sales and inventory overview', specialist: A, domains: [S, I], offer: ['get_sales_summary', 'inventory_overview'] },
  { say: 'Staff credit versus cash sales this month', specialist: A, domains: [M, S], offer: ['get_staff_credit', 'get_sales_summary'] },
  { say: 'How much did Ali owe and what were sales on 2 Oct?', specialist: A, domains: [M, S], offer: ['get_staff_credit', 'get_daily_sales'] },

  // ── Follow-ups keep the previous specialist ────────────────────────
  { say: 'ok list them', prev: S, specialist: S, domains: [S], offer: ['top_sales_days'] },
  { say: 'yes do it', prev: M, specialist: M, domains: [M], offer: ['get_staff_credit'] },
  { say: 'In 2022', prev: S, specialist: S, domains: [S], offer: ['top_sales_days'] },
  { say: 'and the next one?', prev: I, specialist: I, domains: [I], offer: ['low_cover_items'] },
];
