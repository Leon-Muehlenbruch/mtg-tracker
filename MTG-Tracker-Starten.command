#!/bin/bash
cd "$(dirname "$0")"
echo "🃏 MTG Tracker wird gestartet..."
if ! command -v node &> /dev/null; then
  echo "❌ Node.js nicht gefunden! Bitte von https://nodejs.org/ installieren."
  read -p "Enter drücken..."
  exit 1
fi
node server.js &
SERVER_PID=$!
sleep 2
open "https://mtg-tracker-1ha.pages.dev"
echo "✅ Server läuft. Dieses Fenster offen lassen! Zum Beenden: Strg+C"
wait $SERVER_PID
