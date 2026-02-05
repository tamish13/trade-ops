const engine = require('./engine');

module.exports = (req, res) => {
    const { action, ...payload } = req.body || {};
    
    // Always tick logic first
    const market = engine.tick();
    
    if (req.method === 'POST') {
        const result = engine.trade(action, payload);
        if (result.error) return res.status(400).json(result);
        return res.json(result);
    }

    // GET: Return full state + history for chart
    // Simulate last 60 seconds history for chart init
    const history = [];
    const now = Date.now();
    for (let i = 60; i > 0; i--) {
        // We reuse the engine's math function exposed indirectly?
        // Let's just import the generator if needed, but for now client can build history
        // Actually, better to send it so chart isn't empty.
    }

    res.json(engine.getState(market.price));
};
