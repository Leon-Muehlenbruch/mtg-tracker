// MTG Tracker Proxy - Cloudflare Worker
// Uses Claude API with web_search to fetch live standings from melee.gg

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Api-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Pass-through for Tournament/View HTML (public, no auth needed via Cloudflare fetch)
    if (path.startsWith('/Tournament/View/')) {
      try {
        const resp = await fetch('https://melee.gg' + path, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
        });
        const body = await resp.text();
        return new Response(body, {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'text/html' }
        });
      } catch(e) {
        return new Response(JSON.stringify({error: e.message}), {status:500, headers:{...corsHeaders,'Content-Type':'application/json'}});
      }
    }

    // GetStandingsConfig - public endpoint, no auth
    if (path.startsWith('/Standing/GetStandingsConfig/')) {
      try {
        const resp = await fetch('https://melee.gg' + path, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          redirect: 'follow',
        });
        const body = await resp.text();
        return new Response(body, {
          status: resp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch(e) {
        return new Response(JSON.stringify({error: e.message}), {status:500, headers:{...corsHeaders,'Content-Type':'application/json'}});
      }
    }

    // GetRoundStandings - requires Claude API with web_search
    if (path === '/Standing/GetRoundStandings') {
      const apiKey = request.headers.get('X-Api-Key');
      if (!apiKey) {
        return new Response(JSON.stringify({error: 'Missing X-Api-Key header'}), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      let roundId, playerNames, tid;
      if (request.method === 'POST') {
        const body = await request.text();
        const params = new URLSearchParams(body);
        roundId = params.get('roundId');
        playerNames = params.get('playerNames') || '';
        tid = params.get('tid') || '';
      } else {
        roundId = url.searchParams.get('roundId');
        playerNames = url.searchParams.get('playerNames') || '';
        tid = url.searchParams.get('tid') || '';
      }

      if (!roundId) {
        return new Response(JSON.stringify({error: 'Missing roundId'}), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        // Ask Claude to fetch standings via web search
        const tourneyUrl = `https://melee.gg/Tournament/View/${tid}`;
        const prompt = `Go to ${tourneyUrl} and get the current standings. 
I need the standings data for round ID ${roundId}.
For each player in the standings, return their: Rank, Name, Points, MatchRecord (W-L-D), GameRecord, OpponentMatchWinPercentage, TeamGameWinPercentage, OpponentGameWinPercentage, AdvancedToNextPhase.
${playerNames ? `Focus especially on these players: ${playerNames}` : ''}

Return ONLY a valid JSON object with this exact structure, no other text:
{
  "data": [
    {
      "Rank": 1,
      "Team": {"Players": [{"DisplayName": "Player Name"}]},
      "Points": 21,
      "MatchRecord": "7-0-0",
      "GameRecord": "14-2-0", 
      "OpponentMatchWinPercentage": 0.623,
      "TeamGameWinPercentage": 0.714,
      "OpponentGameWinPercentage": 0.598,
      "AdvancedToNextPhase": false
    }
  ]
}`;

        const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8000,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages: [{ role: 'user', content: prompt }]
          })
        });

        const claudeData = await claudeResp.json();
        
        // Extract text from response
        const textBlocks = (claudeData.content || []).filter(b => b.type === 'text');
        const fullText = textBlocks.map(b => b.text).join('');
        
        // Parse JSON from response
        const jsonMatch = fullText.match(/\{[\s\S]*"data"[\s\S]*\}/);
        if (!jsonMatch) {
          return new Response(JSON.stringify({ 
            Error: true, 
            Message: 'Could not extract standings data',
            Debug: fullText.slice(0, 500)
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const standings = JSON.parse(jsonMatch[0]);
        return new Response(JSON.stringify(standings), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

      } catch(e) {
        return new Response(JSON.stringify({error: e.message}), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response(JSON.stringify({error: 'Not found'}), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};
