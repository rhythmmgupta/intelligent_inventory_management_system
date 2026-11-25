const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'freshguard_api_' });

const httpRequestDurationSeconds = new client.Histogram({
  name: 'freshguard_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const mlFallbackCounter = new client.Counter({
  name: 'freshguard_ml_fallback_total',
  help: 'Count of ML service calls that fell back to deterministic moving-average logic',
  registers: [register],
});

const fefoSalesCounter = new client.Counter({
  name: 'freshguard_fefo_sales_total',
  help: 'Count of FEFO sales transactions processed',
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  const end = httpRequestDurationSeconds.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;
    end({
      method: req.method,
      route,
      status_code: String(res.statusCode),
    });
  });
  next();
}

module.exports = {
  register,
  metricsMiddleware,
  mlFallbackCounter,
  fefoSalesCounter,
};
