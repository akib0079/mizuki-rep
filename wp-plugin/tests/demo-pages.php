<?php
/**
 * Demo pages, one per widget, built the way the studio builds them.
 *
 * Run inside a loaded WordPress by real-wordpress.sh, after the demo shop is stocked.
 *
 * The checks either side of this call the widgets directly in PHP, which proves they render but
 * not that they survive the journey: Elementor's own saved-data format, its frontend pipeline,
 * a real theme's stylesheet, and an actual HTTP request. A widget that works when called and
 * breaks when saved is a widget that works everywhere except on the studio's site.
 *
 * Each page is a real Elementor document with real `_elementor_data`, so what gets served is
 * what a visitor would get.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit( 1 );
}

$ids = json_decode( (string) file_get_contents( __DIR__ . '/demo-products.json' ), true );
if ( ! is_array( $ids ) || ! $ids ) {
	echo "No demo products — run woocommerce-demo.php first.\n";
	exit( 1 );
}

$vases = get_term_by( 'slug', 'vases', 'product_cat' );
$tools = get_term_by( 'slug', 'tools', 'product_cat' );

/** One Elementor section wrapping one widget, which is all these pages need to be. */
function mizuki_demo_section( $widget_type, array $settings ) {
	return array(
		'id'       => wp_generate_password( 7, false ),
		'elType'   => 'section',
		'settings' => array(),
		'elements' => array(
			array(
				'id'       => wp_generate_password( 7, false ),
				'elType'   => 'column',
				'settings' => array( '_column_size' => 100 ),
				'elements' => array(
					array(
						'id'         => wp_generate_password( 7, false ),
						'elType'     => 'widget',
						'widgetType' => $widget_type,
						'settings'   => $settings,
					),
				),
			),
		),
	);
}

function mizuki_demo_page( $title, $slug, array $sections ) {
	$existing = get_page_by_path( $slug );
	if ( $existing ) {
		wp_delete_post( $existing->ID, true );
	}

	$id = wp_insert_post( array(
		'post_title'   => $title,
		'post_name'    => $slug,
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_content' => '',
	) );

	/* What makes it an Elementor page rather than an empty one. */
	update_post_meta( $id, '_elementor_edit_mode', 'builder' );
	update_post_meta( $id, '_elementor_template_type', 'wp-page' );
	update_post_meta( $id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '3.0.0' );
	update_post_meta( $id, '_elementor_data', wp_slash( wp_json_encode( $sections ) ) );

	return $id;
}

$pages = array();

// The booking calendar, which is the page the studio actually points students at.
$pages['book-a-class'] = mizuki_demo_page( 'Book a class', 'book-a-class', array(
	mizuki_demo_section( 'mizuki-calendar', array() ),
) );

// The two long course pages, drawn from their own declared defaults.
$pages['ifda'] = mizuki_demo_page( 'IFDA', 'ifda-demo', array(
	mizuki_demo_section( 'mizuki-ifda-page', array() ),
) );

$pages['ikebana'] = mizuki_demo_page( 'Ikebana', 'ikebana-demo', array(
	mizuki_demo_section( 'mizuki-ikebana-page', array() ),
) );

// A product page for a real product, with real related products drawn from a category.
$pages['product'] = mizuki_demo_page( 'Naturespresso Box Set', 'product-demo', array(
	mizuki_demo_section( 'mizuki-product-page', array(
		'product'            => (string) $ids['Naturespresso Box Set'],
		'more_items_source'  => 'category',
		'more_items_category' => array( (string) ( $vases->term_id ?? 0 ) ),
		'more_items_limit'   => 3,
		'more_items_show_price' => 'yes',
	) ),
) );

// Mizuki Picks, hand-picked — the way the studio curates a shop page.
$pages['picks'] = mizuki_demo_page( 'Mizuki Picks', 'picks-demo', array(
	mizuki_demo_section( 'mizuki-picks-page', array(
		'picks_source' => 'manual',
		'picks'        => array(
			array( '_id' => 'p1', 'product' => (string) $ids['Naturespresso Box Set'] ),
			array( '_id' => 'p2', 'product' => (string) $ids['Seasonal Hand-Tied Bouquet'] ),
			array( '_id' => 'p3', 'product' => (string) $ids['Preserved Rose Dome'] ),
		),
		'picks_show_price' => 'yes',
	) ),
) );

// Tools & Vases, filled from a category — the other way of doing the same job.
$pages['tools'] = mizuki_demo_page( 'Tools & Vases', 'tools-demo', array(
	mizuki_demo_section( 'mizuki-tools-page', array(
		'picks_source'     => 'category',
		'picks_category'   => array( (string) ( $tools->term_id ?? 0 ), (string) ( $vases->term_id ?? 0 ) ),
		'picks_limit'      => 6,
		'picks_show_price' => 'yes',
	) ),
) );

// The two small widgets, on one page, as they are usually placed.
$pages['account'] = mizuki_demo_page( 'My bookings', 'my-bookings-demo', array(
	mizuki_demo_section( 'mizuki-account', array() ),
	mizuki_demo_section( 'mizuki-book-button', array() ),
) );

// And the shortcodes, which are the other way into the same widget.
$pages['shortcodes'] = mizuki_demo_page( 'Shortcodes', 'shortcodes-demo', array() );
wp_update_post( array(
	'ID'           => $pages['shortcodes'],
	'post_content' => "[mizuki_booking]\n\n[mizuki_my_bookings]\n\n[mizuki_course_portal course=\"ifda\"]",
) );
delete_post_meta( $pages['shortcodes'], '_elementor_edit_mode' );

$paths = array();
echo "Built " . count( $pages ) . " demo pages:\n";
foreach ( $pages as $name => $id ) {
	$path = wp_make_link_relative( get_permalink( $id ) );
	$paths[] = $path;
	printf( "  %-14s %s\n", $name, $path );
}

/* The shop's own pages too — they are WooCommerce's, but this plugin is loaded on them. */
$shop = wc_get_page_id( 'shop' );
if ( $shop > 0 ) {
	$paths[] = wp_make_link_relative( get_permalink( $shop ) );
}

file_put_contents( __DIR__ . '/demo-page-paths.txt', implode( "\n", $paths ) . "\n" );
echo "\nPaths written to demo-page-paths.txt\n";
