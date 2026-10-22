/* eat-what: FoodRadar read-only integration. No separate crawler or database. */
import {metadata, directory, getStoresInLocation, productsForStore, searchPacked} from './foodradar-packed-turso.js';

const PUBLIC_CONFIG_URL = 'https://fafagoback.github.io/FoodRadar/config.js';
let initialized = false;
let bootPromise = null;
let allStores = null;
const menuCache = new Map();
const indexCache = new Map();

function loadPublicConfig() {
  if (window.UBER_RADAR_CONFIG && window.UBER_RADAR_CONFIG.TURSO_DATABASE_URL && window.UBER_RADAR_CONFIG.TURSO_READONLY_TOKEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PUBLIC_CONFIG_URL + '?_v=' + Date.now();
    script.async = true;
    script.onload = () => window.UBER_RADAR_CONFIG && window.UBER_RADAR_CONFIG.TURSO_DATABASE_URL && window.UBER_RADAR_CONFIG.TURSO_READONLY_TOKEN
      ? resolve() : reject(new Error('FoodRadar 尚未發布可使用的唯讀資料庫設定。'));
    script.onerror = () => reject(new Error('無法讀取 FoodRadar 公開設定，請確認 FoodRadar GitHub Pages 已正常部署。'));
    document.head.appendChild(script);
  });
}
export async function boot() {
  if (!bootPromise) {
    bootPromise = (async () => {
      await loadPublicConfig();
      if (!window.UBER_DATA_CONTRACT) throw new Error('FoodRadar 價格資料契約未載入。');
      const meta = await metadata();
      initialized = true;
      return meta;
    })().catch(error => { bootPromise = null; throw error; });
  }
  return bootPromise;
}
function assertReady() {
  if (!initialized) throw new Error('FoodRadar 尚未準備完成。');
}
export async function stores(location = null) {
  assertReady();
  if (location && location.enabled) {
    const info = await getStoresInLocation(location);
    return (info && info.stores) || [];
  }
  if (!allStores) allStores = await directory(null, 50000);
  return allStores;
}
export async function menu(storeUuid) {
  assertReady();
  const key = String(storeUuid || '');
  if (!menuCache.has(key)) {
    const pending = productsForStore(key, 1500).catch(error => { menuCache.delete(key); throw error; });
    menuCache.set(key, pending);
  }
  return menuCache.get(key);
}
function locationKey(location) {
  if (!location || !location.enabled) return 'all';
  return [location.latitude, location.longitude, location.radiusKm].join(':');
}
export async function priceIndex(location = null) {
  assertReady();
  const key = locationKey(location);
  if (!indexCache.has(key)) {
    const job = (async () => {
      const products = await searchPacked({location, limit: 50000});
      const summary = new Map();
      for (const p of products) {
        const uuid = String(p.store_uuid || p.store_id || '');
        const unit = Number(p.eff_price);
        if (!uuid || !(unit > 0) || !Number.isFinite(unit)) continue;
        if (!summary.has(uuid)) summary.set(uuid, {minPrice: Infinity, dropCount: 0, productCount: 0});
        const item = summary.get(uuid);
        item.minPrice = Math.min(item.minPrice, unit);
        item.productCount++;
        if (p.is_price_drop === 1 || p.is_price_drop === '1') item.dropCount++;
      }
      return summary;
    })().catch(error => { indexCache.delete(key); throw error; });
    indexCache.set(key, job);
  }
  return indexCache.get(key);
}
export function foodRadarUrl() {
  return 'https://fafagoback.github.io/FoodRadar/';
}
