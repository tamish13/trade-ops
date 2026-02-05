const fs = require('fs');
const path = require('path');

const DATA_DIR = '/tmp';
const STATE_FILE = path.join(DATA_DIR, 'session_state.json');

// --- MARKET MATH ---
function getPriceAtTime(timestamp) {
    let seed = Math.floor(timestamp / 1000); 
    const a = 1664525; const c = 1013904223; const m = 4294967296;
    let state = seed; state = (a * state + c) % m; let random = state / m; 
    
    const hourTrend = Math.sin(timestamp / 3600000) * 0.0050;
    const minTrend = Math.cos(timestamp / 300000) * 0.0010;
    const noise = (random - 0.5) * 0.0005;
    
    return 1.1000 + hourTrend + minTrend + noise;
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
            activeTrade: null,
            history: [],
            lastTick: Date.now(),
            autoMode: false // NEW: Auto-Trading Toggle
        };
    }

    loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) {}
        return null;
    }

    saveState() {
        try { fs.writeFileSync(STATE_FILE, JSON.stringify(this.state)); } catch (e) {}
    }

    tick() {
        const now = Date.now();
        const price = getPriceAtTime(now);
        
        // 1. UPDATE ACTIVE TRADE PnL & EQUITY
        if (this.state.activeTrade) {
            const t = this.state.activeTrade;
            
            // PnL Calc: (Diff / Sensitivity) * Amount
            const diff = t.type === 'CALL' ? price - t.entry : t.entry - price;
            const sensitivity = 0.0010; // 10 pips = 100% PnL range
            const pnlPercent = diff / sensitivity;
            t.pnl = t.amount * pnlPercent;
            
            // Equity = Current Cash + Locked Margin + Unrealized PnL
            this.state.equity = Number((this.state.balance + t.amount + t.pnl).toFixed(2));

            // 2. STOP LOSS / TAKE PROFIT (Atomic Check)
            // TP: 100%, SL: -90% (Let it ride longer)
            if (t.pnl >= t.amount * 1.0 || t.pnl <= -t.amount * 0.9) {
                this.trade('CLOSE');
            }
        } else {
            this.state.equity = this.state.balance;
        }

        // 3. AUTOPILOT ENTRY LOGIC (If no trade)
        if (this.state.autoMode && !this.state.activeTrade) {
            // Trend Following: If price is above Moving Avg (simulated by trend component)
            // We use the trend component from the price generator implicitly
            // Simple logic: If price ends in high digits, sell? No, let's use Momentum.
            // Since we don't have history in engine, we use random with bias.
            // 10% chance to enter per tick
            if (Math.random() < 0.10) {
                // Bias towards mean reversion (1.1000)
                const type = price > 1.1005 ? 'PUT' : (price < 1.0995 ? 'CALL' : (Math.random() > 0.5 ? 'CALL' : 'PUT'));
                this.trade('OPEN', { type, amount: 100 }); 
            }
        }
        
        this.state.lastTick = now;
        this.saveState();
        return { price, timestamp: now };
    }

    trade(action, payload) {
        const now = Date.now();
        const price = getPriceAtTime(now);

        if (action === 'OPEN') {
            const { type, amount } = payload;
            const tradeAmount = parseFloat(amount);
            
            if (tradeAmount > this.state.balance) return { error: "Insufficient funds" };
            
            // DEDUCT BALANCE IMMEDIATELY (Lock Margin)
            this.state.balance -= tradeAmount;
            
            // Support Multi-Trades (Upgrade state structure on the fly if needed, or just push)
            // But resetState defines activeTrades as [] now.
            // Wait, previous state had activeTrade: null. We need to migrate or just use array.
            
            // Migration logic for old state
            if (!this.state.activeTrades) this.state.activeTrades = [];
            if (this.state.activeTrade) {
                this.state.activeTrades.push(this.state.activeTrade);
                this.state.activeTrade = null;
            }

            const trade = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
                type, 
                entry: price, 
                amount: tradeAmount, 
                startTime: now, 
                pnl: 0
            };
            this.state.activeTrades.push(trade);
        }
        
        if (action === 'CLOSE') {
            // Closes specific trade ID or ALL if not specified? 
            const { tradeId } = payload || {};
            
            if (!this.state.activeTrades) this.state.activeTrades = [];
            
            let toClose = [];
            if (tradeId) {
                const idx = this.state.activeTrades.findIndex(t => t.id === tradeId);
                if (idx !== -1) toClose.push(this.state.activeTrades[idx]);
            } else {
                toClose = [...this.state.activeTrades];
            }

            if (toClose.length === 0) return { error: "No active trades to close" };

            toClose.forEach(t => {
                const payout = t.amount + t.pnl;
                this.state.balance += payout;
                this.state.history.unshift({ ...t, exit: price, closeTime: now });
            });

            // Remove closed from active
            const closedIds = toClose.map(t => t.id);
            this.state.activeTrades = this.state.activeTrades.filter(t => !closedIds.includes(t.id));
            
            // Recalc Equity
            let floatPnL = 0;
            let locked = 0;
            this.state.activeTrades.forEach(t => { floatPnL += t.pnl; locked += t.amount; });
            this.state.equity = this.state.balance + locked + floatPnL;
        }

        if (action === 'RESET') this.state = this.resetState();
        
        if (action === 'TOGGLE_AUTO') {
            this.state.autoMode = !this.state.autoMode;
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
