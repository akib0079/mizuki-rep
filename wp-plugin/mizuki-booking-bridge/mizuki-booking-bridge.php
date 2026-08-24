<?php
/**
 * Plugin Name:       Mizuki Booking Bridge
 * Plugin URI:        https://mizuki.com.sg
 * Description:       Embeds the Mizuki Flora class calendar into WordPress and connects WooCommerce checkout to the booking system, so a paid workshop holds its place until payment lands.
 * Version:           1.2.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Mizuki Flora
 * License:           GPL-2.0-or-later
 * Text Domain:       mizuki-booking
 *
 * This plugin holds no booking data of its own. The booking system is the source of truth for
 * every class, place and course package; WordPress only renders the widget and reports what
 * WooCommerce did with an order.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'MIZUKI_BRIDGE_VERSION', '1.2.0' );
define( 'MIZUKI_BRIDGE_FILE', __FILE__ );

/** Query args carried from the booking widget into the shop. */
const MIZUKI_SESSION_PARAM = 'mizuki_session';
const MIZUKI_HOLD_PARAM    = 'mizuki_hold';

/** Order item meta keys. Underscore-prefixed so they stay hidden from the customer-facing order. */
const MIZUKI_META_SESSION = '_mizuki_session_id';
const MIZUKI_META_HOLD    = '_mizuki_hold_token';

/**
 * -----------------------------------------------------------------------------
 * Settings
 * -----------------------------------------------------------------------------
 */

function mizuki_get_option( $key, $default = '' ) {
	$options = get_option( 'mizuki_booking_settings', array() );
	return isset( $options[ $key ] ) && '' !== $options[ $key ] ? $options[ $key ] : $default;
}

function mizuki_api_base() {
	return untrailingslashit( mizuki_get_option( 'api_base' ) );
}

add_action( 'admin_menu', 'mizuki_add_settings_page' );
function mizuki_add_settings_page() {
	add_options_page(
		__( 'Mizuki Booking', 'mizuki-booking' ),
		__( 'Mizuki Booking', 'mizuki-booking' ),
		'manage_options',
		'mizuki-booking',
		'mizuki_render_settings_page'
	);
}

add_action( 'admin_init', 'mizuki_register_settings' );
function mizuki_register_settings() {
	register_setting(
		'mizuki_booking',
		'mizuki_booking_settings',
		array( 'sanitize_callback' => 'mizuki_sanitize_settings' )
	);
}

function mizuki_sanitize_settings( $input ) {
	return array(
		'api_base'       => esc_url_raw( trim( $input['api_base'] ?? '' ) ),
		'webhook_secret' => sanitize_text_field( trim( $input['webhook_secret'] ?? '' ) ),
	);
}

function mizuki_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Mizuki Booking', 'mizuki-booking' ); ?></h1>

		<form action="options.php" method="post">
			<?php settings_fields( 'mizuki_booking' ); ?>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">
						<label for="mizuki_api_base"><?php esc_html_e( 'Booking system address', 'mizuki-booking' ); ?></label>
					</th>
					<td>
						<input
							name="mizuki_booking_settings[api_base]"
							id="mizuki_api_base"
							type="url"
							class="regular-text code"
							placeholder="https://api.mizuki.com.sg"
							value="<?php echo esc_attr( mizuki_get_option( 'api_base' ) ); ?>"
						/>
						<p class="description">
							<?php esc_html_e( 'Where the booking system lives. No trailing slash.', 'mizuki-booking' ); ?>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row">
						<label for="mizuki_webhook_secret"><?php esc_html_e( 'Shared secret', 'mizuki-booking' ); ?></label>
					</th>
					<td>
						<input
							name="mizuki_booking_settings[webhook_secret]"
							id="mizuki_webhook_secret"
							type="password"
							class="regular-text code"
							autocomplete="new-password"
							value="<?php echo esc_attr( mizuki_get_option( 'webhook_secret' ) ); ?>"
						/>
						<p class="description">
							<?php esc_html_e( 'Must match WOO_WEBHOOK_SECRET on the booking system. This is what proves an order update really came from this site.', 'mizuki-booking' ); ?>
						</p>
					</td>
				</tr>
			</table>

			<?php submit_button(); ?>
		</form>

		<hr />

		<h2><?php esc_html_e( 'Putting the calendar on a page', 'mizuki-booking' ); ?></h2>
		<p><?php esc_html_e( 'Paste one of these into any page or post:', 'mizuki-booking' ); ?></p>
		<table class="widefat striped" style="max-width:820px">
			<tbody>
				<tr>
					<td><code>[mizuki_booking]</code></td>
					<td>
						<strong><?php esc_html_e( 'This is the one you want.', 'mizuki-booking' ); ?></strong>
						<?php esc_html_e( 'Booking and "my bookings" on one page, behind two tabs. One page, one menu link.', 'mizuki-booking' ); ?>
					</td>
				</tr>
				<tr>
					<td><code>[mizuki_course_portal course="ifda"]</code></td>
					<td>
						<strong><?php esc_html_e( 'For students who have already paid.', 'mizuki-booking' ); ?></strong>
						<?php esc_html_e( 'They sign in, see how many lessons are left and by when, then press Book a lesson to see only that course. No payment step.', 'mizuki-booking' ); ?>
					</td>
				</tr>
				<tr>
					<td><code>[mizuki_booking course="ikebana"]</code></td>
					<td><?php esc_html_e( 'Only one course. Use ikebana, ifda, preserved-flower, fresh-flower or bouquet.', 'mizuki-booking' ); ?></td>
				</tr>
				<tr>
					<td><code>[mizuki_booking view="calendar"]</code></td>
					<td><?php esc_html_e( 'Just the calendar, without the tabs.', 'mizuki-booking' ); ?></td>
				</tr>
				<tr>
					<td><code>[mizuki_booking view="my-bookings"]</code></td>
					<td><?php esc_html_e( 'Just a student\'s own bookings.', 'mizuki-booking' ); ?></td>
				</tr>
			</tbody>
		</table>

		<?php if ( ! mizuki_api_base() ) : ?>
			<div class="notice notice-warning inline" style="margin-top:16px">
				<p><?php esc_html_e( 'Add the booking system address above before using the shortcodes.', 'mizuki-booking' ); ?></p>
			</div>
		<?php endif; ?>

		<?php if ( ! class_exists( 'WooCommerce' ) ) : ?>
			<div class="notice notice-info inline" style="margin-top:16px">
				<p><?php esc_html_e( 'WooCommerce is not active. The calendar still works; paid workshops will not be able to hold a place through checkout.', 'mizuki-booking' ); ?></p>
			</div>
		<?php endif; ?>
	</div>
	<?php
}

/**
 * -----------------------------------------------------------------------------
 * The embedded widget
 * -----------------------------------------------------------------------------
 */

/**
 * Version the bundle by its own modification time, not by the plugin's version constant.
 *
 * The constant only changes when someone remembers to change it, and the browser — plus whatever
 * page cache or CDN sits in front of the site — keys on the full URL. Updating the plugin without
 * moving `?ver=` means the visitor keeps the bundle they already had, and the update appears to
 * have done nothing at all. This is exactly what happened on the first release of the tabs.
 */
function mizuki_asset_version( $relative ) {
	$path  = plugin_dir_path( MIZUKI_BRIDGE_FILE ) . $relative;
	$mtime = file_exists( $path ) ? filemtime( $path ) : 0;

	return $mtime ? MIZUKI_BRIDGE_VERSION . '.' . $mtime : MIZUKI_BRIDGE_VERSION;
}

/**
 * The Elementor widgets.
 *
 * Loaded only when Elementor is, so the plugin stays useful on a site that does not run it —
 * the shortcodes above do the same job without a page builder.
 */
add_action( 'plugins_loaded', 'mizuki_maybe_load_elementor', 20 );
function mizuki_maybe_load_elementor() {
	if ( did_action( 'elementor/loaded' ) ) {
		require_once plugin_dir_path( MIZUKI_BRIDGE_FILE ) . 'includes/elementor.php';
	}
}

add_action( 'wp_enqueue_scripts', 'mizuki_register_assets' );
function mizuki_register_assets() {
	$base = plugin_dir_url( MIZUKI_BRIDGE_FILE );

	// No stylesheet to enqueue: the widget renders inside a shadow root and carries its own CSS,
	// which is the only way to be sure the theme cannot restyle it.
	wp_register_script( 'mizuki-booking', $base . 'assets/widget.js', array(), mizuki_asset_version( 'assets/widget.js' ), true );

	// Elementor's lifecycle, and the booking buttons. Tiny, and useful without Elementor too:
	// any button with the class `mizuki-book` opens the calendar, shortcode pages included.
	wp_register_script( 'mizuki-elementor', $base . 'js/elementor.js', array(), mizuki_asset_version( 'js/elementor.js' ), true );
}

/**
 * Renders the mount point. The script reads its configuration from the element's data
 * attributes, so two shortcodes on one page can show different views.
 *
 * `$extra` carries anything the caller wants on the element beyond the basics — the Elementor
 * widgets use it for replaced wording and for the colour variables, which cross into the shadow
 * root when nothing else does.
 */
function mizuki_render_widget( $atts, $view, $extra = array() ) {
	$api_base = mizuki_api_base();

	if ( ! $api_base ) {
		// Only tell an editor about the misconfiguration — a visitor should see nothing.
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>' . esc_html__( 'Mizuki Booking: set the booking system address in Settings → Mizuki Booking.', 'mizuki-booking' ) . '</strong></p>';
		}
		return '';
	}

	wp_enqueue_script( 'mizuki-booking' );

	$attributes = array(
		'data-mizuki-booking' => '1',
		'data-api-base'       => $api_base,
		'data-view'           => $view,
	);

	if ( ! empty( $atts['course'] ) ) {
		$attributes['data-course'] = sanitize_title( $atts['course'] );
	}

	foreach ( $extra as $name => $value ) {
		if ( '' !== $value && null !== $value ) {
			$attributes[ $name ] = $value;
		}
	}

	$rendered = '';
	foreach ( $attributes as $name => $value ) {
		$rendered .= sprintf( ' %s="%s"', esc_attr( $name ), esc_attr( $value ) );
	}

	return '<div' . $rendered . '></div>';
}

/**
 * The whole thing on one page: booking and "my bookings" behind two tabs.
 *
 * This is the shortcode to use. Students get one page and one link, and the studio has one page
 * to maintain rather than two — a student who has just booked can see it without going to find
 * another page.
 *
 * `view` narrows it to a single panel for anyone who really does want them separate.
 */
add_shortcode( 'mizuki_booking', 'mizuki_booking_shortcode' );
function mizuki_booking_shortcode( $atts ) {
	$atts = shortcode_atts( array( 'course' => '', 'view' => 'all' ), $atts, 'mizuki_booking' );

	$view = in_array( $atts['view'], array( 'calendar', 'my-bookings', 'course-portal' ), true ) ? $atts['view'] : 'all';
	return mizuki_render_widget( $atts, $view );
}

/**
 * A page for students who have already paid for a course — IFDA, and Preserved Flower when the
 * studio wants one.
 *
 * Their lessons are covered by the course fee, so this page has no payment and no checkout: they
 * sign in with the address they enrolled with, see how many lessons are left and by when, and
 * press one button to open a calendar showing only their own course.
 *
 * Usage:  [mizuki_course_portal course="ifda"]
 */
add_shortcode( 'mizuki_course_portal', 'mizuki_course_portal_shortcode' );
function mizuki_course_portal_shortcode( $atts ) {
	$atts = shortcode_atts( array( 'course' => 'ifda' ), $atts, 'mizuki_course_portal' );

	if ( empty( $atts['course'] ) ) {
		if ( current_user_can( 'manage_options' ) ) {
			return '<p><strong>' . esc_html__( 'Mizuki Booking: add a course, e.g. [mizuki_course_portal course="ifda"].', 'mizuki-booking' ) . '</strong></p>';
		}
		return '';
	}

	return mizuki_render_widget( $atts, 'course-portal' );
}

/**
 * Kept working for sites that already have it on a page, so an update never blanks a live page.
 * New installs want [mizuki_booking] on its own.
 */
add_shortcode( 'mizuki_my_bookings', 'mizuki_my_bookings_shortcode' );
function mizuki_my_bookings_shortcode( $atts ) {
	$atts = shortcode_atts( array(), $atts, 'mizuki_my_bookings' );
	return mizuki_render_widget( $atts, 'my-bookings' );
}

/**
 * -----------------------------------------------------------------------------
 * WooCommerce: carry the held place from the calendar to the order
 * -----------------------------------------------------------------------------
 *
 * A student clicks a paid workshop, the booking system holds their place and sends them here
 * with the class and hold token on the URL. Those two values have to survive cart → checkout →
 * order, otherwise the payment arrives with no way to tell which class it was for.
 */

add_filter( 'woocommerce_add_cart_item_data', 'mizuki_capture_cart_item_data', 10, 2 );
function mizuki_capture_cart_item_data( $cart_item_data, $product_id ) {
	if ( isset( $_GET[ MIZUKI_SESSION_PARAM ] ) ) {
		$cart_item_data['mizuki_session_id'] = sanitize_text_field( wp_unslash( $_GET[ MIZUKI_SESSION_PARAM ] ) );
	}
	if ( isset( $_GET[ MIZUKI_HOLD_PARAM ] ) ) {
		$cart_item_data['mizuki_hold_token'] = sanitize_text_field( wp_unslash( $_GET[ MIZUKI_HOLD_PARAM ] ) );
	}

	// Without this, WooCommerce merges two workshop dates into one line of quantity 2 and
	// the second student's class is lost.
	if ( ! empty( $cart_item_data['mizuki_session_id'] ) ) {
		$cart_item_data['unique_key'] = md5( $cart_item_data['mizuki_session_id'] . microtime() );
	}

	return $cart_item_data;
}

add_filter( 'woocommerce_get_item_data', 'mizuki_show_class_in_cart', 10, 2 );
function mizuki_show_class_in_cart( $item_data, $cart_item ) {
	if ( empty( $cart_item['mizuki_session_id'] ) ) {
		return $item_data;
	}

	$label = mizuki_describe_session( $cart_item['mizuki_session_id'] );
	if ( $label ) {
		$item_data[] = array(
			'key'   => __( 'Class', 'mizuki-booking' ),
			'value' => $label,
		);
	}

	return $item_data;
}

add_action( 'woocommerce_checkout_create_order_line_item', 'mizuki_persist_line_item_meta', 10, 4 );
function mizuki_persist_line_item_meta( $item, $cart_item_key, $values, $order ) {
	if ( ! empty( $values['mizuki_session_id'] ) ) {
		$item->add_meta_data( MIZUKI_META_SESSION, $values['mizuki_session_id'], true );

		$label = mizuki_describe_session( $values['mizuki_session_id'] );
		if ( $label ) {
			// Visible copy, so the order reads sensibly in the studio's WooCommerce admin.
			$item->add_meta_data( __( 'Class', 'mizuki-booking' ), $label, true );
		}
	}
	if ( ! empty( $values['mizuki_hold_token'] ) ) {
		$item->add_meta_data( MIZUKI_META_HOLD, $values['mizuki_hold_token'], true );
	}
}

/**
 * Ask the booking system what a class is called, for the cart and order lines.
 * Cached briefly — a shopper may reload the cart repeatedly and this is only decoration.
 */
function mizuki_describe_session( $session_id ) {
	$session_id = sanitize_text_field( $session_id );
	$cache_key  = 'mizuki_session_' . md5( $session_id );

	$cached = get_transient( $cache_key );
	if ( false !== $cached ) {
		return $cached;
	}

	$api_base = mizuki_api_base();
	if ( ! $api_base ) {
		return '';
	}

	$response = wp_remote_get(
		$api_base . '/api/public/sessions/' . rawurlencode( $session_id ),
		array( 'timeout' => 5 )
	);

	if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
		return '';
	}

	$body = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( empty( $body['session'] ) ) {
		return '';
	}

	$session = $body['session'];
	$label   = sprintf(
		'%s — %s',
		$session['title'] ?? '',
		// Rendered in the site's timezone, which the studio sets to Singapore.
		wp_date( 'D j M Y, g:i a', strtotime( $session['startAt'] ) )
	);

	set_transient( $cache_key, $label, 10 * MINUTE_IN_SECONDS );
	return $label;
}

/**
 * -----------------------------------------------------------------------------
 * WooCommerce: tell the booking system what happened to the order
 * -----------------------------------------------------------------------------
 */

add_action( 'woocommerce_order_status_processing', 'mizuki_order_paid', 10, 1 );
add_action( 'woocommerce_order_status_completed', 'mizuki_order_paid', 10, 1 );
function mizuki_order_paid( $order_id ) {
	mizuki_notify_booking_system( $order_id, 'paid' );
}

add_action( 'woocommerce_order_status_cancelled', 'mizuki_order_cancelled', 10, 1 );
add_action( 'woocommerce_order_status_failed', 'mizuki_order_cancelled', 10, 1 );
function mizuki_order_cancelled( $order_id ) {
	mizuki_notify_booking_system( $order_id, 'cancelled' );
}

add_action( 'woocommerce_order_status_refunded', 'mizuki_order_refunded', 10, 1 );
function mizuki_order_refunded( $order_id ) {
	mizuki_notify_booking_system( $order_id, 'refunded' );
}

/**
 * Post the order's class lines to the booking system, signed so it can trust them.
 *
 * Fire-and-forget from WordPress's point of view: if this call fails, the held place simply
 * expires and goes back on sale, which is the safe outcome. The booking system is what decides
 * whether a place is confirmed — this only reports.
 */
function mizuki_notify_booking_system( $order_id, $event ) {
	$api_base = mizuki_api_base();
	$secret   = mizuki_get_option( 'webhook_secret' );

	if ( ! $api_base || ! $secret ) {
		return;
	}

	$order = wc_get_order( $order_id );
	if ( ! $order ) {
		return;
	}

	/*
	 * Every line goes, not just the ones with a class attached.
	 *
	 * A course package is sold as an ordinary product with no session — filtering on the class
	 * id here would mean buying a package tells the booking system nothing at all. WordPress
	 * does not know which products matter; the booking system holds the product mapping, so it
	 * decides. Lines it does not recognise are ignored there.
	 */
	$lines = array();
	foreach ( $order->get_items() as $item ) {
		$lines[] = array(
			'sessionId' => (string) $item->get_meta( MIZUKI_META_SESSION, true ),
			'holdToken' => (string) $item->get_meta( MIZUKI_META_HOLD, true ),
			'productId' => (int) $item->get_product_id(),
			'quantity'  => (int) $item->get_quantity(),
		);
	}

	if ( empty( $lines ) ) {
		return;
	}

	$payload = wp_json_encode(
		array(
			'event'     => $event,
			'orderId'   => (int) $order->get_id(),
			'status'    => $order->get_status(),
			'total'     => (float) $order->get_total(),
			'currency'  => $order->get_currency(),
			'customer'  => array(
				'email' => $order->get_billing_email(),
				'name'  => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
				'phone' => $order->get_billing_phone(),
				'wooId' => (int) $order->get_customer_id(),
			),
			'lines'     => $lines,
			'timestamp' => time(),
		)
	);

	$signature = hash_hmac( 'sha256', $payload, $secret );

	$response = wp_remote_post(
		$api_base . '/api/woo/order',
		array(
			'timeout'  => 15,
			'headers'  => array(
				'Content-Type'       => 'application/json',
				'X-Mizuki-Signature' => $signature,
			),
			'body'     => $payload,
			'blocking' => true,
		)
	);

	if ( is_wp_error( $response ) ) {
		$order->add_order_note(
			sprintf(
				/* translators: %s: error message */
				__( 'Could not reach the booking system: %s', 'mizuki-booking' ),
				$response->get_error_message()
			)
		);
		return;
	}

	$code = wp_remote_retrieve_response_code( $response );
	if ( $code >= 300 ) {
		$order->add_order_note(
			sprintf(
				/* translators: 1: HTTP status code, 2: response body */
				__( 'The booking system rejected this order (%1$d): %2$s', 'mizuki-booking' ),
				$code,
				wp_remote_retrieve_body( $response )
			)
		);
		return;
	}

	$order->add_order_note( __( 'Booking system updated — the student\'s place is confirmed.', 'mizuki-booking' ) );
}

/**
 * -----------------------------------------------------------------------------
 * Housekeeping
 * -----------------------------------------------------------------------------
 */

register_deactivation_hook(
	MIZUKI_BRIDGE_FILE,
	function () {
		// Settings are deliberately left in place, so deactivating and reactivating does not
		// mean re-entering the address and secret.
		delete_expired_transients();
	}
);
