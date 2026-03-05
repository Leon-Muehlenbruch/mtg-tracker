#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const PORT = 3333;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

// Cache für Standings die vom Browser gesendet werden
const standingsCache = {};

// Direkt melee.gg fetchen (für Tournament HTML - öffentliche Seite)
function fetchDirect(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'melee.gg', path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  console.log(`→ ${req.method} ${path}`);

  try {
    // Serve the app itself
    if (path === '/' || path === '/index.html') {
      const fp = __dirname + '/index.html';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(fp, 'utf8'));
      return;
    }

    if (path === '/ping') {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/plain' });
      res.end('ok'); return;
    }

    if (path === '/players.txt') {
      const fp = __dirname + '/players.txt';
      if (fs.existsSync(fp)) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(fs.readFileSync(fp, 'utf8'));
      } else {
        res.writeHead(404, corsHeaders); res.end('');
      }
      return;
    }

    if (path.startsWith('/Tournament/View/')) {
      const { status, body } = await fetchDirect(path);
      // Wenn 403, gib gecachte Daten zurück falls vorhanden
      if (status === 403) {
        res.writeHead(403, { ...corsHeaders, 'Content-Type': 'text/html' });
        res.end(body); return;
      }
      res.writeHead(status, { ...corsHeaders, 'Content-Type': 'text/html' });
      res.end(body); return;
    }

    if (path === '/Standing/GetRoundStandings') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const params = new URLSearchParams(body);
        const roundId = params.get('roundId');
        const tid = params.get('tid') || '';

        if (!roundId) { res.writeHead(400, corsHeaders); res.end(JSON.stringify({error:'Missing roundId'})); return; }

        // Fetch mit Session-Cookies falls mitgegeben
        const cookies = params.get('cookies') || req.headers['x-melee-cookies'] || '';
        
        console.log(`  roundId=${roundId} tid=${tid}`);
        
        const postData = `draw=1&start=0&length=3000&order%5B0%5D%5Bcolumn%5D=0&order%5B0%5D%5Bdir%5D=asc&roundId=${roundId}`;
        
        const result = await new Promise((resolve, reject) => {
          const postReq = https.request({
            hostname: 'melee.gg',
            path: '/Standing/GetRoundStandings',
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'Content-Length': Buffer.byteLength(postData),
              'Accept': 'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Referer': `https://melee.gg/Tournament/View/${tid}`,
              'Origin': 'https://melee.gg',
              ...(cookies ? { 'Cookie': cookies } : {}),
            }
          }, res2 => {
            let d = '';
            res2.on('data', c => d += c);
            res2.on('end', () => resolve(d));
          });
          postReq.on('error', reject);
          postReq.write(postData);
          postReq.end();
        });

        console.log(`  ✅ ${result.length} Bytes`);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(result);
      });
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

server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   MTG Tracker - Lokaler Proxy Server   ║');
  console.log(`║   http://localhost:${PORT}              ║`);
  console.log('╚════════════════════════════════════════╝\n');
  console.log('🟢 Bereit!\n');
});
