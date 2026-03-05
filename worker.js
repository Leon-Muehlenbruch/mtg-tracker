// MTG Tracker Proxy - Cloudflare Worker with Browser Rendering
// Uses real headless browser to bypass Cloudflare bot protection on melee.gg

import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Tournament/View: fetch HTML directly (public page, no auth needed at HTML level)
      if (path.startsWith('/Tournament/View/')) {
        const resp = await fetch('https://melee.gg' + path, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        });
        const body = await resp.text();
        return new Response(body, {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'text/html' }
        });
      }

      // GetStandingsConfig: public, no auth
      if (path.startsWith('/Standing/GetStandingsConfig/')) {
        const resp = await fetch('https://melee.gg' + path, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        const body = await resp.text();
        return new Response(body, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // GetRoundStandings: use headless browser to bypass bot protection
      if (path === '/Standing/GetRoundStandings') {
        const body = await request.text();
        const params = new URLSearchParams(body);
        const roundId = params.get('roundId');
        const tid = params.get('tid') || '392336';

        if (!roundId) {
          return new Response(JSON.stringify({error: 'Missing roundId'}), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Launch headless browser
        const browser = await puppeteer.launch(env.BROWSER);
        const page = await browser.newPage();

        try {
          // First visit tournament page to establish session
          await page.goto(`https://melee.gg/Tournament/View/${tid}`, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
          });

          // Now make the API call from within the browser context (has valid session/cookies)
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

          return new Response(result, {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        } catch(e) {
          await browser.close();
          throw e;
        }
      }

      return new Response(JSON.stringify({error: 'Not found'}), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch(e) {
      return new Response(JSON.stringify({error: e.message}), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
