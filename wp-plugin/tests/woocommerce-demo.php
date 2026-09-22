<?php
/**
 * A small demo shop, so the product widgets have something real to draw.
 *
 * Run inside a loaded WordPress with WooCommerce active, by real-wordpress.sh.
 *
 * The product widgets were only ever exercised against a stubbed `wc_get_products`, and a stub
 * agrees with whatever it was written to agree with — it was taught `category`, `exclude` and
 * `limit` by the same hand that wrote the code calling them. This gives the widgets a real shop
 * with real categories to disagree with.
 *
 * Everything here is invented. No real product, price or photograph from the studio's shop is
 * used, and nothing touches a live site.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit( 1 );
}

if ( ! class_exists( 'WooCommerce' ) ) {
	echo "WooCommerce is not active — nothing to seed.\n";
	exit( 1 );
}

/** Categories the Tools & Vases and Mizuki Picks widgets can be pointed at. */
$categories = array(
	'bouquets' => 'Bouquets',
	'vases'    => 'Vases',
	'tools'    => 'Tools',
	'workshops' => 'Workshops',
);

$term_ids = array();
foreach ( $categories as $slug => $name ) {
	$existing = get_term_by( 'slug', $slug, 'product_cat' );
	if ( $existing ) {
		$term_ids[ $slug ] = $existing->term_id;
		continue;
	}
	$made = wp_insert_term( $name, 'product_cat', array( 'slug' => $slug ) );
	$term_ids[ $slug ] = is_wp_error( $made ) ? 0 : $made['term_id'];
}

/**
 * The demo catalogue.
 *
 * Deliberately spread across four categories and a range of prices, so a category filter, an
 * exclusion and a limit each have something to actually change.
 */
$catalogue = array(
	array( 'Naturespresso Box Set', 'bouquets', '128.00', 'A seasonal arrangement in a reusable box, made to order the morning it is delivered.' ),
	array( 'Seasonal Hand-Tied Bouquet', 'bouquets', '88.00', 'Whatever is best at the market that week, tied by hand.' ),
	array( 'Preserved Rose Dome', 'bouquets', '168.00', 'Preserved blooms under glass. No water, no wilting.' ),
	array( 'Ceramic Vase — Ash', 'vases', '64.00', 'A matte stoneware vase with a narrow neck, thrown in small batches.' ),
	array( 'Ceramic Vase — Clay', 'vases', '64.00', 'The same shape in an unglazed clay body.' ),
	array( 'Low Ikebana Suiban', 'vases', '92.00', 'A shallow dish for moribana arrangements.' ),
	array( 'Brass Kenzan — 7cm', 'tools', '38.00', 'A pin holder heavy enough to hold woody stems.' ),
	array( 'Floral Shears', 'tools', '46.00', 'Carbon steel, for stems up to a centimetre.' ),
	array( 'Stem Wire — 100 pack', 'tools', '12.00', 'Paper-wrapped wire in a mid green.' ),
	array( 'Ikebana Workshop — One Class', 'workshops', '120.00', 'A single Ikebana class, materials included.' ),
	array( 'Autumn Ikebana Course', 'workshops', '420.00', 'Four Saturday mornings, working towards one finished arrangement.' ),
	array( 'Bouquet Day', 'workshops', '260.00', 'A full day, lunch included.' ),
);

$made = array();

foreach ( $catalogue as list( $name, $cat, $price, $description ) ) {
	$already = get_page_by_title( $name, OBJECT, 'product' );
	if ( $already ) {
		$made[ $name ] = $already->ID;
		continue;
	}

	$product = new WC_Product_Simple();
	$product->set_name( $name );
	$product->set_status( 'publish' );
	$product->set_catalog_visibility( 'visible' );
	$product->set_regular_price( $price );
	$product->set_short_description( $description );
	$product->set_description( $description . ' Made in the studio at 148 Jalan Besar.' );
	$product->set_category_ids( array_filter( array( $term_ids[ $cat ] ?? 0 ) ) );
	$product->set_manage_stock( false );
	$product->set_stock_status( 'instock' );
	$id = $product->save();

	$made[ $name ] = $id;
}

echo "Seeded " . count( $made ) . " products across " . count( $term_ids ) . " categories:\n";
foreach ( $made as $name => $id ) {
	$p = wc_get_product( $id );
	printf( "  #%-5d %-32s %s\n", $id, $name, $p ? wp_strip_all_tags( $p->get_price_html() ) : '' );
}

/* Written out so the checks and the demo pages can name products by id without guessing. */
file_put_contents( __DIR__ . '/demo-products.json', wp_json_encode( $made, JSON_PRETTY_PRINT ) );
echo "\nIds written to demo-products.json\n";
