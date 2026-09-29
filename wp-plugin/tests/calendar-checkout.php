<?php
require __DIR__ . '/wordpress-stubs.php';
require dirname( __DIR__ ) . '/mizuki-booking-bridge/mizuki-booking-bridge.php';
require __DIR__ . '/woocommerce-stubs.php';

function expect_checkout( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}

$GLOBALS['mzk_post_meta'][3060][MIZUKI_CALENDAR_PRODUCT_META] = 'yes';
$GLOBALS['mzk_notices'] = array();
expect_checkout( ! mizuki_require_calendar_booking( true, 3060, 1 ), 'Direct product purchase bypassed calendar' );
expect_checkout( count( $GLOBALS['mzk_notices'] ) === 1, 'Missing calendar instruction' );
expect_checkout( mizuki_require_calendar_booking( true, 2170, 1 ), 'Ordinary product was blocked' );

$_GET[MIZUKI_SESSION_PARAM] = 'aaaaaaaaaaaaaaaaaaaaaaaa';
$_GET[MIZUKI_HOLD_PARAM] = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
$_GET[MIZUKI_PARTY_PARAM] = '2';
$GLOBALS['mzk_remote_body'] = '{"valid":true}';
expect_checkout( mizuki_require_calendar_booking( true, 3060, 2 ), 'Verified two person hold was blocked' );
expect_checkout( ! mizuki_require_calendar_booking( true, 3060, 1 ), 'Wrong participant count was allowed' );
$GLOBALS['mzk_remote_body'] = '{"valid":false}';
expect_checkout( ! mizuki_require_calendar_booking( true, 3060, 2 ), 'Rejected hold was allowed' );
echo "Calendar product checkout guard passed.\n";
