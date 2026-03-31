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

// Main Alpine app
document.addEventListener('alpine:init', () => {
  Alpine.data('riskCalc', () => ({
    // Tab state — restored from URL hash or localStorage
    activeTab: (['quick', 'portfolio'].includes(location.hash.slice(1))
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

    // Portfolio state
    holdings: [],
    soldTransactions: [],
    searchQuery: '',
    expandedHolding: null,
    showProfitTargets: true,
    showStopLoss: true,
    portfolioCustomProfit: '',
    portfolioCustomLoss: '',
    sortBy: 'date',
    sortDir: 'desc',

    // Modal state
    showAddModal: false,
    showSellModal: false,
    showEditModal: false,
    modalForm: { name: '', qty: '', buyPrice: '', buyDate: todayStr() },
    sellForm: { holdingId: '', qty: '', sellPrice: '', sellDate: todayStr() },
    editForm: { id: '', name: '', qty: '', buyPrice: '', buyDate: '' },
    showEditSoldModal: false,
    editSoldForm: { id: '', name: '', qty: '', buyPrice: '', buyDate: '', sellPrice: '', sellDate: '' },

    init() {
      this.holdings = loadHoldings();
      this.soldTransactions = loadSoldTransactions();

      // Sync tab to hash and localStorage on change
      this.$watch('activeTab', tab => {
        localStorage.setItem('nepse_activeTab', tab);
        history.replaceState(null, '', '#' + tab);
      });

      // Handle browser back/forward
      window.addEventListener('hashchange', () => {
        const hash = location.hash.slice(1);
        if (['quick', 'portfolio'].includes(hash)) this.activeTab = hash;
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

    calcTargetRow(qty, buyPrice, margin, type, isPortfolio) {
      const totalBuyCost = calcTotalBuyCost(qty, buyPrice, this.includeCharges);
      const perShareCost = totalBuyCost / qty;

      let targetPrice, netAmount, plAmount;

      if (type === 'profit') {
        if (this.includeCharges || this.includeTax) {
          // Binary search for target price that gives exact margin% net profit
          const targetNet = totalBuyCost * (1 + margin / 100);
          let lo = buyPrice, hi = buyPrice * (1 + margin * 3 / 100);
          for (let i = 0; i < 100; i++) {
            const mid = (lo + hi) / 2;
            const net = calcNetFromSell(qty, mid, totalBuyCost, this.includeCharges, this.includeTax, this.holdingDays);
            if (net < targetNet) lo = mid; else hi = mid;
          }
          targetPrice = (lo + hi) / 2;
          netAmount = calcNetFromSell(qty, targetPrice, totalBuyCost, this.includeCharges, this.includeTax, this.holdingDays);
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

    soldPL(t) {
      const buyCost = calcTotalBuyCost(t.qty, t.buyPrice, this.includeCharges);
      const net = calcNetFromSell(t.qty, t.sellPrice, buyCost, this.includeCharges, this.includeTax, t.holdingDays);
      return { pl: net - buyCost, netReceived: net };
    },

    get realizedSummary() {
      let totalProfit = 0, totalLoss = 0;
      for (const t of this.soldTransactions) {
        const { pl } = this.soldPL(t);
        if (pl >= 0) totalProfit += pl;
        else totalLoss += pl;
      }
      return { totalProfit, totalLoss, net: totalProfit + totalLoss };
    },

    holdingProfitRows(holding) {
      const margins = [...PROFIT_MARGINS];
      if (this.portfolioCustomProfit && !margins.includes(Number(this.portfolioCustomProfit))) {
        margins.push(Number(this.portfolioCustomProfit));
        margins.sort((a, b) => a - b);
      }
      return margins.map(m => this.calcTargetRow(holding.qty, holding.buyPrice, m, 'profit', true));
    },

    holdingLossRows(holding) {
      const margins = [...LOSS_MARGINS];
      if (this.portfolioCustomLoss && !margins.includes(Number(this.portfolioCustomLoss))) {
        margins.push(Number(this.portfolioCustomLoss));
        margins.sort((a, b) => a - b);
      }
      return margins.map(m => this.calcTargetRow(holding.qty, holding.buyPrice, m, 'loss', true));
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

    fmt,
  }));
});
