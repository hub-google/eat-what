import {boot, stores, menu, priceIndex} from './foodradar-service.js';

const $ = id => document.getElementById(id);
const PAGE_SIZE = 24;
const state = {
  meta: null, all: [], filtered: [], location: null,
  priceSummaries: new Map(), menus: new Map(), activeStore: null,
  menuVisible: 120, menuQuery: '', visible: PAGE_SIZE,
  revision: 0, loading: false
};
const numberFormat = new Intl.NumberFormat('zh-TW', {maximumFractionDigits: 2});
const clean = text => String(text == null ? '' : text).trim();
function safe(text) {
  return clean(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? '$' + numberFormat.format(n) : '價格未提供';
}
function formatTime(value) {
  if (!value) return '時間未提供';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return clean(value).replace('T', ' ').slice(0, 16);
  return d.toLocaleString('zh-TW', {timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function validCoords(s) {
  const lat = Number(s.latitude), lon = Number(s.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
}
function mapLink(s) {
  const q = validCoords(s) ? Number(s.latitude) + ',' + Number(s.longitude) : clean(s.name) + ' ' + clean(s.address);
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}
function orderLink(s) {
  try {
    const u = new URL(s.order_action_url || s.order_url);
    return u.protocol === 'https:' && (u.hostname === 'ubereats.com' || u.hostname.endsWith('.ubereats.com')) ? u.href : '';
  } catch (_) { return ''; }
}
function storeKey(s) { return clean(s.store_uuid || s.store_id); }
function ratingText(s) {
  const n = Number(s.rating_value ?? s.rating);
  return n > 0 && Number.isFinite(n) ? n.toFixed(1) : '';
}
function reviewCount(s) {
  const n = Number(s.review_count);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function setNotice(message, error = false) {
  const el = $('statusTitle');
  el.textContent = message || '';
  el.classList.toggle('error', error);
  el.hidden = !message;
}
function busy(value) {
  state.loading = value;
  $('shuffleBtn').disabled = value || !state.filtered.length;
  $('locateBtn').disabled = value;
  $('showAllBtn').disabled = value;
}
function locationParams() {
  if (!state.location) return null;
  return {...state.location, radiusKm: Number($('radiusFilter').value), enabled: true};
}
function locationLabel() {
  return state.location ? '你的位置附近 ' + $('radiusFilter').value + ' 公里' : 'FoodRadar 已收錄地區（目前為部分區域）';
}
function productDrop(p) {
  return Number(p.is_price_drop) === 1 && Number(p.price_change_amount) < 0;
}
function showPrice(p) {
  const value = Number(p.eff_price || p.effective_price || p.price);
  return money(value);
}
function cardMarkup(s) {
  const uuid = storeKey(s);
  const rating = ratingText(s);
  const count = reviewCount(s);
  const summary = state.priceSummaries.get(uuid);
  const addr = clean(s.street_address || s.address || s.locality || s.city) || '地址未提供';
  const parts = [];
  if (rating) parts.push('<span class="tag rating">★ ' + safe(rating) + (count ? ' · ' + numberFormat.format(count) + ' 則' : '') + '</span>');
  else parts.push('<span class="tag weak">尚無評分</span>');
  if (state.location && Number.isFinite(Number(s.distance_km))) {
    const m = Number(s.distance_km) * 1000;
    parts.push('<span class="tag">' + (m < 1000 ? Math.round(m) + ' m' : Number(s.distance_km).toFixed(1) + ' km') + '</span>');
  } else if (s.city || s.locality) {
    parts.push('<span class="tag">' + safe(s.locality || s.city) + '</span>');
  }
  if (summary && summary.dropCount) parts.push('<span class="tag deal">' + summary.dropCount + ' 項降價</span>');
  let preview = '<span>點開查看菜單與價格</span>';
  if (summary && Number.isFinite(summary.minPrice)) preview = '<span>已收錄餐點最低實質單價</span><b>' + money(summary.minPrice) + '</b>';
  const uber = orderLink(s);
  return '<article class="restaurant-card" data-card-id="' + safe(uuid) + '">' +
    '<div class="card-top"><div class="card-icon" aria-hidden="true">食</div>' +
      '<div class="card-heading"><h3>' + safe(s.name || '未命名餐廳') + '</h3><p class="card-address" title="' + safe(addr) + '">' + safe(addr) + '</p></div></div>' +
    '<div class="card-meta">' + parts.join('') + '</div>' +
    '<div class="card-price">' + preview + '</div>' +
    '<div class="card-actions"><button type="button" class="card-btn" data-action="details" data-id="' + safe(uuid) + '">查看菜單</button>' +
    '<a class="card-link" href="' + safe(mapLink(s)) + '" target="_blank" rel="noopener noreferrer">導航 ↗</a>' +
    (uber ? '<a class="card-link" href="' + safe(uber) + '" target="_blank" rel="noopener noreferrer">Uber ↗</a>' : '') +
    '</div></article>';
}
function renderCards() {
  const visible = state.filtered.slice(0, state.visible);
  $('results').innerHTML = visible.map(cardMarkup).join('');
  $('resultCount').textContent = numberFormat.format(state.filtered.length);
  $('resultsTitle').firstChild.textContent = '已收錄餐廳 ';
  $('statusDetail').textContent = locationLabel() + ' · 依目前篩選條件顯示';
  $('loadMoreBtn').hidden = state.visible >= state.filtered.length;
  $('shuffleBtn').disabled = state.loading || !state.filtered.length;
  if (!state.filtered.length && !state.loading) {
    setNotice(state.location
      ? '這個位置和篩選條件下沒有 FoodRadar 已收錄的餐廳。你可以調大範圍或選擇「瀏覽已收錄餐廳」。'
      : '目前沒有符合條件的餐廳，請調整搜尋與篩選條件。');
  } else if (!state.loading) {
    setNotice('');
  }
}
function sortRestaurants(a, b, type) {
  if (type === 'distance') {
    const ad = Number(a.distance_km), bd = Number(b.distance_km);
    const aa = Number.isFinite(ad) ? ad : Infinity;
    const bb = Number.isFinite(bd) ? bd : Infinity;
    if (aa !== bb) return aa - bb;
  }
  if (type === 'reviews') return reviewCount(b) - reviewCount(a) || (Number(ratingText(b)) - Number(ratingText(a)));
  if (type === 'name') return clean(a.name).localeCompare(clean(b.name), 'zh-Hant');
  return Number(ratingText(b)) - Number(ratingText(a)) ||
    reviewCount(b) - reviewCount(a) || clean(a.name).localeCompare(clean(b.name), 'zh-Hant');
}
async function applyFilters() {
  const revision = ++state.revision;
  if (!state.meta) return;
  busy(true);
  const search = clean($('searchInput').value).toLocaleLowerCase('zh-TW');
  const minRating = Number($('ratingFilter').value);
  const budget = Number($('budgetFilter').value);
  const dealOnly = $('onlyDeals').checked;
  const location = locationParams();
  setNotice(budget || dealOnly ? '正在讀取 FoodRadar 菜單並套用價格條件...' : '搜尋 FoodRadar 已收錄的餐廳...');
  $('recommendationBanner').hidden = true;
  try {
    let list = location ? await stores(location) : state.all;
    if (revision !== state.revision) return;
    if (budget || dealOnly) {
      state.priceSummaries = await priceIndex(location);
      if (revision !== state.revision) return;
    }
    list = list.filter(s => {
      if (search && ![s.name,s.street_address,s.address,s.city,s.locality].some(v => clean(v).toLocaleLowerCase('zh-TW').includes(search))) return false;
      if (minRating && Number(ratingText(s)) < minRating) return false;
      if (budget || dealOnly) {
        const summary = state.priceSummaries.get(storeKey(s));
        if (!summary) return false;
        if (budget && summary.minPrice > budget) return false;
        if (dealOnly && !summary.dropCount) return false;
      }
      return true;
    });
    list = [...list].sort((a,b) => sortRestaurants(a,b,$('sortFilter').value));
    if (revision !== state.revision) return;
    state.filtered = list;
    state.visible = PAGE_SIZE;
    busy(false);
    renderCards();
  } catch (error) {
    if (revision !== state.revision) return;
    busy(false);
    setNotice('FoodRadar 查詢失敗：' + (error && error.message ? error.message : '請稍後重試'), true);
    $('statusDetail').textContent = '查詢未完成，並非代表餐廳不存在';
    $('shuffleBtn').disabled = true;
  }
}
let delay;
function queueFilters() {
  clearTimeout(delay);
  delay = setTimeout(applyFilters, 180);
}
function getStore(uuid) {
  return state.all.find(s => storeKey(s) === uuid) || state.filtered.find(s => storeKey(s) === uuid);
}
function menuItemMarkup(p) {
  const dropped = productDrop(p);
  const promotion = clean(p.promo_type);
  const previous = Number(p.reference_price);
  const discountText = dropped && previous > 0
    ? '<small class="drop">上次 ' + money(previous) + ' → 本次降價</small>' : '';
  const description = clean(p.description);
  return '<div class="menu-item"><div><div class="menu-item-name">' + safe(p.product_name || '餐點') + '</div>' +
    (description ? '<p class="menu-description">' + safe(description.slice(0,180)) + '</p>' : '') +
    (promotion && promotion !== '無' ? '<span class="tag deal">' + safe(promotion) + '</span>' : '') +
    '</div><div class="menu-price">' + safe(showPrice(p)) + '<small>實質單價</small>' + discountText + '</div></div>';
}
function renderMenuItems() {
  const el = $('menuItems');
  if (!el) return;
  const key = state.activeStore;
  const products = state.menus.get(key) || [];
  const q = state.menuQuery.toLocaleLowerCase('zh-TW');
  const matched = products.filter(p => !q ||
    clean(p.product_name).toLocaleLowerCase('zh-TW').includes(q) ||
    clean(p.category_name).toLocaleLowerCase('zh-TW').includes(q));
  const page = matched.slice(0, state.menuVisible);
  el.innerHTML = page.map(menuItemMarkup).join('') ||
    '<div class="menu-empty">沒有符合搜尋條件的餐點。</div>';
  const more = $('moreMenuBtn');
  if (more) {
    more.hidden = matched.length <= state.menuVisible;
    more.textContent = '顯示更多餐點（還有 ' + (matched.length - state.menuVisible) + ' 項）';
  }
  const count = $('menuCount');
  if (count) count.textContent = '已收錄 ' + products.length + ' 項，符合搜尋 ' + matched.length + ' 項';
}
function modalMarkup(s) {
  const r = ratingText(s);
  const score = r ? '★ ' + r + ' (' + reviewCount(s) + ' 則)' : '尚無評分';
  const addr = clean(s.street_address || s.address || s.locality || s.city);
  const link = orderLink(s);
  return '<div class="detail-stats"><span class="detail-label">' + safe(score) + '</span>' +
    (addr ? '<span class="detail-label">' + safe(addr) + '</span>' : '') +
    '<span class="detail-label">上次收錄 ' + safe(formatTime(s.last_seen)) + '</span></div>' +
    '<div class="detail-actions"><a href="' + safe(mapLink(s)) + '" target="_blank" rel="noopener noreferrer">Google Maps 導航 ↗</a>' +
    (link ? '<a href="' + safe(link) + '" target="_blank" rel="noopener noreferrer">開啟 Uber Eats ↗</a>' : '') + '</div>' +
    '<h3 class="menu-title">FoodRadar 菜單與價格</h3>' +
    '<p class="menu-hint">以 FoodRadar 最近有效採集結果為準；外送價格可能不同於店內價格，亦不含相關外送費。</p>' +
    '<div id="menuView"><div class="menu-empty">菜單載入中...</div></div>';
}
async function openDetails(uuid) {
  const s = getStore(uuid);
  if (!s) return;
  state.activeStore = uuid;
  state.menuVisible = 120;
  state.menuQuery = '';
  $('modalTitle').textContent = s.name || '餐廳資訊';
  $('modalSub').textContent = 'Uber Eats / FoodRadar · ' + (s.locality || s.city || '已收錄店家');
  $('modalBody').innerHTML = modalMarkup(s);
  $('modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('modalClose').focus();
  try {
    const products = await menu(uuid);
    if (state.activeStore !== uuid) return;
    state.menus.set(uuid, products);
    if (products.length) {
      const minPrice = Math.min(...products.map(p => Number(p.eff_price)).filter(v => Number.isFinite(v) && v > 0));
      const dropCount = products.filter(productDrop).length;
      state.priceSummaries.set(uuid, {minPrice, dropCount, productCount: products.length});
      if (state.filtered.length && !(Number($('budgetFilter').value) || $('onlyDeals').checked)) renderCards();
      $('menuView').innerHTML =
        '<input id="menuSearch" class="menu-search" type="search" placeholder="搜尋餐點名稱或類別..." aria-label="搜尋這家店的餐點">' +
        '<p class="menu-hint" id="menuCount"></p><div id="menuItems" class="menu-list"></div>' +
        '<button type="button" id="moreMenuBtn" class="outline-btn" hidden>顯示更多餐點</button>' +
        '<p class="note">餐點降價依 FoodRadar 已記錄的本次與上次有效實質單價比較。</p>';
      $('menuSearch').addEventListener('input', e => {
        state.menuQuery = clean(e.target.value);
        state.menuVisible = 120;
        renderMenuItems();
      });
      $('moreMenuBtn').addEventListener('click', () => {
        state.menuVisible += 120;
        renderMenuItems();
      });
      renderMenuItems();
    } else {
      $('menuView').innerHTML = '<div class="menu-empty">這家店目前沒有 FoodRadar 可提供的有效菜單品項。</div>';
    }
  } catch (error) {
    if (state.activeStore === uuid) $('menuView').innerHTML =
      '<div class="menu-empty">菜單讀取失敗：' + safe(error.message || '未知錯誤') + '。請稍後重新開啟。</div>';
  }
}
function closeDetails() {
  state.activeStore = null;
  $('modal').hidden = true;
  document.body.style.overflow = '';
}
function locate() {
  if (!navigator.geolocation) return setNotice('這個瀏覽器不支援定位，仍可瀏覽 FoodRadar 已收錄的餐廳。', true);
  busy(true);
  setNotice('正在取得你的 GPS 位置...');
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.location = {latitude: pos.coords.latitude, longitude: pos.coords.longitude, enabled: true};
      $('sortFilter').value = 'distance';
      busy(false);
      applyFilters();
    },
    error => {
      busy(false);
      setNotice('定位未成功（' + (error.message || '未授權') + '）。仍可直接瀏覽已收錄的餐廳。', true);
    },
    {enableHighAccuracy:false,timeout:12000,maximumAge:300000}
  );
}
function showAll() {
  state.location = null;
  $('sortFilter').value = 'rating';
  applyFilters();
}
function resetFilters() {
  $('searchInput').value = '';
  $('radiusFilter').value = '1';
  $('ratingFilter').value = '0';
  $('budgetFilter').value = '0';
  $('onlyDeals').checked = false;
  $('sortFilter').value = state.location ? 'distance' : 'rating';
  applyFilters();
}
function randomPick() {
  if (!state.filtered.length) return;
  const chosen = state.filtered[Math.floor(Math.random() * state.filtered.length)];
  $('recommendationBanner').hidden = false;
  $('recommendationBanner').textContent = '這次幫你抽到：' + clean(chosen.name) + '。正在打開它的菜單！';
  openDetails(storeKey(chosen));
}
async function init() {
  busy(true);
  setNotice('正在連接 FoodRadar Turso 資料庫...');
  try {
    state.meta = await boot();
    state.all = (await stores()).filter(s => storeKey(s) && clean(s.name));
    $('dataFreshness').textContent = 'FoodRadar 最新成功採集：' +
      formatTime(state.meta.latest_processed_at) + ' · 目前僅包含已採集地區';
    busy(false);
    await applyFilters();
  } catch (error) {
    busy(false);
    $('dataFreshness').textContent = 'FoodRadar 連線尚未完成';
    $('results').innerHTML = '';
    $('resultCount').textContent = '—';
    $('statusDetail').textContent = '無法取得資料，請確認 FoodRadar GitHub Pages 與 Turso 已正常發布';
    setNotice('無法載入 FoodRadar：' + (error.message || '未知錯誤') + '。請點選右上角重新整理重試。', true);
  }
}
function wire() {
  $('locateBtn').addEventListener('click', locate);
  $('showAllBtn').addEventListener('click', showAll);
  $('refreshBtn').addEventListener('click', () => location.reload());
  $('clearBtn').addEventListener('click', resetFilters);
  $('shuffleBtn').addEventListener('click', randomPick);
  $('loadMoreBtn').addEventListener('click', () => { state.visible += PAGE_SIZE; renderCards(); });
  for (const id of ['searchInput','ratingFilter','budgetFilter','onlyDeals','sortFilter','radiusFilter']) {
    $(id).addEventListener(id === 'searchInput' ? 'input' : 'change', queueFilters);
  }
  $('results').addEventListener('click', event => {
    const button = event.target.closest('[data-action="details"]');
    if (button) openDetails(button.dataset.id);
  });
  $('modalClose').addEventListener('click', closeDetails);
  $('modal').addEventListener('click', event => {
    if (event.target.closest('[data-close="true"]')) closeDetails();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('modal').hidden) closeDetails();
  });
}
wire();
init();
