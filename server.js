#!/usr/bin/env node
// MTG Tracker - Lokaler Proxy Server
// Startet einen Browser im Hintergrund und ruft melee.gg auf
// Starten mit: node server.js

const http = require('http');
const fs = require('fs');
const https = require('https');
const { execSync, exec } = require('child_process');

const PORT = 3333;

// Installiere playwright falls nötig
function ensurePlaywright() {
  try {
    require('playwright');
    return true;
  } catch(e) {
    console.log('📦 Installiere playwright (einmalig, ~100MB)...');
    execSync('npm install playwright', { cwd: __dirname, stdio: 'inherit' });
    execSync('npx playwright install chromium', { cwd: __dirname, stdio: 'inherit' });
    return true;
  }
}

// Persistenter Browser - wird einmal gestartet und wiederverwendet
let _browser = null;
async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    const { chromium } = require('playwright');
    console.log('  🌐 Starte Browser...');
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

async function fetchWithBrowser(tournamentId, roundId) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  try {
    console.log(`  🌐 Öffne Turnier ${tournamentId}...`);
    await page.goto(`https://melee.gg/Tournament/View/${tournamentId}`, {
      waitUntil: 'domcontentloaded', timeout: 15000
    });

    console.log(`  📊 Lade Standings für Round ${roundId}...`);
    const result = await page.evaluate(async (roundId) => {
      const resp = await fetch('/Standing/GetRoundStandings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: `draw=1&start=0&length=3000&order%5B0%5D%5Bcolumn%5D=0&order%5B0%5D%5Bdir%5D=asc&roundId=${roundId}`
      });
      return resp.text();
    }, roundId);

    await page.close();
    return result;
  } catch(e) {
    await page.close();
    throw e;
  }
}

async function fetchTournamentHtml(path) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const resp = await page.goto('https://melee.gg' + path, {
      waitUntil: 'domcontentloaded', timeout: 15000
    });
    const body = await page.content();
    const status = resp ? resp.status() : 200;
    await page.close();
    return { status, body };
  } catch(e) {
    await page.close();
    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`→ ${req.method} ${path}`);

  try {
    // Tournament HTML (für Runden-IDs)
    if (path.startsWith('/Tournament/View/')) {
      const { status, body } = await fetchTournamentHtml(path);
      res.writeHead(status, { ...corsHeaders, 'Content-Type': 'text/html' });
      res.end(body);
      return;
    }

    // GetStandingsConfig
    if (path.startsWith('/Standing/GetStandingsConfig/')) {
      const { status, body } = await fetchTournamentHtml(path);
      res.writeHead(status, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    // GetRoundStandings - Playwright Browser
    if (path === '/Standing/GetRoundStandings') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const params = new URLSearchParams(body);
          const roundId = params.get('roundId');
          const tid = params.get('tid') || '392401';
          
          if (!roundId) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Missing roundId' }));
            return;
          }

          console.log(`  roundId=${roundId} tid=${tid}`);
          const result = await fetchWithBrowser(tid, roundId);
          console.log(`  ✅ ${result.length} Bytes empfangen`);
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(result);
        } catch(e) {
          console.error('  ❌ Fehler:', e.message);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // players.txt - lese lokale Datei
    if (path === '/players.txt') {
      const filePath = __dirname + '/players.txt';
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
      } else {
        res.writeHead(404, corsHeaders);
        res.end('');
      }
      return;
    }

    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch(e) {
    console.error('Fehler:', e.message);
    res.writeHead(500, corsHeaders);
    res.end(JSON.stringify({ error: e.message }));
  }
});

// Start
ensurePlaywright();
server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   MTG Tracker - Lokaler Proxy Server   ║');
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log('╠════════════════════════════════════════╣');
  console.log('║  Lass dieses Fenster offen während     ║');
  console.log('║  du den Tracker verwendest.            ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
  console.log('🟢 Bereit! Öffne jetzt den Tracker im Browser.');
  console.log('');
});
