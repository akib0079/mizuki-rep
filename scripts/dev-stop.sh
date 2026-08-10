#!/usr/bin/env bash
#
# Stop everything dev-start.sh started, leaving the database contents alone.
set -uo pipefail

RUN_DIR="${MIZUKI_DEV_DIR:-$HOME/.mizuki-dev}"

for port in 4000 5173 5174; do
  pids="$(lsof -ti:"$port" 2>/dev/null)"
  [ -n "$pids" ] && kill $pids 2>/dev/null && echo "  stopped whatever held $port"
done

# SIGTERM, never SIGKILL: mongod flushes and checkpoints on a clean shutdown, and killing it
# outright risks leaving the data directory needing repair on next start.
pids="$(lsof -ti:27017 2>/dev/null)"
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null
  for _ in $(seq 1 20); do lsof -ti:27017 >/dev/null 2>&1 || break; sleep 0.5; done
  echo "  stopped mongodb (data kept in $RUN_DIR/mongo-data)"
fi

rm -f "$RUN_DIR"/*.pid 2>/dev/null
echo "  done"
