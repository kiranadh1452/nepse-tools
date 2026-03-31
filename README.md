# NEPSE Tools

A collection of mini tools for NEPSE (Nepal Stock Exchange) investors. Built with vanilla JS, Alpine.js, and Tailwind CSS — hosted on GitHub Pages.

**Live:** [kiranadh1452.github.io/nepse-tools](https://kiranadh1452.github.io/nepse-tools/)

## Tools

### Trade Calculator

Calculates profit/loss, WACC (Weighted Average Cost of Capital), and break-even price for NEPSE trades with all charges factored in.

- Broker commission (slab-based)
- SEBON fee (0.015%)
- DP charge (NPR 25 per side)
- Capital Gains Tax (7.5%)
- Break-even sell price
- Real-time calculations as you type

### Risk Calculator

Stop loss levels, profit targets, risk-reward ratios, and portfolio tracking with localStorage persistence.

**Quick Mode:**
- Profit targets at preset margins (3, 5, 7, 8, 10, 12, 15, 20, 25%) + custom
- Stop loss levels at preset margins (5, 7, 10%) + custom
- Risk-reward ratio matrix
- Break-even price

**Portfolio Mode:**
- Add, edit, delete holdings (persisted in localStorage)
- Partial sell support with individual transaction history
- Realized P/L dashboard (profit, loss, net breakdown)
- Searchable holdings with toggleable profit/stop loss tables

**Global Toggles:**
- Include/exclude NEPSE charges
- Include/exclude tax with holding period input (short-term 7.5% for ≤365 days, long-term 5% for >365 days)

## Setup

```bash
# Install dependencies
npm install

# Build CSS
npm run build:css

# Watch for changes during development
npm run watch:css
```

After cloning, activate the pre-commit hook:

```bash
git config core.hooksPath .hooks
```

This automatically rebuilds the Tailwind CSS before each commit.

## Tech Stack

- Vanilla JavaScript + [Alpine.js](https://alpinejs.dev/) (no build step for JS)
- [Tailwind CSS v4](https://tailwindcss.com/) (pre-built, 22KB minified)
- Static hosting on GitHub Pages

## Disclaimer

These tools are for informational purposes only. Always verify calculations independently before making investment decisions.
