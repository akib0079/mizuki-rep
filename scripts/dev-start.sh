#!/usr/bin/env bash
#
# Start everything needed to run Mizuki locally: MongoDB, the API, the studio console and the
# student widget.
#
# Each service is started with `setsid` so it lands in its own process group. Started any other
# way they share a group with the shell, and anything that signals that group — closing the
# terminal, a tool that cleans up after itself — takes the whole stack down together, including
# a mongod that was supposedly daemonised with --fork.
#
# Usage:  ./scripts/dev-start.sh          then  ./scripts/dev-stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${MIZUKI_DEV_DIR:-$HOME/.mizuki-dev}"
LOG_DIR="$RUN_DIR/logs"
DATA_DIR="$RUN_DIR/mongo-data"

mkdir -p "$LOG_DIR" "$DATA_DIR"

# The test suite downloads a real mongod; reuse it rather than asking anyone to install one.
MONGOD="$(find "$ROOT/node_modules/.cache/mongodb-memory-server" -maxdepth 1 -type f -name 'mongod*' 2>/dev/null | head -1)"
if [ -z "$MONGOD" ]; then
  echo "No mongod binary found. Run 'npm test' once to download one, or install MongoDB." >&2
  exit 1
fi

port_busy() { lsof -ti:"$1" >/dev/null 2>&1; }

# Put a service in its own session so it outlives this shell.
#
# `setsid` is a Linux utility and does not exist on macOS, so fall back to perl, which ships
# with macOS and exposes POSIX::setsid. Without one of the two, everything started here shares
# a process group with the shell and dies together the moment anything signals that group.
if command -v setsid >/dev/null 2>&1; then
  detach() { setsid "$@"; }
elif command -v perl >/dev/null 2>&1; then
  detach() { perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec: $!"' -- "$@"; }
else
  echo "Neither setsid nor perl is available; services may stop when this shell exits." >&2
  detach() { "$@"; }
fi

start_detached() { # name, logfile, command...
  local name="$1" log="$2"; shift 2
  detach "$@" > "$log" 2>&1 < /dev/null &
  echo "$!" > "$RUN_DIR/$name.pid"
}

# --- MongoDB ----------------------------------------------------------------
# A single-node replica set, not a standalone: transactions only exist on a replica set, and
# running without one locally would exercise a different code path from production.
if port_busy 27017; then
  echo "  mongodb   already running on 27017"
else
  start_detached mongod "$LOG_DIR/mongod.log" \
    "$MONGOD" --dbpath "$DATA_DIR" --port 27017 --replSet rs0 --bind_ip 127.0.0.1
  for _ in $(seq 1 40); do port_busy 27017 && break; sleep 0.5; done
  port_busy 27017 || { echo "mongod failed to start — see $LOG_DIR/mongod.log" >&2; exit 1; }
  echo "  mongodb   started on 27017"
fi

# Promote the set and wait for a primary. Run from the repo root so `require('mongodb')`
# resolves through the project's own node_modules rather than a hardcoded path.
# Initiating an already-initiated set is a harmless error, so this stays safe to re-run.
( cd "$ROOT" && node -e "
const { MongoClient } = require('mongodb')
;(async () => {
  const c = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true')
  await c.connect()
  try {
    await c.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] } })
  } catch {}
  for (let i = 0; i < 40; i++) {
    const r = await c.db('admin').command({ hello: 1 })
    if (r.isWritablePrimary || r.ismaster) break
    await new Promise((res) => setTimeout(res, 500))
  }
  await c.close()
})()
" ) 2>/dev/null || true

# --- Application ------------------------------------------------------------
for svc in "api:4000:dev:api" "admin:5173:dev:admin" "widget:5174:dev:widget"; do
  name="${svc%%:*}"; rest="${svc#*:}"; port="${rest%%:*}"; script="${rest#*:}"
  if port_busy "$port"; then
    echo "  $name    already running on $port"
  else
    start_detached "$name" "$LOG_DIR/$name.log" npm --prefix "$ROOT" run "$script"
    echo "  $name    starting on $port"
  fi
done

for _ in $(seq 1 60); do curl -sf http://localhost:4000/health >/dev/null 2>&1 && break; sleep 0.5; done

cat <<EOF

  Student booking   http://localhost:5174
  Studio console    http://localhost:5173
  API               http://localhost:4000/health

  Logs   $LOG_DIR
  Stop   ./scripts/dev-stop.sh

EOF
