const config = require('./env');

function writeLog(level, message, meta = {}) {
  if (config.nodeEnv === 'test' && process.env.LOG_IN_TEST !== 'true') {
    return;
  }
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'freshguard-backend',
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

module.exports = {
  info: (msg, meta) => writeLog('info', msg, meta),
  warn: (msg, meta) => writeLog('warn', msg, meta),
  error: (msg, meta) => writeLog('error', msg, meta),
};
