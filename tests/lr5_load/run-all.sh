#!/usr/bin/env bash
# Прогоняет load, stress и spike по очереди. Для каждого теста сервер запускается заново,
# память процесса (RSS) пишется раз в 5 секунд.
# Запуск из папки shop-cart: bash tests/lr5_load/run-all.sh [load stress spike]
set -u
cd "$(dirname "$0")/../.."
OUT=tests/lr5_load/results
mkdir -p "$OUT/raw"
TESTS=("${@:-load stress spike}")
[ $# -eq 0 ] && TESTS=(load stress spike)

for name in "${TESTS[@]}"; do
  echo "=== $name: старт $(date '+%H:%M:%S')"
  node src/server.js > "$OUT/raw/$name-server.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 1 30); do curl -sf http://127.0.0.1:3000/api/health > /dev/null && break; sleep 0.5; done

  echo "time_s,rss_mb" > "$OUT/$name-memory.csv"
  (
    t=0
    while kill -0 "$SERVER" 2> /dev/null; do
      rss=$(ps -o rss= -p "$SERVER" | tr -d ' ')
      [ -n "$rss" ] && echo "$t,$((rss / 1024))" >> "$OUT/$name-memory.csv"
      sleep 5
      t=$((t + 5))
    done
  ) &
  SAMPLER=$!

  K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT="$OUT/$name-dashboard.html" \
    k6 run --summary-export="$OUT/$name-summary.json" --out "json=$OUT/raw/$name.json.gz" \
    "tests/lr5_load/$name.js" > "$OUT/$name-console.txt" 2>&1
  echo "k6 exit code: $?" >> "$OUT/$name-console.txt"

  kill "$SERVER" 2> /dev/null
  wait "$SAMPLER" 2> /dev/null
  echo "=== $name: готово $(date '+%H:%M:%S'), $(tail -1 "$OUT/$name-console.txt")"
done
