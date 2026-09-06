<?php
/**
 * Just enough WooCommerce to draw a product page.
 *
 * Loaded partway through the run, not at the top, because the case that matters most is the one
 * without it: a widget that fatals when WooCommerce is deactivated takes the whole site down,
 * and deactivating it for ten minutes is a thing people do. So the page is drawn once with no
 * WooCommerce at all, and then again with this.
 */

class WC_Product {
	public $id;
	public $name;
	public $price_html;
	public $purchasable = true;
	public $in_stock    = true;
	public $image_id    = 0;
	public $gallery     = array();
	public $short_description = '';
	/** Category slugs, so a stubbed query can be filtered by one. */
	public $categories = array( 'naturepresso' );

	public function __construct( $id, $name, $price_html = 'S$268.00' ) {
		$this->id         = (int) $id;
		$this->name       = $name;
		$this->price_html = $price_html;
	}

	public function get_id() { return $this->id; }
	public function get_name() { return $this->name; }
	public function get_price_html() { return $this->price_html; }
	public function is_purchasable() { return $this->purchasable; }
	public function is_in_stock() { return $this->in_stock; }
	public function get_short_description() { return $this->short_description; }
	public function get_permalink() { return 'https://example.test/product/' . $this->id . '/'; }
	public function get_image_id() { return $this->image_id; }
	public function get_gallery_image_ids() { return $this->gallery; }
}

$GLOBALS['mzk_products'] = array();

function wc_get_product( $id ) {
	$id = (int) $id;
	return isset( $GLOBALS['mzk_products'][ $id ] ) ? $GLOBALS['mzk_products'][ $id ] : false;
}

/**
 * Enough of the product query to mean something.
 *
 * It honours the arguments the widgets actually pass — `exclude`, `limit` and `category` — because
 * a stub that ignores them cannot tell a working filter from one that was never applied, and the
 * first version of this did exactly that: it returned every product whatever was asked, so a test
 * for "leave this one out" passed against code that left nothing out.
 */
function wc_get_products( $args = array() ) {
	$products = array_values( $GLOBALS['mzk_products'] );

	if ( ! empty( $args['category'] ) ) {
		$wanted   = (array) $args['category'];
		$products = array_values( array_filter( $products, function ( $product ) use ( $wanted ) {
			return array_intersect( $wanted, (array) $product->categories );
		} ) );
	}

	if ( ! empty( $args['exclude'] ) ) {
		$excluded = array_map( 'intval', (array) $args['exclude'] );
		$products = array_values( array_filter( $products, function ( $product ) use ( $excluded ) {
			return ! in_array( (int) $product->get_id(), $excluded, true );
		} ) );
	}

	if ( ! empty( $args['limit'] ) ) {
		$products = array_slice( $products, 0, (int) $args['limit'] );
	}

	return $products;
}

/**
 * The endpoint the script posts to.
 *
 * Real WooCommerce builds this from its own rewrite rules; all that matters here is that the
 * widget asks WooCommerce for it rather than assembling a URL itself, and that it stops asking
 * when the shop is set to redirect after adding.
 */
class WC_AJAX {
	public static function get_endpoint( $request ) {
		return 'https://example.test/?wc-ajax=' . $request;
	}
}
