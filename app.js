const searchBtn = document.getElementById('searchBtn');
const randomBtn = document.getElementById('randomBtn');
const distanceRange = document.getElementById('distanceRange');
const distanceVal = document.getElementById('distanceVal');
const resultsContainer = document.getElementById('results');
const statusMsg = document.getElementById('status');
const loader = document.getElementById('loader');

// Controls
const controlsSection = document.getElementById('controls');
const keywordInput = document.getElementById('keywordInput');
const categoryFilter = document.getElementById('categoryFilter');
const distFilter = document.getElementById('distFilter');
const sortBy = document.getElementById('sortBy');

// Modal Elements
const photoModal = document.getElementById('photoModal');
const modalTitle = document.getElementById('modalTitle');
const photoContainer = document.getElementById('photoContainer');
const modalLoading = document.getElementById('modalLoading');
const externalLink = document.getElementById('externalLink');
const closeBtn = document.querySelector('.close');

let originalRestaurants = [];
let filteredRestaurants = [];
const photoCache = new Map(); // Store pre-fetched image URLs

/**
 * Hybrid Slider Mapping
 */
function getSliderValue(val) {
    if (val <= 10) return (val / 10).toFixed(1);
    return (val - 9).toFixed(1);
}

distanceRange.addEventListener('input', (e) => {
    distanceVal.textContent = getSliderValue(e.target.value);
});

searchBtn.addEventListener('click', () => {
    getLocation();
});

randomBtn.addEventListener('click', () => {
    pickRandom();
});

keywordInput.addEventListener('input', applyFiltersAndSort);
categoryFilter.addEventListener('change', applyFiltersAndSort);
distFilter.addEventListener('change', applyFiltersAndSort);
sortBy.addEventListener('change', applyFiltersAndSort);

closeBtn.onclick = () => {
    photoModal.style.display = "none";
    photoContainer.innerHTML = "";
};

window.onclick = (event) => {
    if (event.target == photoModal) {
        photoModal.style.display = "none";
        photoContainer.innerHTML = "";
    }
};

function getLocation() {
    if (navigator.geolocation) {
        setLoading(true);
        statusMsg.textContent = "正在定位中...";
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                fetchRestaurants(lat, lon);
            },
            (error) => {
                setLoading(false);
                statusMsg.textContent = "定位失敗：" + error.message;
            }
        );
    } else {
        statusMsg.textContent = "不支援定位。";
    }
}

async function fetchRestaurants(lat, lon) {
    const radiusStr = getSliderValue(distanceRange.value);
    const radius = Math.round(parseFloat(radiusStr) * 1000);
    statusMsg.textContent = `搜尋範圍：${radiusStr} 公里內...`;

    const query = `
        [out:json][timeout:30];
        (
          node["amenity"~"restaurant|cafe|fast_food"](around:${radius},${lat},${lon});
          way["amenity"~"restaurant|cafe|fast_food"](around:${radius},${lat},${lon});
          relation["amenity"~"restaurant|cafe|fast_food"](around:${radius},${lat},${lon});
        );
        out center;
    `;

    try {
        const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
        const data = await response.json();

        originalRestaurants = data.elements.map(el => {
            const tags = el.tags || {};
            const rLat = el.lat || (el.center && el.center.lat);
            const rLon = el.lon || (el.center && el.center.lon);

            // 組合完整地址
            const addr = [
                tags["addr:city"] || "",
                tags["addr:district"] || "",
                tags["addr:street"] || "",
                tags["addr:housenumber"] || ""
            ].filter(v => v !== "").join("") || tags["addr:full"] || "地址未標註";

            return {
                id: el.id,
                name: tags.name || "美食店家",
                address: addr,
                type: tags.amenity || "餐廳",
                cuisine: tags.cuisine || "",
                openingHours: tags.opening_hours || "",
                phone: tags.phone || tags["contact:phone"] || "",
                website: tags.website || tags["contact:website"] || "",
                lat: rLat,
                lon: rLon,
                distance: calculateDistance(lat, lon, rLat, rLon)
            };
        });

        updateCategoryDropdown();
        controlsSection.style.display = "block";
        applyFiltersAndSort();

        // Background Pre-fetching for top results
        preFetchPhotos(filteredRestaurants.slice(0, 5));

    } catch (error) {
        console.error(error);
        statusMsg.textContent = "搜尋失敗。";
    } finally {
        setLoading(false);
    }
}

function updateCategoryDropdown() {
    const categories = new Set();
    originalRestaurants.forEach(r => {
        if (r.cuisine) {
            r.cuisine.split(';').forEach(c => categories.add(c.trim()));
        } else {
            categories.add(r.type === 'restaurant' ? '一般餐廳' : r.type === 'cafe' ? '咖啡廳' : '速食');
        }
    });

    categoryFilter.innerHTML = '<option value="all">所有類別</option>';
    Array.from(categories).sort().forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categoryFilter.appendChild(opt);
    });
}

function applyFiltersAndSort() {
    const keyword = keywordInput.value.toLowerCase();
    const cat = categoryFilter.value;
    const maxDist = distFilter.value === 'all' ? Infinity : parseInt(distFilter.value);
    const sortVal = sortBy.value;

    filteredRestaurants = originalRestaurants.filter(r => {
        const matchesKeyword = r.name.toLowerCase().includes(keyword) ||
            r.cuisine.toLowerCase().includes(keyword) ||
            r.type.toLowerCase().includes(keyword);
        const matchesCat = cat === 'all' ||
            r.cuisine.toLowerCase().includes(cat.toLowerCase()) ||
            (cat === '一般餐廳' && r.type === 'restaurant') ||
            (cat === '咖啡廳' && r.type === 'cafe') ||
            (cat === '速食' && r.type === 'fast_food');
        const matchesDist = r.distance <= maxDist;
        return matchesKeyword && matchesCat && matchesDist;
    });

    filteredRestaurants.sort((a, b) => {
        if (sortVal === 'distance') return a.distance - b.distance;
        if (sortVal === 'name') return a.name.localeCompare(b.name, 'zh-Hant');
        if (sortVal === 'type') return a.type.localeCompare(b.type, 'zh-Hant');
        return 0;
    });

    renderResults(filteredRestaurants);
    randomBtn.style.display = filteredRestaurants.length > 0 ? "block" : "none";
}

function renderResults(list) {
    resultsContainer.innerHTML = "";
    list.forEach((res, index) => {
        const card = document.createElement('div');
        card.className = 'restaurant-card';
        card.id = `res-${index}`;

        let tagsHtml = '';
        if (res.cuisine) tagsHtml += `<span class="tag">🍱 ${res.cuisine}</span>`;
        if (res.phone) tagsHtml += `<span class="tag" style="background:#e3fafd; color:#0b7285;">📞 有電話</span>`;

        card.innerHTML = `
            <div class="info">
                <h3>${res.name}</h3>
                <div class="meta">
                    <span>${res.type === 'restaurant' ? '🍴 餐廳' : res.type === 'cafe' ? '☕ 咖啡廳' : '🍔 速食'}</span>
                    <span> • 👣 ${Math.round(res.distance)}m</span>
                </div>
                <div class="tags-container">${tagsHtml}</div>
            </div>
            <div class="actions">
                <button onclick="shareRestaurant(${index})" 
                   class="go-btn" style="background: #4dabf7; border:none; cursor:pointer;">🔗 分享</button>
                <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(res.name)}+${res.lat},${res.lon}" 
                   target="_blank" class="go-btn" style="background: #2d3436">導航</a>
                <button onclick="fetchEnrichedDetails(${index})" 
                   class="go-btn" style="background: #fab005; border:none; cursor:pointer;">詳情</button>
            </div>
        `;
        resultsContainer.appendChild(card);
    });
}

/**
 * 分享功能：複製資訊至剪貼簿
 */
function shareRestaurant(index) {
    const res = filteredRestaurants[index];
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(res.name)}+${res.lat},${res.lon}`;
    const shareText = `🍴 店家名稱：${res.name}\n📍 地址：${res.address}\n🗺️ 地圖連結：${mapUrl}`;

    navigator.clipboard.writeText(shareText).then(() => {
        alert('✅ 已複製店家資訊與地圖連結！快分享給朋友吧！');
    }).catch(err => {
        console.error('無法複製文字: ', err);
    });
}

/**
 * SPEED OPTIMIZATION: Concurrent Proxy Fetching
 */
async function fetchImagesConcurrently(query) {
    const proxies = [
        "https://api.allorigins.win/get?url=",
        "https://api.codetabs.com/v1/proxy?quest="
    ];
    const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;

    const fetchPromises = proxies.map(proxy =>
        fetch(proxy + encodeURIComponent(targetUrl))
            .then(res => res.json())
            .then(data => data.contents || data)
            .catch(() => null)
    );

    const results = await Promise.all(fetchPromises);
    const html = results.find(h => h && h.length > 500);

    if (!html) return [];

    const imgRegex = /<img[^>]+src="([^">]+)"/g;
    let images = [];
    let match;
    while ((match = imgRegex.exec(html)) !== null && images.length < 12) {
        const url = match[1];
        if ((url.includes("encrypted-tbn") || url.startsWith("http")) && !url.includes("favicon") && !url.includes("logo")) {
            images.push(url);
        }
    }
    return images.slice(0, 5);
}

/**
 * Pre-fetching Logic to populate cache
 */
async function preFetchPhotos(restaurants) {
    restaurants.forEach(async (res) => {
        if (!photoCache.has(res.id)) {
            const imgs = await fetchImagesConcurrently(`${res.name} restaurant food`);
            if (imgs.length > 0) photoCache.set(res.id, imgs);
        }
    });
}

async function fetchEnrichedDetails(index) {
    const res = filteredRestaurants[index];
    modalTitle.textContent = res.name;
    photoModal.style.display = "block";

    // 條件式渲染：只顯示有資料的欄位
    let detailsHtml = '<div class="details-section">';
    if (res.openingHours) detailsHtml += `<div class="detail-item"><h4>狀態</h4><p>${res.openingHours}</p></div>`;
    if (res.phone) detailsHtml += `<div class="detail-item"><h4>電話</h4><p>${res.phone}</p></div>`;
    if (res.website) detailsHtml += `<div class="detail-item"><h4>網站</h4><p><a href="${res.website}" target="_blank">點此開啟官網</a></p></div>`;
    detailsHtml += `<div class="detail-item"><h4>距離</h4><p>${Math.round(res.distance)}m</p></div>`;
    detailsHtml += `</div><div class="photo-grid" id="modalPhotoGrid"></div>`;

    photoContainer.innerHTML = detailsHtml;
    const grid = document.getElementById('modalPhotoGrid');
    externalLink.href = `https://www.google.com/search?q=${encodeURIComponent(res.name)}+food&tbm=isch`;

    // Check cache first
    let cachedImages = photoCache.get(res.id);
    if (cachedImages) {
        grid.innerHTML = cachedImages.map((u, i) => `
            <div class="photo-item ${i === 0 ? 'large' : ''}">
                <img src="${u}" alt="Photo">
            </div>
        `).join('');
        modalLoading.style.display = "none";
        return;
    }

    modalLoading.style.display = "block";
    try {
        const imgs = await fetchImagesConcurrently(`${res.name} restaurant food`);
        if (imgs.length > 0) {
            photoCache.set(res.id, imgs);
            grid.innerHTML = imgs.map((u, i) => `
                <div class="photo-item ${i === 0 ? 'large' : ''}">
                    <img src="${u}" alt="Photo">
                </div>
            `).join('');
        } else {
            throw new Error();
        }
    } catch (e) {
        grid.innerHTML = '<p style="grid-column: span 3; padding: 2rem; text-align: center;">📸 暫時無法擷取預覽圖，請點擊下方開啟原始搜尋</p>';
    } finally {
        modalLoading.style.display = "none";
    }
}

function pickRandom() {
    if (filteredRestaurants.length === 0) return;
    document.querySelectorAll('.restaurant-card').forEach(c => c.classList.remove('highlight'));
    const idx = Math.floor(Math.random() * filteredRestaurants.length);
    const card = document.getElementById(`res-${idx}`);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlight');
    statusMsg.textContent = `🎉 抽到了：${filteredRestaurants[idx].name}`;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dPhi = (lat2 - lat1) * Math.PI / 180;
    const dLambda = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setLoading(isLoading) {
    loader.style.display = isLoading ? "block" : "none";
    searchBtn.disabled = isLoading;
    resultsContainer.style.opacity = isLoading ? "0.5" : "1";
}
