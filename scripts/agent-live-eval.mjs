// OPTIONAL live evaluation: how often does the REAL model pick the right tool first?
// The offline suite (tests/eval) proves routing + tool correctness; this measures the
// model itself, so run it after changing prompts, tools or providers.
//
//   GROQ_API_KEY=... node scripts/agent-live-eval.mjs            (all read cases)
//   GROQ_API_KEY=... MODEL=openai/gpt-oss-120b node scripts/agent-live-eval.mjs
//
// It sends the same routed tool list a real turn would, with a short system prompt that
// approximates the server's, and checks the model's FIRST tool call:
//   lenient  = it is one of the tools the case says must be offered
//   strict   = it is exactly the case's canonical `call.tool` (cases that have one)
// Free-tier limits apply: it paces itself. Exit code 1 if strict < 70%.
import { installDomEnv } from '../tests/helpers/dom-env.js';
installDomEnv();
globalThis.invalidateRenderCache = () => {};
const { CASES } = await import('../tests/eval/cases.js');
const reg = await import('../js/agent/core/tool-registry.js');
const { pickSpecialist } = await import('../js/agent/core/specialists.js');
for (const f of ['app', 'sales', 'manager', 'inventory', 'credit', 'briefing']) await import('../js/agent/tools/' + f + '.js');

const key = process.env.GROQ_API_KEY;
if (!key) { console.error('Set GROQ_API_KEY'); process.exit(2); }
const model = process.env.MODEL || 'openai/gpt-oss-120b';
const sys = 'You are the BT Assistant for a pharmacy app (Pakistan, Rs). Use tools for every figure; never invent data. Dates look like 05/Sep/2026, months like "September 2026". Today is 8 October 2026. Prefer one tool call.';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let lenient = 0, strict = 0, strictTotal = 0, total = 0;
for (const c of CASES.filter(x => !x.writes)) {
  const sp = pickSpecialist(c.say, null);
  const tools = reg.getToolSchemas({ includeWrites: false, domains: sp.domains });
  let name = null;
  for (let attempt = 0; attempt < 3 && name === null; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 400, tools, tool_choice: 'auto', messages: [{ role: 'system', content: sys }, { role: 'user', content: c.say }] }),
    });
    if (res.status === 429) { await sleep(8000); continue; }
    const data = await res.json();
    const m = data.choices && data.choices[0] && data.choices[0].message;
    name = m && m.tool_calls && m.tool_calls[0] ? m.tool_calls[0].function.name : '(no tool)';
  }
  total++;
  const okLenient = c.offer.includes(name) || (c.specialist === 'general' && name === '(no tool)');
  if (okLenient) lenient++;
  if (c.call) { strictTotal++; if (name === c.call.tool) strict++; }
  console.log((okLenient ? 'ok  ' : 'MISS') + '  ' + c.say.padEnd(58) + ' → ' + name + (c.call && name !== c.call.tool ? '   (wanted ' + c.call.tool + ')' : ''));
  await sleep(2500);
}
console.log('\nlenient ' + lenient + '/' + total + ' · strict ' + strict + '/' + strictTotal + ' · model ' + model);
process.exit(strictTotal && strict / strictTotal < 0.7 ? 1 : 0);
