// NEPSE charge constants
const SLABS = [
  { limit: 50000, rate: 0.0036 },
  { limit: 500000, rate: 0.0033 },
  { limit: 2000000, rate: 0.0031 },
  { limit: 10000000, rate: 0.0027 },
  { limit: Infinity, rate: 0.0024 },
];
const SEBON_RATE = 0.00015;
const DP_CHARGE = 25;
const MIN_COMMISSION = 10;
const CGT_SHORT = 0.075;
const CGT_LONG = 0.05;

const PROFIT_MARGINS = [3, 5, 7, 8, 10, 12, 15, 20, 25];
const LOSS_MARGINS = [5, 7, 10];

function calcCommission(amount) {
  let commission = 0;
  let prev = 0;
  for (const slab of SLABS) {
    if (amount <= prev) break;
    const taxable = Math.min(amount, slab.limit) - prev;
    commission += taxable * slab.rate;
    prev = slab.limit;
  }
  return Math.max(commission, MIN_COMMISSION);
}

function calcCharges(amount) {
  return calcCommission(amount) + amount * SEBON_RATE + DP_CHARGE;
}

function calcTotalBuyCost(qty, buyPrice, includeCharges) {
  const amount = qty * buyPrice;
  if (!includeCharges) return amount;
  return amount + calcCommission(amount) + amount * SEBON_RATE + DP_CHARGE;
}

function calcNetFromSell(qty, sellPrice, totalBuyCost, includeCharges, includeTax, holdingDays) {
  const sellAmount = qty * sellPrice;
  if (!includeCharges && !includeTax) return sellAmount;

  const sellCharges = includeCharges ? calcCharges(sellAmount) : 0;
  const grossProfit = sellAmount - totalBuyCost - sellCharges;

  let tax = 0;
  if (includeTax && grossProfit > 0) {
    const rate = holdingDays > 365 ? CGT_LONG : CGT_SHORT;
    tax = grossProfit * rate;
  }

  return sellAmount - sellCharges - tax;
}

function calcBreakeven(qty, totalBuyCost, includeCharges) {
  if (!includeCharges) return totalBuyCost / qty;
  // Binary search: find sell price where net receivable = totalBuyCost (no profit, so no CGT)
  let lo = 0, hi = (totalBuyCost / qty) * 3;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const sellAmt = qty * mid;
    const net = sellAmt - calcCharges(sellAmt);
    if (net < totalBuyCost) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function fmt(n) {
  return n.toLocaleString('en-NP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayStr() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// localStorage helpers
function loadHoldings() {
  try {
    return JSON.parse(localStorage.getItem('nepse_holdings') || '[]');
  } catch { return []; }
}

function saveHoldings(holdings) {
  localStorage.setItem('nepse_holdings', JSON.stringify(holdings));
}

function loadSoldTransactions() {
  try {
    return JSON.parse(localStorage.getItem('nepse_sold') || '[]');
  } catch { return []; }
}

function saveSoldTransactions(sold) {
  localStorage.setItem('nepse_sold', JSON.stringify(sold));
}

function loadIPOHoldings() {
  try {
    return JSON.parse(localStorage.getItem('nepse_ipo_holdings') || '[]');
  } catch { return []; }
}

function saveIPOHoldings(holdings) {
  localStorage.setItem('nepse_ipo_holdings', JSON.stringify(holdings));
}

function loadIPOSold() {
  try {
    return JSON.parse(localStorage.getItem('nepse_ipo_sold') || '[]');
  } catch { return []; }
}

function saveIPOSold(sold) {
  localStorage.setItem('nepse_ipo_sold', JSON.stringify(sold));
}

// Main Alpine app
document.addEventListener('alpine:init', () => {
  Alpine.data('riskCalc', () => ({
    // Tab state — restored from URL hash or localStorage
    activeTab: (['quick', 'portfolio', 'ipo', 'costs'].includes(location.hash.slice(1))
      ? location.hash.slice(1)
      : localStorage.getItem('nepse_activeTab') || 'quick'),

    // Global toggles
    includeCharges: true,
    includeTax: true,
    holdingDays: 180,

    // Quick mode inputs
    quickBuyPrice: 500,
    quickQty: 100,
    quickCustomProfit: '',
    quickCustomLoss: '',

    // Costs tab state
    includeIPOsInCosts: false,

    // Portfolio state
    holdings: [],
    soldTransactions: [],
    includeIPOs: false,
    livePrices: {},
    marketOpen: false,
    pricesLastUpdated: null,
    searchQuery: '',
    expandedHolding: null,
    showProfitTargets: true,
    showStopLoss: true,
    portfolioCustomProfit: '',
    portfolioCustomLoss: '',
    sortBy: 'date',
    sortDir: 'desc',

    // IPO state
    ipoHoldings: [],
    ipoSoldTransactions: [],
    ipoSearchQuery: '',
    ipoExpandedHolding: null,

    // IPO Modal state
    showIPOAddModal: false,
    showIPOSellModal: false,
    showIPOEditModal: false,
    showIPOEditSoldModal: false,
    ipoModalForm: { name: '', qty: '', buyPrice: '', buyDate: todayStr() },
    ipoSellForm: { holdingId: '', qty: '', sellPrice: '', sellDate: todayStr() },
    ipoEditForm: { id: '', name: '', qty: '', buyPrice: '', buyDate: '' },
    ipoEditSoldForm: { id: '', name: '', qty: '', buyPrice: '', buyDate: '', sellPrice: '', sellDate: '' },

    // Import state
    showImportConfirm: false,
    pendingImportData: null,
    importPreview: { holdings: 0, sold: 0 },

    // Modal state
    showAddModal: false,
    showSellModal: false,
    showEditModal: false,
    modalForm: { name: '', qty: '', buyPrice: '', buyDate: todayStr() },
    sellForm: { holdingId: '', qty: '', sellPrice: '', sellDate: todayStr() },
    editForm: { id: '', name: '', qty: '', buyPrice: '', buyDate: '' },
    showEditSoldModal: false,
    editSoldForm: { id: '', name: '', qty: '', buyPrice: '', buyDate: '', sellPrice: '', sellDate: '' },

    async init() {
      this.holdings = loadHoldings();
      this.soldTransactions = loadSoldTransactions();
      this.ipoHoldings = loadIPOHoldings();
      this.ipoSoldTransactions = loadIPOSold();
      await this.loadPrices();

      // Auto-refresh prices every 10 min if market open
      setInterval(() => {
        if (window.NepseAPI && NepseAPI.isMarketOpen()) this.loadPrices();
      }, 10 * 60 * 1000);

      // Sync tab to hash and localStorage on change
      this.$watch('activeTab', tab => {
        localStorage.setItem('nepse_activeTab', tab);
        history.replaceState(null, '', '#' + tab);
      });

      // Handle browser back/forward
      window.addEventListener('hashchange', () => {
        const hash = location.hash.slice(1);
        if (['quick', 'portfolio', 'ipo', 'costs'].includes(hash)) this.activeTab = hash;
      });
    },

    // Quick mode calculations
    get quickBreakeven() {
      const totalBuyCost = calcTotalBuyCost(this.quickQty, this.quickBuyPrice, this.includeCharges);
      return calcBreakeven(this.quickQty, totalBuyCost, this.includeCharges);
    },

    holdingBreakeven(holding) {
      const totalBuyCost = calcTotalBuyCost(holding.qty, holding.buyPrice, this.includeCharges);
      return calcBreakeven(holding.qty, totalBuyCost, this.includeCharges);
    },

    get quickProfitRows() {
      const margins = [...PROFIT_MARGINS];
      if (this.quickCustomProfit && !margins.includes(Number(this.quickCustomProfit))) {
        margins.push(Number(this.quickCustomProfit));
        margins.sort((a, b) => a - b);
      }
      return margins.map(m => this.calcTargetRow(
        this.quickQty, this.quickBuyPrice, m, 'profit'
      ));
    },

    get quickLossRows() {
      const margins = [...LOSS_MARGINS];
      if (this.quickCustomLoss && !margins.includes(Number(this.quickCustomLoss))) {
        margins.push(Number(this.quickCustomLoss));
        margins.sort((a, b) => a - b);
      }
      return margins.map(m => this.calcTargetRow(
        this.quickQty, this.quickBuyPrice, m, 'loss'
      ));
    },

    get quickRiskRewardRows() {
      const rows = [];
      const lossMargins = [...LOSS_MARGINS];
      if (this.quickCustomLoss && !lossMargins.includes(Number(this.quickCustomLoss))) {
        lossMargins.push(Number(this.quickCustomLoss));
        lossMargins.sort((a, b) => a - b);
      }
      const profitMargins = [...PROFIT_MARGINS];
      if (this.quickCustomProfit && !profitMargins.includes(Number(this.quickCustomProfit))) {
        profitMargins.push(Number(this.quickCustomProfit));
        profitMargins.sort((a, b) => a - b);
      }
      for (const lm of lossMargins) {
        for (const pm of profitMargins) {
          rows.push({ loss: lm, profit: pm, ratio: `1:${(pm / lm).toFixed(1)}` });
        }
      }
      return rows;
    },

    calcTargetRow(qty, buyPrice, margin, type, isPortfolio, days) {
      const totalBuyCost = calcTotalBuyCost(qty, buyPrice, this.includeCharges);
      const perShareCost = totalBuyCost / qty;
      const effectiveDays = days != null ? days : this.holdingDays;

      let targetPrice, netAmount, plAmount;

      if (type === 'profit') {
        if (this.includeCharges || this.includeTax) {
          // Binary search for target price that gives exact margin% net profit
          const targetNet = totalBuyCost * (1 + margin / 100);
          let lo = buyPrice, hi = buyPrice * (1 + margin * 3 / 100);
          for (let i = 0; i < 100; i++) {
            const mid = (lo + hi) / 2;
            const net = calcNetFromSell(qty, mid, totalBuyCost, this.includeCharges, this.includeTax, effectiveDays);
            if (net < targetNet) lo = mid; else hi = mid;
          }
          targetPrice = (lo + hi) / 2;
          netAmount = calcNetFromSell(qty, targetPrice, totalBuyCost, this.includeCharges, this.includeTax, effectiveDays);
        } else {
          targetPrice = buyPrice * (1 + margin / 100);
          netAmount = qty * targetPrice;
        }
        plAmount = netAmount - totalBuyCost;
      } else {
        targetPrice = buyPrice * (1 - margin / 100);
        if (this.includeCharges) {
          netAmount = calcNetFromSell(qty, targetPrice, totalBuyCost, true, false, 0);
        } else {
          netAmount = qty * targetPrice;
        }
        plAmount = netAmount - totalBuyCost;
      }

      return {
        margin,
        targetPrice,
        netAmount,
        plAmount,
        perShareCost,
        isCustom: type === 'profit'
          ? Number(isPortfolio ? this.portfolioCustomProfit : this.quickCustomProfit) === margin && !PROFIT_MARGINS.includes(margin)
          : Number(isPortfolio ? this.portfolioCustomLoss : this.quickCustomLoss) === margin && !LOSS_MARGINS.includes(margin),
      };
    },

    // Portfolio methods
    get filteredHoldings() {
      let list = [...this.holdings];
      if (this.searchQuery.trim()) {
        const q = this.searchQuery.toLowerCase();
        list = list.filter(h => h.name.toLowerCase().includes(q));
      }
      const dir = this.sortDir === 'asc' ? 1 : -1;
      list.sort((a, b) => {
        if (this.sortBy === 'name') return dir * a.name.localeCompare(b.name);
        if (this.sortBy === 'price') return dir * (a.buyPrice - b.buyPrice);
        return dir * (a.buyDate < b.buyDate ? -1 : a.buyDate > b.buyDate ? 1 : 0);
      });
      return list;
    },

    toggleSort(field) {
      if (this.sortBy === field) {
        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortBy = field;
        this.sortDir = 'asc';
      }
    },

    async loadPrices() {
      if (!window.NepseAPI) return;
      const result = await NepseAPI.getMarketData();
      this.marketOpen = result.marketOpen;
      this.pricesLastUpdated = result.lastUpdated;
      if (result.data && result.data.stocks) {
        this.livePrices = result.data.stocks;
      }
    },

    getLivePrice(symbol) {
      const stock = this.livePrices[symbol.toUpperCase()];
      return stock ? stock.ltp : null;
    },

    getLiveChange(symbol) {
      const stock = this.livePrices[symbol.toUpperCase()];
      return stock ? stock.change : null;
    },

    holdingUnrealizedPL(holding) {
      const ltp = this.getLivePrice(holding.name);
      if (ltp === null) return null;
      const buyCost = calcTotalBuyCost(holding.qty, holding.buyPrice, this.includeCharges);
      const days = daysBetween(holding.buyDate, todayStr());
      const net = calcNetFromSell(holding.qty, ltp, buyCost, this.includeCharges, this.includeTax, days);
      const pl = net - buyCost;
      const pct = buyCost ? (pl / buyCost * 100) : 0;
      return { pl, pct, ltp };
    },

    soldPL(t) {
      const buyCost = calcTotalBuyCost(t.qty, t.buyPrice, this.includeCharges);
      const net = calcNetFromSell(t.qty, t.sellPrice, buyCost, this.includeCharges, this.includeTax, t.holdingDays);
      const pl = net - buyCost;
      const plPercent = buyCost ? (pl / buyCost * 100) : 0;
      return { pl, netReceived: net, buyCost, plPercent };
    },

    get realizedSummary() {
      let totalProfit = 0, totalLoss = 0;
      for (const t of this.soldTransactions) {
        const { pl } = this.soldPL(t);
        if (pl >= 0) totalProfit += pl;
        else totalLoss += pl;
      }
      if (this.includeIPOs) {
        for (const t of this.ipoSoldTransactions) {
          const { pl } = this.soldPL(t);
          if (pl >= 0) totalProfit += pl;
          else totalLoss += pl;
        }
      }
      return { totalProfit, totalLoss, net: totalProfit + totalLoss };
    },

    get consolidatedHoldings() {
      const grouped = {};
      const allHoldings = this.includeIPOs ? [...this.holdings, ...this.ipoHoldings] : this.holdings;
      for (const h of allHoldings) {
        const sym = h.name.toUpperCase();
        if (!grouped[sym]) {
          grouped[sym] = { symbol: sym, totalQty: 0, totalCost: 0, entries: [] };
        }
        const cost = calcTotalBuyCost(h.qty, h.buyPrice, this.includeCharges);
        grouped[sym].totalQty += h.qty;
        grouped[sym].totalCost += cost;
        grouped[sym].entries.push(h);
      }

      return Object.values(grouped).map(g => {
        const wacc = g.totalQty ? g.totalCost / g.totalQty : 0;
        const breakeven = calcBreakeven(g.totalQty, g.totalCost, this.includeCharges);
        const ltp = this.getLivePrice(g.symbol);
        let unrealizedPL = null, unrealizedPct = null, currentValue = null;
        if (ltp !== null) {
          // Calculate net sell value at LTP for each entry to account for charges/tax correctly
          let totalNet = 0;
          for (const h of g.entries) {
            const buyCost = calcTotalBuyCost(h.qty, h.buyPrice, this.includeCharges);
            const days = daysBetween(h.buyDate, todayStr());
            totalNet += calcNetFromSell(h.qty, ltp, buyCost, this.includeCharges, this.includeTax, days);
          }
          currentValue = g.totalQty * ltp;
          unrealizedPL = totalNet - g.totalCost;
          unrealizedPct = g.totalCost ? (unrealizedPL / g.totalCost * 100) : 0;
        }
        const change = this.getLiveChange(g.symbol);
        return {
          symbol: g.symbol,
          totalQty: g.totalQty,
          wacc,
          breakeven,
          totalCost: g.totalCost,
          ltp,
          change,
          currentValue,
          unrealizedPL,
          unrealizedPct,
        };
      }).sort((a, b) => a.symbol.localeCompare(b.symbol));
    },

    get unrealizedSummary() {
      let totalPL = 0, totalInvested = 0, count = 0;
      const allHoldings = this.includeIPOs ? [...this.holdings, ...this.ipoHoldings] : this.holdings;
      for (const h of allHoldings) {
        const result = this.holdingUnrealizedPL(h);
        if (result === null) continue;
        totalPL += result.pl;
        totalInvested += calcTotalBuyCost(h.qty, h.buyPrice, this.includeCharges);
        count++;
      }
      const pct = totalInvested ? (totalPL / totalInvested * 100) : 0;
      return { totalPL, totalInvested, pct, count };
    },

    holdingProfitRows(holding) {
      const margins = [...PROFIT_MARGINS];
      if (this.portfolioCustomProfit && !margins.includes(Number(this.portfolioCustomProfit))) {
        margins.push(Number(this.portfolioCustomProfit));
        margins.sort((a, b) => a - b);
      }
      const days = this.holdingDaysHeld(holding);
      return margins.map(m => this.calcTargetRow(holding.qty, holding.buyPrice, m, 'profit', true, days));
    },

    holdingLossRows(holding) {
      const margins = [...LOSS_MARGINS];
      if (this.portfolioCustomLoss && !margins.includes(Number(this.portfolioCustomLoss))) {
        margins.push(Number(this.portfolioCustomLoss));
        margins.sort((a, b) => a - b);
      }
      const days = this.holdingDaysHeld(holding);
      return margins.map(m => this.calcTargetRow(holding.qty, holding.buyPrice, m, 'loss', true, days));
    },

    holdingDaysHeld(holding) {
      return daysBetween(holding.buyDate, todayStr());
    },

    toggleHolding(id) {
      this.expandedHolding = this.expandedHolding === id ? null : id;
    },

    openAddModal() {
      this.modalForm = { name: '', qty: '', buyPrice: '', buyDate: todayStr() };
      this.showAddModal = true;
    },

    addHolding() {
      if (!this.modalForm.name || !this.modalForm.qty || !this.modalForm.buyPrice) return;
      this.holdings.push({
        id: generateId(),
        name: this.modalForm.name.toUpperCase(),
        qty: Number(this.modalForm.qty),
        buyPrice: Number(this.modalForm.buyPrice),
        buyDate: this.modalForm.buyDate || todayStr(),
      });
      saveHoldings(this.holdings);
      this.showAddModal = false;
    },

    openEditModal(holding) {
      this.editForm = { ...holding };
      this.showEditModal = true;
    },

    saveEdit() {
      const idx = this.holdings.findIndex(h => h.id === this.editForm.id);
      if (idx === -1) return;
      this.holdings[idx] = {
        ...this.holdings[idx],
        name: this.editForm.name.toUpperCase(),
        qty: Number(this.editForm.qty),
        buyPrice: Number(this.editForm.buyPrice),
        buyDate: this.editForm.buyDate,
      };
      saveHoldings(this.holdings);
      this.showEditModal = false;
    },

    deleteHolding(id) {
      this.holdings = this.holdings.filter(h => h.id !== id);
      saveHoldings(this.holdings);
      if (this.expandedHolding === id) this.expandedHolding = null;
    },

    openSellModal(holding) {
      this.sellForm = {
        holdingId: holding.id,
        qty: holding.qty,
        sellPrice: '',
        sellDate: todayStr(),
      };
      this.showSellModal = true;
    },

    confirmSell() {
      const holding = this.holdings.find(h => h.id === this.sellForm.holdingId);
      if (!holding || !this.sellForm.qty || !this.sellForm.sellPrice) return;

      const sellQty = Math.min(Number(this.sellForm.qty), holding.qty);
      const sellPrice = Number(this.sellForm.sellPrice);
      const sellDate = this.sellForm.sellDate || todayStr();
      const days = daysBetween(holding.buyDate, sellDate);

      const buyCost = calcTotalBuyCost(sellQty, holding.buyPrice, this.includeCharges);
      const netFromSell = calcNetFromSell(sellQty, sellPrice, buyCost, this.includeCharges, this.includeTax, days);
      const pl = netFromSell - buyCost;

      this.soldTransactions.push({
        id: generateId(),
        name: holding.name,
        qty: sellQty,
        buyPrice: holding.buyPrice,
        buyDate: holding.buyDate,
        sellPrice,
        sellDate,
        holdingDays: days,
        pl,
        netReceived: netFromSell,
      });
      saveSoldTransactions(this.soldTransactions);

      // Update or remove holding
      const remaining = holding.qty - sellQty;
      if (remaining <= 0) {
        this.holdings = this.holdings.filter(h => h.id !== holding.id);
        if (this.expandedHolding === holding.id) this.expandedHolding = null;
      } else {
        holding.qty = remaining;
      }
      saveHoldings(this.holdings);
      this.showSellModal = false;
    },

    deleteSoldTransaction(id) {
      this.soldTransactions = this.soldTransactions.filter(t => t.id !== id);
      saveSoldTransactions(this.soldTransactions);
    },

    openEditSoldModal(t) {
      this.editSoldForm = { ...t };
      this.showEditSoldModal = true;
    },

    saveEditSold() {
      const idx = this.soldTransactions.findIndex(t => t.id === this.editSoldForm.id);
      if (idx === -1) return;

      const f = this.editSoldForm;
      const qty = Number(f.qty);
      const buyPrice = Number(f.buyPrice);
      const sellPrice = Number(f.sellPrice);
      const days = daysBetween(f.buyDate, f.sellDate);

      const buyCost = calcTotalBuyCost(qty, buyPrice, this.includeCharges);
      const netFromSell = calcNetFromSell(qty, sellPrice, buyCost, this.includeCharges, this.includeTax, days);

      this.soldTransactions[idx] = {
        ...this.soldTransactions[idx],
        name: f.name.toUpperCase(),
        qty,
        buyPrice,
        buyDate: f.buyDate,
        sellPrice,
        sellDate: f.sellDate,
        holdingDays: days,
        pl: netFromSell - buyCost,
        netReceived: netFromSell,
      };
      saveSoldTransactions(this.soldTransactions);
      this.showEditSoldModal = false;
    },

    // === IPO methods ===

    get ipoFilteredHoldings() {
      let list = [...this.ipoHoldings];
      if (this.ipoSearchQuery.trim()) {
        const q = this.ipoSearchQuery.toLowerCase();
        list = list.filter(h => h.name.toLowerCase().includes(q));
      }
      list.sort((a, b) => a.name.localeCompare(b.name) || (a.buyDate < b.buyDate ? -1 : 1));
      return list;
    },

    get ipoConsolidatedHoldings() {
      const grouped = {};
      for (const h of this.ipoHoldings) {
        const sym = h.name.toUpperCase();
        if (!grouped[sym]) {
          grouped[sym] = { symbol: sym, totalQty: 0, totalCost: 0, entries: [] };
        }
        const cost = calcTotalBuyCost(h.qty, h.buyPrice, this.includeCharges);
        grouped[sym].totalQty += h.qty;
        grouped[sym].totalCost += cost;
        grouped[sym].entries.push(h);
      }
      return Object.values(grouped).map(g => {
        const wacc = g.totalQty ? g.totalCost / g.totalQty : 0;
        const ltp = this.getLivePrice(g.symbol);
        let unrealizedPL = null, unrealizedPct = null;
        if (ltp !== null) {
          let totalNet = 0;
          for (const h of g.entries) {
            const buyCost = calcTotalBuyCost(h.qty, h.buyPrice, this.includeCharges);
            const days = daysBetween(h.buyDate, todayStr());
            totalNet += calcNetFromSell(h.qty, ltp, buyCost, this.includeCharges, this.includeTax, days);
          }
          unrealizedPL = totalNet - g.totalCost;
          unrealizedPct = g.totalCost ? (unrealizedPL / g.totalCost * 100) : 0;
        }
        const change = this.getLiveChange(g.symbol);
        return { symbol: g.symbol, totalQty: g.totalQty, wacc, totalCost: g.totalCost, ltp, change, unrealizedPL, unrealizedPct };
      }).sort((a, b) => a.symbol.localeCompare(b.symbol));
    },

    get ipoUnrealizedSummary() {
      let totalPL = 0, totalInvested = 0, count = 0;
      for (const h of this.ipoHoldings) {
        const result = this.holdingUnrealizedPL(h);
        if (result === null) continue;
        totalPL += result.pl;
        totalInvested += calcTotalBuyCost(h.qty, h.buyPrice, this.includeCharges);
        count++;
      }
      const pct = totalInvested ? (totalPL / totalInvested * 100) : 0;
      return { totalPL, totalInvested, pct, count };
    },

    get ipoRealizedSummary() {
      let totalProfit = 0, totalLoss = 0;
      for (const t of this.ipoSoldTransactions) {
        const { pl } = this.soldPL(t);
        if (pl >= 0) totalProfit += pl;
        else totalLoss += pl;
      }
      return { totalProfit, totalLoss, net: totalProfit + totalLoss };
    },

    openIPOAddModal() {
      this.ipoModalForm = { name: '', qty: '', buyPrice: '', buyDate: todayStr() };
      this.showIPOAddModal = true;
    },

    addIPOHolding() {
      if (!this.ipoModalForm.name || !this.ipoModalForm.qty || !this.ipoModalForm.buyPrice) return;
      this.ipoHoldings.push({
        id: generateId(),
        name: this.ipoModalForm.name.toUpperCase(),
        qty: Number(this.ipoModalForm.qty),
        buyPrice: Number(this.ipoModalForm.buyPrice),
        buyDate: this.ipoModalForm.buyDate || todayStr(),
      });
      saveIPOHoldings(this.ipoHoldings);
      this.showIPOAddModal = false;
    },

    openIPOEditModal(holding) {
      this.ipoEditForm = { ...holding };
      this.showIPOEditModal = true;
    },

    saveIPOEdit() {
      const idx = this.ipoHoldings.findIndex(h => h.id === this.ipoEditForm.id);
      if (idx === -1) return;
      this.ipoHoldings[idx] = {
        ...this.ipoHoldings[idx],
        name: this.ipoEditForm.name.toUpperCase(),
        qty: Number(this.ipoEditForm.qty),
        buyPrice: Number(this.ipoEditForm.buyPrice),
        buyDate: this.ipoEditForm.buyDate,
      };
      saveIPOHoldings(this.ipoHoldings);
      this.showIPOEditModal = false;
    },

    deleteIPOHolding(id) {
      this.ipoHoldings = this.ipoHoldings.filter(h => h.id !== id);
      saveIPOHoldings(this.ipoHoldings);
      if (this.ipoExpandedHolding === id) this.ipoExpandedHolding = null;
    },

    openIPOSellModal(holding) {
      this.ipoSellForm = { holdingId: holding.id, qty: holding.qty, sellPrice: '', sellDate: todayStr() };
      this.showIPOSellModal = true;
    },

    confirmIPOSell() {
      const holding = this.ipoHoldings.find(h => h.id === this.ipoSellForm.holdingId);
      if (!holding || !this.ipoSellForm.qty || !this.ipoSellForm.sellPrice) return;

      const sellQty = Math.min(Number(this.ipoSellForm.qty), holding.qty);
      const sellPrice = Number(this.ipoSellForm.sellPrice);
      const sellDate = this.ipoSellForm.sellDate || todayStr();
      const days = daysBetween(holding.buyDate, sellDate);
      const buyCost = calcTotalBuyCost(sellQty, holding.buyPrice, this.includeCharges);
      const netFromSell = calcNetFromSell(sellQty, sellPrice, buyCost, this.includeCharges, this.includeTax, days);

      this.ipoSoldTransactions.push({
        id: generateId(), name: holding.name, qty: sellQty,
        buyPrice: holding.buyPrice, buyDate: holding.buyDate,
        sellPrice, sellDate, holdingDays: days,
        pl: netFromSell - buyCost, netReceived: netFromSell,
      });
      saveIPOSold(this.ipoSoldTransactions);

      const remaining = holding.qty - sellQty;
      if (remaining <= 0) {
        this.ipoHoldings = this.ipoHoldings.filter(h => h.id !== holding.id);
        if (this.ipoExpandedHolding === holding.id) this.ipoExpandedHolding = null;
      } else {
        holding.qty = remaining;
      }
      saveIPOHoldings(this.ipoHoldings);
      this.showIPOSellModal = false;
    },

    deleteIPOSoldTransaction(id) {
      this.ipoSoldTransactions = this.ipoSoldTransactions.filter(t => t.id !== id);
      saveIPOSold(this.ipoSoldTransactions);
    },

    openIPOEditSoldModal(t) {
      this.ipoEditSoldForm = { ...t };
      this.showIPOEditSoldModal = true;
    },

    saveIPOEditSold() {
      const idx = this.ipoSoldTransactions.findIndex(t => t.id === this.ipoEditSoldForm.id);
      if (idx === -1) return;
      const f = this.ipoEditSoldForm;
      const qty = Number(f.qty), buyPrice = Number(f.buyPrice), sellPrice = Number(f.sellPrice);
      const days = daysBetween(f.buyDate, f.sellDate);
      const buyCost = calcTotalBuyCost(qty, buyPrice, this.includeCharges);
      const netFromSell = calcNetFromSell(qty, sellPrice, buyCost, this.includeCharges, this.includeTax, days);
      this.ipoSoldTransactions[idx] = {
        ...this.ipoSoldTransactions[idx], name: f.name.toUpperCase(), qty, buyPrice,
        buyDate: f.buyDate, sellPrice, sellDate: f.sellDate, holdingDays: days,
        pl: netFromSell - buyCost, netReceived: netFromSell,
      };
      saveIPOSold(this.ipoSoldTransactions);
      this.showIPOEditSoldModal = false;
    },

    // === Costs & Tax ===

    get costBreakdown() {
      let transactions = [...this.soldTransactions];
      if (this.includeIPOsInCosts) {
        transactions = transactions.concat(this.ipoSoldTransactions);
      }

      let totalBuyCommission = 0, totalSellCommission = 0;
      let totalBuySebon = 0, totalSellSebon = 0;
      let totalDPCharges = 0;
      let totalCGTShort = 0, totalCGTLong = 0;
      let perStock = {};

      for (const t of transactions) {
        const buyAmount = t.qty * t.buyPrice;
        const sellAmount = t.qty * t.sellPrice;

        const buyComm = calcCommission(buyAmount);
        const sellComm = calcCommission(sellAmount);
        const buySebon = buyAmount * SEBON_RATE;
        const sellSebon = sellAmount * SEBON_RATE;
        const dp = DP_CHARGE * 2; // buy + sell side

        totalBuyCommission += buyComm;
        totalSellCommission += sellComm;
        totalBuySebon += buySebon;
        totalSellSebon += sellSebon;
        totalDPCharges += dp;

        // CGT calculation
        const buyCost = buyAmount + buyComm + buySebon + DP_CHARGE;
        const sellCharges = sellComm + sellSebon + DP_CHARGE;
        const grossProfit = sellAmount - buyCost - sellCharges;
        if (grossProfit > 0) {
          if (t.holdingDays > 365) {
            totalCGTLong += grossProfit * CGT_LONG;
          } else {
            totalCGTShort += grossProfit * CGT_SHORT;
          }
        }

        // Per-stock aggregation
        const sym = t.name.toUpperCase();
        if (!perStock[sym]) {
          perStock[sym] = { symbol: sym, commission: 0, sebon: 0, dp: 0, cgt: 0, trades: 0 };
        }
        perStock[sym].commission += buyComm + sellComm;
        perStock[sym].sebon += buySebon + sellSebon;
        perStock[sym].dp += dp;
        if (grossProfit > 0) {
          perStock[sym].cgt += grossProfit * (t.holdingDays > 365 ? CGT_LONG : CGT_SHORT);
        }
        perStock[sym].trades++;
      }

      const totalCommission = totalBuyCommission + totalSellCommission;
      const totalSebon = totalBuySebon + totalSellSebon;
      const totalCGT = totalCGTShort + totalCGTLong;
      const grandTotal = totalCommission + totalSebon + totalDPCharges + totalCGT;

      return {
        totalCommission, totalBuyCommission, totalSellCommission,
        totalSebon, totalBuySebon, totalSellSebon,
        totalDPCharges,
        totalCGT, totalCGTShort, totalCGTLong,
        grandTotal,
        transactionCount: transactions.length,
        perStock: Object.values(perStock).sort((a, b) => {
          const totalA = a.commission + a.sebon + a.dp + a.cgt;
          const totalB = b.commission + b.sebon + b.dp + b.cgt;
          return totalB - totalA;
        }),
      };
    },

    exportPortfolio() {
      const data = {
        version: 2,
        exportedAt: new Date().toISOString(),
        holdings: this.holdings,
        soldTransactions: this.soldTransactions,
        ipoHoldings: this.ipoHoldings,
        ipoSoldTransactions: this.ipoSoldTransactions,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nepse-portfolio-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    importPortfolio(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (!Array.isArray(data.holdings) || !Array.isArray(data.soldTransactions)) {
            alert('Invalid portfolio file. Expected holdings and soldTransactions arrays.');
            return;
          }
          this.pendingImportData = data;
          const ipoH = Array.isArray(data.ipoHoldings) ? data.ipoHoldings.length : 0;
          const ipoS = Array.isArray(data.ipoSoldTransactions) ? data.ipoSoldTransactions.length : 0;
          this.importPreview = { holdings: data.holdings.length, sold: data.soldTransactions.length, ipoHoldings: ipoH, ipoSold: ipoS };
          this.showImportConfirm = true;
        } catch {
          alert('Failed to parse file. Please select a valid JSON file.');
        }
      };
      reader.readAsText(file);
      event.target.value = '';
    },

    confirmImport() {
      if (!this.pendingImportData) return;
      this.holdings = this.pendingImportData.holdings;
      this.soldTransactions = this.pendingImportData.soldTransactions;
      this.ipoHoldings = Array.isArray(this.pendingImportData.ipoHoldings) ? this.pendingImportData.ipoHoldings : [];
      this.ipoSoldTransactions = Array.isArray(this.pendingImportData.ipoSoldTransactions) ? this.pendingImportData.ipoSoldTransactions : [];
      saveHoldings(this.holdings);
      saveSoldTransactions(this.soldTransactions);
      saveIPOHoldings(this.ipoHoldings);
      saveIPOSold(this.ipoSoldTransactions);
      this.pendingImportData = null;
      this.showImportConfirm = false;
      this.expandedHolding = null;
      this.ipoExpandedHolding = null;
    },

    fmt,
  }));
});
