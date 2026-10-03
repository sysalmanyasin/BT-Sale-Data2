// App-level tools: context + navigation (UI only, changes no data).
import { registerTool } from '../core/tool-registry.js';
import { MON, currentMonthYear } from './_util.js';

const pageIds = () => [...document.querySelectorAll('.page')].map(p => p.id.replace(/^page-/, '')).filter(Boolean);
const currentPage = () => { const el = document.querySelector('.page.on'); return el ? el.id.replace(/^page-/, '') : null; };

export function getPageContext() {
  const d = new Date();
  return {
    today: String(d.getDate()).padStart(2, '0') + '/' + MON[d.getMonth()] + '/' + d.getFullYear(),
    weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()],
    current_month: currentMonthYear(d),
    current_page: currentPage(),
  };
}

registerTool({
  name: 'get_app_context', domain: 'app', risk: 'read',
  description: "Today's date, weekday, current month and which page the user is looking at.",
  parameters: { type: 'object', properties: {} },
  run: () => getPageContext(),
});

registerTool({
  name: 'list_pages', domain: 'app', risk: 'read',
  description: 'List page ids that navigate_to can open.',
  parameters: { type: 'object', properties: {} },
  run: () => ({ pages: pageIds() }),
});

registerTool({
  name: 'navigate_to', domain: 'app', risk: 'ui',
  description: 'Open an app page for the user (e.g. "dashboard", "ledger", "inventory"). Use list_pages for valid ids. Does not change any data.',
  parameters: { type: 'object', required: ['page'], properties: { page: { type: 'string' } } },
  run: ({ page }) => {
    const id = String(page).toLowerCase().trim();
    if (!pageIds().includes(id)) return { error: 'Unknown page "' + page + '"', valid: pageIds() };
    if (window.Actions && typeof window.Actions.navigate === 'function') window.Actions.navigate(id);
    return { opened: id };
  },
});
