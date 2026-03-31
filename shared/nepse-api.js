/**
 * NEPSE Market Data — shared module
 *
 * Fetches live stock prices from Merolagani's public API.
 * Caches in localStorage so all tools share the same data.
 *
 * Market hours: Sun–Thu, 11:00 AM – 3:00 PM NPT (UTC+5:45)
 * Outside market hours, cached data is served without fetching.
 */

const _e = 'aHR0cHM6Ly93d3cubWVyb2xhZ2FuaS5jb20vaGFuZGxlcnMvd2VicmVxdWVzdGhhbmRsZXIuYXNoeD90eXBlPW1hcmtldF9zdW1tYXJ5';
const MEROLAGANI_URL = atob(_e);

const CACHE_KEY = 'nepse_market_data';
const CACHE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Get current time in Nepal (UTC+5:45)
 */
function getNPT() {
  const now = new Date();
  // UTC+5:45 = 345 minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 345 * 60000);
}

/**
 * Check if NEPSE market is currently open.
 * Sun(0)–Thu(4), 11:00–15:00 NPT.
 */
function isMarketOpen() {
  const npt = getNPT();
  const day = npt.getDay(); // 0=Sun, 6=Sat
  const hour = npt.getHours();
  const minutes = npt.getMinutes();
  const timeInMinutes = hour * 60 + minutes;

  // Market days: Sun(0) to Thu(4)
  if (day > 4) return false; // Fri(5), Sat(6)

  // Market hours: 11:00 to 15:00 NPT
  return timeInMinutes >= 660 && timeInMinutes < 900;
}

/**
 * Read cached market data from localStorage.
 * Returns { data, timestamp, isStale } or null.
 */
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const age = Date.now() - cached.timestamp;
    return {
      data: cached.data,
      timestamp: cached.timestamp,
      isStale: age > CACHE_MAX_AGE_MS,
    };
  } catch {
    return null;
  }
}

/**
 * Write market data to localStorage cache.
 */
function writeCache(data) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ data, timestamp: Date.now() })
  );
}

/**
 * Fetch fresh market data from Merolagani.
 * Returns parsed data object or null on failure.
 */
async function fetchMarketData() {
  try {
    const res = await fetch(MEROLAGANI_URL);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.mt !== 'ok') return null;

    // Build a lookup map: symbol → stock data
    const stocks = {};
    if (json.turnover && json.turnover.detail) {
      for (const item of json.turnover.detail) {
        stocks[item.s] = {
          symbol: item.s,
          ltp: item.lp,          // last traded price
          change: item.pc,       // % change
          high: item.h,
          low: item.l,
          open: item.op,
          volume: item.q,
          turnover: item.t,
        };
      }
    }

    return {
      stocks,
      overall: json.overall || {},
      date: json.turnover?.date || null,
      stockCount: Object.keys(stocks).length,
    };
  } catch {
    return null;
  }
}

/**
 * Get market data — the main entry point for all tools.
 *
 * - During market hours: fetches if cache is stale (>10 min)
 * - Outside market hours: returns cached data, never fetches
 * - Returns { data, source, marketOpen, lastUpdated }
 */
async function getMarketData(forceRefresh = false) {
  const marketOpen = isMarketOpen();
  const cached = readCache();

  const result = {
    data: null,
    source: 'none',
    marketOpen,
    lastUpdated: null,
    npt: getNPT(),
  };

  // If market is closed and we have cache, return it
  if (!marketOpen && cached && !forceRefresh) {
    result.data = cached.data;
    result.source = 'cache';
    result.lastUpdated = cached.timestamp;
    return result;
  }

  // If market is open (or force refresh), check if cache is fresh
  if (cached && !cached.isStale && !forceRefresh) {
    result.data = cached.data;
    result.source = 'cache';
    result.lastUpdated = cached.timestamp;
    return result;
  }

  // Need to fetch — but only if market is open or forcing
  if (marketOpen || forceRefresh) {
    const fresh = await fetchMarketData();
    if (fresh) {
      writeCache(fresh);
      result.data = fresh;
      result.source = 'live';
      result.lastUpdated = Date.now();
      return result;
    }
  }

  // Fetch failed or not attempted — fall back to cache
  if (cached) {
    result.data = cached.data;
    result.source = 'cache';
    result.lastUpdated = cached.timestamp;
  }

  return result;
}

/**
 * Get price for a single symbol from cached data.
 * Returns stock object or null.
 */
function getCachedPrice(symbol) {
  const cached = readCache();
  if (!cached || !cached.data || !cached.data.stocks) return null;
  return cached.data.stocks[symbol.toUpperCase()] || null;
}

/**
 * Format timestamp to readable string.
 */
function formatTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Export for use by other modules
window.NepseAPI = {
  getMarketData,
  getCachedPrice,
  isMarketOpen,
  getNPT,
  formatTimestamp,
  readCache,
  CACHE_MAX_AGE_MS,
};
