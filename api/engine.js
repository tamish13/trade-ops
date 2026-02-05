const fs = require('fs');
const path = require('path');

const DATA_DIR = '/tmp';
const STATE_FILE = path.join(DATA_DIR, 'session_state.json');

// --- MARKET MATH ---
// Seeded random walk that looks like Forex
function getPriceAtTime(timestamp) {
    let seed = Math.floor(timestamp / 1000); // 1s resolution
    const a = 1664525;
    const c = 1013904223;
    const m = 4294967296;
    let state = seed;
    state = (a * state + c) % m;
    let random = state / m; 
    
    // Trend components
    const hourTrend = Math.sin(timestamp / 3600000) * 0.0050; // Long wave
    const minTrend = Math.cos(timestamp / 300000) * 0.0010;   // Short wave
    const noise = (random - 0.5) * 0.0005;                    // Jitter
    
    return 1.1000 + hourTrend + minTrend + noise; // EUR/USD base
}

// --- ENGINE CLASS ---
class TradeEngine {
    constructor() {
        this.state = this.loadState() || this.resetState();
    }

    resetState() {
        return {
            balance: 10000.00,
            equity: 10000.00,
            activeTrade: null, // Only 1 active trade allowed for simplicity/focus
            history: [],
            lastTick: Date.now()
        };
    }

    loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            }
        } catch (e) { console.error("Load Error", e); }
        return null;
    }

    saveState() {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state));
        } catch (e) { console.error("Save Error", e); }
    }

    tick() {
        const now = Date.now();
        const price = getPriceAtTime(now);
        
        // PnL Update
        if (this.state.activeTrade) {
            const t = this.state.activeTrade;
            let diff = 0;
            if (t.type === 'CALL') diff = price - t.entry;
            if (t.type === 'PUT') diff = t.entry - price;
            
            // Forex logic: 1 pip = 0.0001
            // Simple PnL: (Diff / Price) * Leverage? 
            // Let's stick to simple "Contract Difference" * Multiplier
            // Multiplier = Amount / 0.0002 (Sensitivity)
            // If price moves 0.0002 (2 pips), you gain/lose 100% (High risk mode)
            const sensitivity = 0.0005; // 5 pips
            const pnlPercent = diff / sensitivity; 
            t.pnl = t.amount * pnlPercent;
            
            this.state.equity = this.state.balance + t.pnl;
        } else {
            this.state.equity = this.state.balance;
        }
        
        this.state.lastTick = now;
        this.saveState();
        return { price, timestamp: now };
    }

    trade(action, payload) {
        const now = Date.now();
        const price = getPriceAtTime(now);

        if (action === 'OPEN') {
            if (this.state.activeTrade) return { error: "Trade already active" };
            const { type, amount } = payload;
            
            if (amount > this.state.balance) return { error: "Insufficient funds" };
            
            this.state.activeTrade = {
                id: Date.now().toString(36),
                type: type, // CALL / PUT
                entry: price,
                amount: parseFloat(amount),
                startTime: now,
                pnl: 0
            };
            // Margin lock? Let's just track equity.
        }
        
        if (action === 'CLOSE') {
            if (!this.state.activeTrade) return { error: "No active trade" };
            
            const t = this.state.activeTrade;
            this.state.balance += t.pnl;
            this.state.history.unshift({ ...t, exit: price, closeTime: now });
            this.state.activeTrade = null;
            this.state.equity = this.state.balance;
        }

        if (action === 'RESET') {
            this.state = this.resetState();
        }

        this.saveState();
        return this.getState(price);
    }

    getState(currentPrice) {
        return {
            price: currentPrice || getPriceAtTime(Date.now()),
            timestamp: Date.now(),
            account: this.state
        };
    }
}

module.exports = new TradeEngine();
