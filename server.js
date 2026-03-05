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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

async function fetchWithBrowser(tournamentId, roundId) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
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

    await browser.close();
    return result;
  } catch(e) {
    await browser.close();
    throw e;
  }
}

function fetchTournamentHtml(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'melee.gg',
      path: path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
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
