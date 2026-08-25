#!/usr/bin/env bash
#
# Build a throwaway WordPress with the real Elementor, install this plugin into it, and check it
# does not fall over.
#
# `load-plugin.php` is the cheap check and runs on every build; this is the expensive one, and it
# is the only thing that would have caught what actually broke the studio's site. The widget
# classes extend Elementor's own, and the question of when those become resolvable has no answer
# a stub can give — only Elementor knows, and it turned out not to be when Elementor says it has
# loaded.
#
# Needs the network and about 250MB. Nothing here touches the real site.
#
#   ./wp-plugin/tests/real-wordpress.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="${MIZUKI_TEST_SITE:-${TMPDIR:-/tmp}/mizuki-wp-test}"
PORT="${MIZUKI_TEST_PORT:-8899}"

command -v php >/dev/null || { echo "PHP is not installed."; exit 1; }

free_mb=$(df -m "$(dirname "$SITE")" | awk 'NR==2 {print $4}')
if [ "$free_mb" -lt 1000 ]; then
	echo "Only ${free_mb}MB free where the test site would go. Free some space first — this needs about 250MB."
	exit 1
fi

echo "→ Building a WordPress in $SITE"
rm -rf "$SITE"
mkdir -p "$SITE"
cd "$SITE"

curl -sL -o wp-cli.phar https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar
WP="php wp-cli.phar --quiet"

curl -sL https://wordpress.org/latest.tar.gz | tar xz --strip-components=1

# SQLite, so this needs no database server. The drop-in finds the plugin folder on its own, so
# it is copied verbatim — the placeholders in it are inside quotes and substituting them breaks
# the file.
curl -sL -o sqlite.zip https://downloads.wordpress.org/plugin/sqlite-database-integration.zip
unzip -q -o sqlite.zip -d wp-content/plugins
rm sqlite.zip
cp wp-content/plugins/sqlite-database-integration/db.copy wp-content/db.php

cat > wp-config.php <<'PHP'
<?php
define( 'DB_NAME', 'wordpress' ); define( 'DB_USER', '' ); define( 'DB_PASSWORD', '' );
define( 'DB_HOST', 'localhost' ); define( 'DB_CHARSET', 'utf8' ); define( 'DB_COLLATE', '' );
define( 'AUTH_KEY', 'a' ); define( 'SECURE_AUTH_KEY', 'b' ); define( 'LOGGED_IN_KEY', 'c' );
define( 'NONCE_KEY', 'd' ); define( 'AUTH_SALT', 'e' ); define( 'SECURE_AUTH_SALT', 'f' );
define( 'LOGGED_IN_SALT', 'g' ); define( 'NONCE_SALT', 'h' );
$table_prefix = 'wp_';

/* Everything on and nothing hidden: the point of this install is to see failures. */
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', __DIR__ . '/debug.log' );
define( 'WP_DEBUG_DISPLAY', true );
@ini_set( 'display_errors', 1 );
/* Off, so a fatal stays a fatal instead of a polite recovery page that hides the reason. */
define( 'WP_DISABLE_FATAL_ERROR_HANDLER', true );

if ( ! defined( 'ABSPATH' ) ) { define( 'ABSPATH', __DIR__ . '/' ); }
require_once ABSPATH . 'wp-settings.php';
PHP

echo "→ Installing WordPress and Elementor"
$WP core install --url="http://localhost:$PORT" --title="Mizuki plugin test" \
	--admin_user=admin --admin_password=admin --admin_email=test@example.test --skip-email
$WP plugin install elementor --activate

echo "→ Installing this plugin"
cp -R "$ROOT/wp-plugin/mizuki-booking-bridge" wp-content/plugins/
$WP plugin activate mizuki-booking-bridge
$WP option update mizuki_booking_settings --format=json '{"api_base":"http://localhost:4000","webhook_secret":"test"}'

echo "→ Checking it inside real Elementor"
: > debug.log
cp "$ROOT/wp-plugin/tests/elementor-checks.php" ./elementor-checks.php
php wp-cli.phar eval-file elementor-checks.php

if grep -q "Mizuki Booking:" debug.log 2>/dev/null; then
	echo
	echo "The plugin logged a failure of its own:"
	grep "Mizuki Booking:" debug.log
	exit 1
fi

echo "→ Loading pages over HTTP"
php -S "localhost:$PORT" -t . > server.log 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
sleep 3

curl -s -c cookies.txt -o /dev/null -m 60 \
	-d "log=admin&pwd=admin&wp-submit=Log+In&redirect_to=http://localhost:$PORT/wp-admin/&testcookie=1" \
	"http://localhost:$PORT/wp-login.php"

fail=0
for path in "/" "/wp-admin/" "/wp-admin/plugins.php" "/wp-admin/admin.php?page=elementor"; do
	code=$(curl -s -b cookies.txt -o body.html -w '%{http_code}' -m 60 "http://localhost:$PORT$path")
	if [ "$code" != "200" ] || grep -qiE "Fatal error|Uncaught|critical error" body.html; then
		echo "  FAIL  $path -> HTTP $code"
		grep -oiE "Fatal error[^<]{0,200}|Uncaught[^<]{0,200}" body.html | head -2
		fail=1
	else
		echo "  ok    $path"
	fi
done

if grep -q "Mizuki Booking:" debug.log 2>/dev/null; then
	echo "  FAIL  the plugin logged a failure while serving pages:"
	grep "Mizuki Booking:" debug.log
	fail=1
fi

echo
if [ "$fail" -ne 0 ]; then
	echo "Something is wrong. The site is left at $SITE to look at."
	exit 1
fi
echo "Real WordPress, real Elementor: the plugin activates, registers, renders and serves pages."
echo "The site is at $SITE — delete it when you are done."
