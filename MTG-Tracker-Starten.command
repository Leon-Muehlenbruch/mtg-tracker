#!/bin/bash
cd "$(dirname "$0")"
echo "🃏 MTG Tracker wird gestartet..."
if ! command -v node &> /dev/null; then
  echo "❌ Node.js nicht gefunden! Bitte von https://nodejs.org/ installieren."
  read -p "Enter drücken..."
  exit 1
fi
# Alten Server beenden falls noch läuft
lsof -ti:3333 | xargs kill -9 2>/dev/null
node server.js &
SERVER_PID=$!
sleep 2
open "http://localhost:3333"
echo "✅ Server läuft. Dieses Fenster offen lassen! Zum Beenden: Strg+C"
wait $SERVER_PID
