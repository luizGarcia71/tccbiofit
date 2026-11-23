#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "O Node.js não está instalado. Baixe a versão LTS em https://nodejs.org e tente de novo."
  echo ""
  exit 1
fi
( sleep 1; (command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) ) >/dev/null 2>&1 &
exec node server.js
