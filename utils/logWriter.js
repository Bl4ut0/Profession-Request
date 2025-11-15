const fs = require('fs');
const path = require('path');
const config = require('../config/config.js');

const logDir = path.join(__dirname, '../logs');
const logFilePath = path.join(logDir, 'bot.log');

// Ensure the logs directory exists
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  if (config.debugMode) console.log(`[INIT] Created logs directory at ${logDir}`);
}

function write(type, message, data) {
  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${type.toUpperCase()}] ${message}`;

  if (data) {
    if (data instanceof Error) {
      line += `\n${data.stack}`;
    } else {
      line += ` ${JSON.stringify(data, null, 2)}`;
    }
  }

  line += '\n';

  fs.appendFile(logFilePath, line, err => {
    if (err) {
      console.error(`❌ Failed to write to log: ${err.message}`);
    }
  });

  const consoleLine = `[${type.toUpperCase()}] ${message}`;
  if (type === 'error') {
    console.error(consoleLine);
    if (data) console.error(data);
  } else if (type === 'warn') {
    console.warn(consoleLine);
    if (data) console.warn(data);
  } else if (config.debugMode) {
    console.log(consoleLine);
    if (data) console.log(data);
  }
}

module.exports = {
  info: (msg, data) => write('info', msg, data),
  warn: (msg, data) => write('warn', msg, data),
  error: (msg, data) => write('error', msg, data),
  debug: (msg, data) => {
    if (config.debugMode) {
      write('debug', msg, data);
    }
  },
};
