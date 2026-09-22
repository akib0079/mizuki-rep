<?php
/**
 * The product widgets, drawn by Elementor against a real WooCommerce.
 *
 * Run inside a loaded WordPress with WooCommerce and the demo shop, by real-wordpress.sh.
 *
 * Everything these widgets know about the shop comes from `wc_get_products`, and until now that
 * call was only ever answered by a stub in the PHP harness — one taught `category`, `exclude`
 * and `limit` by the same hand that wrote the code calling them. A stub cannot disagree. This
 * asks the real WooCommerce the same questions and checks the answers are the ones the widgets
 * were built expecting: that a category is read by slug and not by id, that an exclusion takes a
 * product out, that a limit is honoured, and that a deleted product leaves a gap rather than an
 * empty card.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit( 1 );
}

$failures = 0;

function step( $name, callable $run ) {
	global $failures;
	try {
		$detail = $run();
		printf( "  ok    %s%s\n", $name, $detail ? " — {$detail}" : '' );
	} catch ( \Throwable $e ) {
		$failures++;
		printf( "  FAIL  %s — %s\n", $name, $e->getMessage() );
	}
}

function expect( $condition, $message ) {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
}

/** Draw one widget with the given settings and hand back the HTML it produced. */
function render_widget( $type, array $settings ) {
	$widget = \Elementor\Plugin::$instance->elements_manager->create_element_instance(
		array( 'elType' => 'widget', 'widgetType' => $type, 'id' => 'wc1', 'settings' => $settings )
	);
	expect( (bool) $widget, 'Elementor would not build ' . $type );

	ob_start();
	$widget->render_content();
	return (string) ob_get_clean();
}

$ids  = json_decode( (string) file_get_contents( __DIR__ . '/demo-products.json' ), true );
$slug = function ( $name ) use ( $ids ) {
	expect( isset( $ids[ $name ] ), "the demo shop has no '{$name}'" );
	return (string) $ids[ $name ];
};

$vase_a  = $slug( 'Ceramic Vase — Ash' );
$vase_b  = $slug( 'Ceramic Vase — Clay' );
$suiban  = $slug( 'Low Ikebana Suiban' );
$box_set = $slug( 'Naturespresso Box Set' );

$vases_term = get_term_by( 'slug', 'vases', 'product_cat' );
expect( (bool) $vases_term, 'the demo shop has no vases category' );
$vases = (string) $vases_term->term_id;

echo "WooCommerce is really there\n";

step( 'the shop is active and stocked', function () use ( $ids ) {
	expect( class_exists( 'WooCommerce' ), 'WooCommerce is not loaded' );
	expect( function_exists( 'wc_get_products' ), 'wc_get_products is missing' );
	expect( count( $ids ) >= 12, 'expected the demo catalogue, found ' . count( $ids ) );
	return count( $ids ) . ' products';
} );

step( 'a category really does read by slug', function () use ( $vases ) {
	/*
	 * The one that would bite silently. The panel stores category ids; wc_get_products takes
	 * slugs, and handed an id it returns everything rather than nothing — so a wrong conversion
	 * looks like a working filter until somebody counts.
	 */
	$by_slug = wc_get_products( array( 'category' => array( 'vases' ), 'limit' => -1, 'return' => 'objects' ) );
	$by_id   = wc_get_products( array( 'category' => array( $vases ), 'limit' => -1, 'return' => 'objects' ) );

	expect( 3 === count( $by_slug ), 'the vases category should hold 3, found ' . count( $by_slug ) );
	expect( count( $by_id ) !== count( $by_slug ), 'an id and a slug returned the same thing, so this proves nothing' );

	return '3 by slug, ' . count( $by_id ) . ' by id';
} );

echo "\nHand-picked products\n";

foreach ( array( 'mizuki-picks-page' => 'picks', 'mizuki-tools-page' => 'picks', 'mizuki-product-page' => 'more_items' ) as $type => $prefix ) {
	step( "{$type}: draws the products it was given", function () use ( $type, $prefix, $vase_a, $suiban ) {
		$html = render_widget( $type, array(
			$prefix . '_source' => 'manual',
			$prefix             => array(
				array( '_id' => 'a', 'product' => $vase_a ),
				array( '_id' => 'b', 'product' => $suiban ),
			),
		) );

		expect( false !== strpos( $html, 'Ceramic Vase' ), 'the first product is not on the page' );
		expect( false !== strpos( $html, 'Suiban' ), 'the second product is not on the page' );
		return 'both drawn';
	} );

	step( "{$type}: skips a product that has been deleted", function () use ( $type, $prefix, $vase_a ) {
		$html = render_widget( $type, array(
			$prefix . '_source' => 'manual',
			$prefix             => array(
				array( '_id' => 'a', 'product' => $vase_a ),
				array( '_id' => 'b', 'product' => '999999' ),
			),
		) );

		expect( false !== strpos( $html, 'Ceramic Vase' ), 'the live product went missing too' );
		expect( false === strpos( $html, '999999' ), 'the deleted product left something behind' );
		return 'one drawn, one skipped';
	} );
}

echo "\nA whole category\n";

foreach ( array( 'mizuki-picks-page' => 'picks', 'mizuki-tools-page' => 'picks', 'mizuki-product-page' => 'more_items' ) as $type => $prefix ) {
	step( "{$type}: fills from a category without naming a product", function () use ( $type, $prefix, $vases ) {
		$html = render_widget( $type, array(
			$prefix . '_source'   => 'category',
			$prefix . '_category' => array( $vases ),
			$prefix . '_limit'    => 8,
		) );

		foreach ( array( 'Ceramic Vase — Ash', 'Ceramic Vase — Clay', 'Low Ikebana Suiban' ) as $name ) {
			expect( false !== strpos( $html, esc_html( $name ) ), "'{$name}' is missing from the category" );
		}
		return 'all 3 vases drawn';
	} );

	step( "{$type}: leaves an excluded product out", function () use ( $type, $prefix, $vases, $vase_b ) {
		$html = render_widget( $type, array(
			$prefix . '_source'   => 'category',
			$prefix . '_category' => array( $vases ),
			$prefix . '_exclude'  => array( $vase_b ),
			$prefix . '_limit'    => 8,
		) );

		expect( false !== strpos( $html, esc_html( 'Ceramic Vase — Ash' ) ), 'the wrong product was removed' );
		expect( false === strpos( $html, esc_html( 'Ceramic Vase — Clay' ) ), 'the excluded product is still drawn' );
		return 'Clay left out, the other two kept';
	} );

	step( "{$type}: honours a limit", function () use ( $type, $prefix, $vases ) {
		$html = render_widget( $type, array(
			$prefix . '_source'   => 'category',
			$prefix . '_category' => array( $vases ),
			$prefix . '_limit'    => 2,
		) );

		$drawn = substr_count( $html, 'Ceramic Vase' ) + substr_count( $html, 'Suiban' );
		expect( 2 === $drawn, "a limit of 2 drew {$drawn}" );
		return '2 of 3 drawn';
	} );

	step( "{$type}: draws nothing at all when the category is empty", function () use ( $type, $prefix ) {
		$empty = wp_insert_term( 'Nothing In Here', 'product_cat', array( 'slug' => 'nothing-in-here-' . $prefix ) );
		$id    = is_wp_error( $empty ) ? 0 : $empty['term_id'];

		$html = render_widget( $type, array(
			$prefix . '_source'   => 'category',
			$prefix . '_category' => array( (string) $id ),
			$prefix . '_limit'    => 8,
		) );

		expect( '' === trim( $html ) || false === strpos( $html, 'Ceramic Vase' ), 'an empty category drew products' );
		return 'nothing drawn';
	} );
}

echo "\nPrices\n";

foreach ( array( 'mizuki-picks-page' => 'picks', 'mizuki-tools-page' => 'picks', 'mizuki-product-page' => 'more_items' ) as $type => $prefix ) {
	step( "{$type}: the price switch turns real prices on and off", function () use ( $type, $prefix, $vases ) {
		$base = array(
			$prefix . '_source'   => 'category',
			$prefix . '_category' => array( $vases ),
			$prefix . '_limit'    => 8,
		);

		$off = render_widget( $type, $base + array( $prefix . '_show_price' => '' ) );
		$on  = render_widget( $type, $base + array( $prefix . '_show_price' => 'yes' ) );

		// 64.00 twice and 92.00 once — WooCommerce's own formatting, not ours.
		expect( false === strpos( $off, '64' ), 'a price was drawn with the switch off' );
		expect( false !== strpos( $on, '64' ), 'no price was drawn with the switch on' );
		return 'off: none, on: ' . substr_count( $on, '&#36;' ) . ' prices';
	} );
}

echo "\nThe product page itself\n";

step( 'draws the chosen product, its price and a working add-to-bag form', function () use ( $box_set ) {
	$html = render_widget( 'mizuki-product-page', array( 'product' => $box_set ) );

	expect( false !== strpos( $html, 'Naturespresso' ), 'the product name is missing' );
	expect( false !== strpos( $html, '128' ), 'the price is missing' );
	expect( false !== strpos( $html, 'add-to-cart' ), 'there is no add-to-cart field' );
	expect( false !== strpos( $html, (string) $box_set ), 'the form does not name the product' );
	return 'name, price and form';
} );

step( 'leaves the product section out entirely when nothing is chosen', function () {
	$html = render_widget( 'mizuki-product-page', array( 'product' => '' ) );
	expect( false === strpos( $html, 'add-to-cart' ), 'a buy form was drawn for no product' );
	return 'no product, no form';
} );

step( 'takes the category from the product rather than being told it', function () use ( $box_set ) {
	$html = render_widget( 'mizuki-product-page', array( 'product' => $box_set ) );
	expect( false !== strpos( $html, 'Bouquets' ), 'the product’s own category is not shown' );
	return 'Bouquets, read off the product';
} );

echo "\n";
if ( $failures ) {
	echo "{$failures} failure(s) against real WooCommerce.\n";
	exit( 1 );
}
echo "Real WooCommerce: every product widget draws real products, categories, exclusions and prices.\n";
