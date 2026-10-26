// Optional external watchdog. Run this in a second terminal after `npm run pm2:start`.
// It never kills the clinic process itself; it asks PM2 to restart it only when the
// HTTP health endpoint cannot be reached for several consecutive probes.
require('dotenv').config();
const { exec } = require('child_process');
const URL = process.env.WATCHDOG_URL || `http://127.0.0.1:${process.env.PORT || 3000}/api/health`;
const INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS || 15000);
const FAILURES_BEFORE_RESTART = Number(process.env.WATCHDOG_FAILURES || 3);
const RESTART_COOLDOWN_MS = 120000;
let failures = 0;
let lastRestartAt = 0;
let checking = false;

async function probe() {
  if (checking) return;
  checking = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(URL, { signal: controller.signal, cache: 'no-store' });
    // A 503 can mean MongoDB is disconnected while Node/Express is still alive.
    // Log it, but don't restart the process for a database-only problem.
    if (response.status === 503) {
      failures = 0;
      console.warn(`[watchdog] HTTP is responding but health is degraded (${response.status}); not restarting process.`);
    } else if (!response.ok) {
      failures += 1;
      console.warn(`[watchdog] Health probe returned ${response.status} (${failures}/${FAILURES_BEFORE_RESTART}).`);
    } else {
      failures = 0;
      console.log(`[watchdog] OK ${new Date().toLocaleTimeString()}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`[watchdog] Health endpoint unreachable (${failures}/${FAILURES_BEFORE_RESTART}): ${error.message}`);
  } finally {
    clearTimeout(timeout);
    checking = false;
  }
  if (failures >= FAILURES_BEFORE_RESTART) {
    if (Date.now() - lastRestartAt < RESTART_COOLDOWN_MS) {
      console.error('[watchdog] Restart cooldown active; waiting for next probe.');
      return;
    }
    lastRestartAt = Date.now();
    failures = 0;
    console.error('[watchdog] Service unreachable repeatedly; requesting PM2 restart medisync.');
    exec('pm2 restart medisync', { windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) console.error(`[watchdog] PM2 restart failed: ${error.message}. Is PM2 installed and the medisync process running?`);
      else console.log(`[watchdog] PM2 restart command completed. ${String(stdout || stderr).trim()}`);
    });
  }
}
console.log(`[watchdog] Monitoring ${URL} every ${INTERVAL_MS} ms. Stop with Ctrl+C.`);
probe();
setInterval(probe, INTERVAL_MS);
