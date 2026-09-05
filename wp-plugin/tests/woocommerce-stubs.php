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
	public function get_permalink() { return 'https://example.test/product/' . $this->id . '/'; }
	public function get_image_id() { return $this->image_id; }
	public function get_gallery_image_ids() { return $this->gallery; }
}

$GLOBALS['mzk_products'] = array();

function wc_get_product( $id ) {
	$id = (int) $id;
	return isset( $GLOBALS['mzk_products'][ $id ] ) ? $GLOBALS['mzk_products'][ $id ] : false;
}

function wc_get_products( $args = array() ) {
	return array_values( $GLOBALS['mzk_products'] );
}
