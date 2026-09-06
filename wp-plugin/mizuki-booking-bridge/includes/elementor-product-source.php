<?php
/**
 * Where a list of products comes from.
 *
 * Three sections show a row of products — the product page's "more products", and the rails on
 * Mizuki Picks and Tools & Vases. They asked the same questions three times and answered them
 * three ways, so they ask them here once instead: choose the products by hand, or take a whole
 * category and leave some out; show the price or do not.
 *
 * Adding this to a fourth section is two calls — add_product_source_controls() when registering,
 * resolve_product_rows() when drawing — and the section gets every option the others have.
 *
 * Nothing here assumes WooCommerce is installed. Every call into it is behind a check, because a
 * widget that fatals when a plugin is deactivated takes the whole site with it.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

trait Mizuki_Elementor_Product_Source {

	private function woo() {
		return function_exists( 'wc_get_product' ) && function_exists( 'wc_get_products' );
	}

	/**
	 * The product list for the pickers.
	 *
	 * Cached for an hour, because Elementor rebuilds a widget's controls on every keystroke in
	 * the panel and a shop query per keystroke is a slow editor. An empty answer is cached for
	 * two minutes only: empty means a shop with no products, a query that threw, or a call that
	 * arrived before WooCommerce was ready, and two of those fix themselves — an hour of "no
	 * products" in the picker looks exactly like the picker being broken.
	 */
	private function product_choices() {
		if ( ! $this->woo() ) {
			return array();
		}

		$cached = get_transient( 'mizuki_product_choices' );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$choices = array();

		try {
			foreach ( wc_get_products( array(
				'status'  => 'publish',
				'limit'   => 200,
				'orderby' => 'title',
				'order'   => 'ASC',
				'return'  => 'objects',
			) ) as $product ) {
				$choices[ (string) $product->get_id() ] = sprintf( '%s (#%d)', $product->get_name(), $product->get_id() );
			}
		} catch ( \Throwable $error ) {
			$choices = array();
		}

		set_transient( 'mizuki_product_choices', $choices, $choices ? HOUR_IN_SECONDS : 2 * MINUTE_IN_SECONDS );

		return $choices;
	}

	/** The categories, on the same terms. */
	private function category_choices() {
		if ( ! $this->woo() ) {
			return array();
		}

		$cached = get_transient( 'mizuki_category_choices' );
		if ( is_array( $cached ) ) {
			return $cached;
		}

		$choices = array();
		$terms   = get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => false ) );

		if ( $terms && ! is_wp_error( $terms ) ) {
			foreach ( $terms as $term ) {
				$choices[ (string) $term->term_id ] = $term->name;
			}
		}

		set_transient( 'mizuki_category_choices', $choices, $choices ? HOUR_IN_SECONDS : 2 * MINUTE_IN_SECONDS );

		return $choices;
	}

	/** For a test to check the lists at their source; Elementor's control stack cannot be read back. */
	public function list_products_for_test() {
		return $this->product_choices();
	}

	public function list_categories_for_test() {
		return $this->category_choices();
	}

	/** A product object, or null — never a fatal. */
	private function product( $id ) {
		$id = (int) $id;
		if ( ! $id || ! $this->woo() ) {
			return null;
		}

		$product = wc_get_product( $id );

		return ( $product && is_a( $product, 'WC_Product' ) && 'publish' === get_post_status( $id ) ) ? $product : null;
	}

	/**
	 * A picker, or a plain box for an ID when there is no shop to pick from.
	 *
	 * Which one it is depends on whether WooCommerce is here, not on whether the list came back
	 * with anything — swapping to a text box because the query was empty means a studio who adds
	 * their first product finds a box asking for an ID they have no way to look up.
	 */
	private function picker_args( $label, $choices, $description = '', $multiple = false ) {
		$args = array(
			'label'       => $label,
			'type'        => $this->woo() ? \Elementor\Controls_Manager::SELECT2 : \Elementor\Controls_Manager::TEXT,
			'options'     => $choices,
			'label_block' => true,
			'default'     => $multiple ? array() : '',
			'description' => $this->woo()
				? $description
				: __( 'WooCommerce is not active, so there is no list to choose from — enter an ID.', 'mizuki-booking' ),
		);

		if ( $multiple && $this->woo() ) {
			$args['multiple'] = true;
		}

		return $args;
	}

	/**
	 * The questions every product list asks.
	 *
	 * `$prefix` names the section — `more` on the product page, `picks` on the shop pages — so a
	 * page may have more than one of these without their settings colliding. The repeater of
	 * hand-picked products keeps the prefix as its own name, which is what the widgets already
	 * saved under, so nothing that exists has to be re-entered.
	 */
	private function add_product_source_controls( $prefix, $repeater, $description = '' ) {
		$this->add_control(
			$prefix . '_source',
			array(
				'label'   => __( 'Which products', 'mizuki-booking' ),
				'type'    => \Elementor\Controls_Manager::SELECT,
				'default' => 'manual',
				'options' => array(
					'manual'   => __( 'The ones I choose', 'mizuki-booking' ),
					'category' => __( 'Everything in a category', 'mizuki-booking' ),
				),
			)
		);

		$this->add_control(
			$prefix,
			array(
				'label'       => __( 'Products', 'mizuki-booking' ),
				'type'        => \Elementor\Controls_Manager::REPEATER,
				'fields'      => $repeater->get_controls(),
				'title_field' => '{{{ label || "Product" }}}',
				'default'     => array(),
				'description' => $description,
				'condition'   => array( $prefix . '_source' => 'manual' ),
			)
		);

		$this->add_control(
			$prefix . '_category',
			$this->picker_args(
				__( 'Category', 'mizuki-booking' ),
				$this->category_choices(),
				__( 'Every published product filed here. Choose more than one to combine them.', 'mizuki-booking' ),
				true
			) + array( 'condition' => array( $prefix . '_source' => 'category' ) )
		);

		$this->add_control(
			$prefix . '_exclude',
			$this->picker_args(
				__( 'Except these', 'mizuki-booking' ),
				$this->product_choices(),
				__( 'Left out of the category. Useful for the product the page is already about.', 'mizuki-booking' ),
				true
			) + array( 'condition' => array( $prefix . '_source' => 'category' ) )
		);

		$this->add_control(
			$prefix . '_limit',
			array(
				'label'     => __( 'How many at most', 'mizuki-booking' ),
				'type'      => \Elementor\Controls_Manager::NUMBER,
				'min'       => 1,
				'max'       => 24,
				'default'   => 8,
				'condition' => array( $prefix . '_source' => 'category' ),
			)
		);

		$this->add_control(
			$prefix . '_orderby',
			array(
				'label'     => __( 'In what order', 'mizuki-booking' ),
				'type'      => \Elementor\Controls_Manager::SELECT,
				'default'   => 'menu_order',
				'options'   => array(
					'menu_order' => __( 'The shop’s own order', 'mizuki-booking' ),
					'title'      => __( 'By name', 'mizuki-booking' ),
					'date'       => __( 'Newest first', 'mizuki-booking' ),
					'price'      => __( 'Cheapest first', 'mizuki-booking' ),
					'popularity' => __( 'Best selling first', 'mizuki-booking' ),
					'rand'       => __( 'Shuffled', 'mizuki-booking' ),
				),
				'condition' => array( $prefix . '_source' => 'category' ),
			)
		);

		$this->add_control(
			$prefix . '_show_price',
			array(
				'label'        => __( 'Show prices', 'mizuki-booking' ),
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'label_on'     => __( 'Yes', 'mizuki-booking' ),
				'label_off'    => __( 'No', 'mizuki-booking' ),
				'return_value' => 'yes',
				'default'      => '',
				'separator'    => 'before',
			)
		);
	}

	/**
	 * The products this section should draw, in order, each with whatever was typed beside it.
	 *
	 * Returns rows of `array( 'row' => the repeater entry, 'product' => WC_Product )`. In category
	 * mode there is no repeater entry, so `row` is empty and every card falls back to the
	 * product's own name, picture and first category — which is the point of the mode.
	 *
	 * A hand-picked product that has since been deleted is skipped rather than drawn as an empty
	 * card, and a section with nothing left to show returns nothing so the caller can leave the
	 * whole thing out.
	 */
	private function resolve_product_rows( $s, $prefix ) {
		$source = isset( $s[ $prefix . '_source' ] ) ? $s[ $prefix . '_source' ] : 'manual';

		if ( 'category' === $source ) {
			return $this->rows_from_category( $s, $prefix );
		}

		$rows = array();

		foreach ( $this->rows( $s, $prefix ) as $row ) {
			$product = $this->product( isset( $row['product'] ) ? $row['product'] : '' );
			if ( $product ) {
				$rows[] = array( 'row' => $row, 'product' => $product );
			}
		}

		return $rows;
	}

	private function rows_from_category( $s, $prefix ) {
		if ( ! $this->woo() ) {
			return array();
		}

		$categories = isset( $s[ $prefix . '_category' ] ) ? (array) $s[ $prefix . '_category' ] : array();
		$categories = array_filter( array_map( 'absint', $categories ) );

		if ( ! $categories ) {
			return array();
		}

		$excluded = isset( $s[ $prefix . '_exclude' ] ) ? (array) $s[ $prefix . '_exclude' ] : array();
		$excluded = array_values( array_filter( array_map( 'absint', $excluded ) ) );

		$limit   = isset( $s[ $prefix . '_limit' ] ) ? (int) $s[ $prefix . '_limit' ] : 8;
		$orderby = isset( $s[ $prefix . '_orderby' ] ) ? $s[ $prefix . '_orderby' ] : 'menu_order';

		$args = array(
			'status'   => 'publish',
			'limit'    => max( 1, min( 24, $limit ) ),
			'orderby'  => $orderby,
			'return'   => 'objects',
			'category' => $this->category_slugs( $categories ),
		);

		// 'price' and 'popularity' sort ascending by their nature; the rest read better newest or
		// A-first, which is what WooCommerce does by default for each.
		if ( in_array( $orderby, array( 'date' ), true ) ) {
			$args['order'] = 'DESC';
		}

		if ( $excluded ) {
			$args['exclude'] = $excluded;
		}

		$rows = array();

		try {
			foreach ( wc_get_products( $args ) as $product ) {
				$rows[] = array( 'row' => array(), 'product' => $product );
			}
		} catch ( \Throwable $error ) {
			if ( function_exists( 'error_log' ) ) {
				error_log( 'Mizuki Booking: could not read the ' . $prefix . ' category — ' . $error->getMessage() );
			}
			return array();
		}

		return $rows;
	}

	/** wc_get_products takes category slugs, not ids, and the panel stores ids. */
	private function category_slugs( $ids ) {
		$slugs = array();

		foreach ( $ids as $id ) {
			$term = get_term( (int) $id, 'product_cat' );
			if ( $term && ! is_wp_error( $term ) ) {
				$slugs[] = $term->slug;
			}
		}

		return $slugs;
	}

	/**
	 * Whether this card shows a price.
	 *
	 * The switch is on the section, which is what a category of twenty products needs. A card
	 * that already had its own switch turned on keeps it, so turning the section switch on is
	 * additive and nothing anybody set by hand is lost to the change.
	 */
	private function shows_price( $s, $prefix, $row ) {
		if ( isset( $s[ $prefix . '_show_price' ] ) && 'yes' === $s[ $prefix . '_show_price' ] ) {
			return true;
		}

		return ! empty( $row['show_price'] ) && 'yes' === $row['show_price'];
	}
}
