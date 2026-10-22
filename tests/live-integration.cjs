/* Live integration check. Never print the FoodRadar read-only token. */
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');

const BASE = 'https://fafagoback.github.io/FoodRadar/';
const SITE = 'https://hub-google.github.io/eat-what/';
const sleepLimit = ms => AbortSignal.timeout(ms);

async function get(url) {
  const response = await fetch(url, {signal: sleepLimit(30000),cache:'no-store'});
  assert.equal(response.status, 200, 'HTTP error for ' + url + ': ' + response.status);
  return response.text();
}
async function main() {
  for (const path of ['app.js','foodradar-service.js','foodradar-packed-turso.js','foodradar-data-contract.js']) {
    assert(readFileSync(path,'utf8').length > 100, path + ' is missing');
  }
  const html = await get(SITE + '?smoke=' + Date.now());
  assert(html.includes('foodradar-service.js') === false, 'module should be imported from app.js, not separately');
  assert(html.includes('foodradar-data-contract.js'), 'live site is not latest eat-what 2.0');
  assert(html.includes('FoodRadar'), 'live homepage is missing source label');
  const remoteCode = await get(BASE + 'config.js?_v=' + Date.now());
  const parsed = remoteCode.match(/window\.UBER_RADAR_CONFIG\s*=\s*(\{[\s\S]*?\})\s*;/);
  assert(parsed, 'FoodRadar public config is not published');
  const config = JSON.parse(parsed[1]);
  assert(config.ENABLE_TURSO === true && config.TURSO_READONLY_TOKEN && config.TURSO_DATABASE_URL, 'FoodRadar is not configured for Turso');
  assert(config.SINGLE_POINT === true, 'Test expectation changed; review new FoodRadar coverage before relying on results');
  const baseUrl = config.TURSO_DATABASE_URL.replace(/\/+$/,'');
  const origin = 'https://hub-google.github.io';
  const cors = await fetch(baseUrl + '/v2/pipeline', {
    method:'OPTIONS',
    headers:{
      Origin:origin,
      'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'authorization,content-type'
    },
    signal:sleepLimit(30000)
  });
  const allowed = cors.headers.get('access-control-allow-origin') || '';
  assert(cors.ok && (allowed === '*' || allowed === origin), 'Turso CORS does not allow eat-what GitHub Pages');
  const answer = await fetch(baseUrl + '/v2/pipeline', {
    method:'POST',
    headers:{Authorization:'Bearer ' + config.TURSO_READONLY_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify({requests:[
      {type:'execute',stmt:{sql:"select store_id,store_uuid,name,rating,review_count from store_directory where status='active' and is_open=1 limit 1"}},
      {type:'close'}]}),
    signal:sleepLimit(30000)
  });
  assert.equal(answer.status, 200, 'Turso read-only query failed: ' + answer.status);
  const data = await answer.json();
  const first = data.results && data.results[0];
  assert(first && first.type !== 'error', 'Turso returned an SQL error');
  const result = first.response && first.response.result;
  assert(result && result.rows && result.rows.length > 0, 'No active FoodRadar restaurant rows');
  const names = result.cols.map(x => x.name);
  const row = Object.fromEntries(result.rows[0].map((cell,i) => [names[i],cell.value]));
  assert(row.store_uuid && row.name, 'Missing expected store fields');
  process.stdout.write('PASS: live GitHub Pages, public config, CORS, Turso read-only query, restaurant '+String(row.name).slice(0,24)+'\n');
}
main().catch(error => { console.error('FAIL:', error.message); process.exitCode=1; });
