import test from 'node:test';
import assert from 'node:assert/strict';
import { topMoneyFindings, deterministicFallback } from '../../js/ai-center/manager-intelligence.js';
test('money ranking',()=>assert.deepEqual(topMoneyFindings([{title:'A',money_impact:100},{title:'B',money_impact:900},{title:'C',money_impact:500}],2).map(x=>x.title),['B','C']));
test('deterministic inventory fallback',()=>assert.match(deterministicFallback('inventory stock risk',{raw:{briefing:{inventory:{money_ranked_top10:[{name:'Item A',estimated_lost_sales_7d:12000}]}}}}),/Item A.*12,000/s));