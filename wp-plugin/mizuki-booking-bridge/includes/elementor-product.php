<?php
/**
 * A WooCommerce product page, as one widget.
 *
 * The page is a fixed shape with a lot of writing in it: a gallery and a buy box, then the
 * routine, the science, the four steps, the brand, what else to buy, and the questions. Building
 * that out of eighty Elementor elements is possible and nobody would enjoy maintaining it — so
 * every string and every picture is a control here, and the look lives in css/product.css.
 *
 * What it takes from WooCommerce, it takes live: the price, the categories, and the add-to-cart.
 * Those change without anybody editing the page, and a price typed into a text field is a price
 * that goes stale the first time the studio runs a sale.
 *
 * Nothing here assumes WooCommerce is installed. Every call into it is behind a check, because a
 * page builder widget that fatals when a plugin is deactivated takes the whole site with it, and
 * deactivating WooCommerce for ten minutes is a thing people do.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Mizuki_Elementor_Product_Page extends \Elementor\Widget_Base {

	use Mizuki_Elementor_Shared;

	public function get_name() {
		return 'mizuki-product-page';
	}

	public function get_title() {
		return __( 'Product page', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-woocommerce';
	}

	public function get_keywords() {
		return array( 'mizuki', 'product', 'shop', 'woocommerce', 'page', 'naturepresso', 'skincare' );
	}

	public function get_style_depends() {
		return array( 'mizuki-product' );
	}

	public function get_script_depends() {
		return array( 'mizuki-elementor', 'mizuki-product' );
	}

	/**
	 * -------------------------------------------------------------------------
	 * WooCommerce, at arm's length
	 * -------------------------------------------------------------------------
	 */

	private function woo() {
		return function_exists( 'wc_get_product' ) && function_exists( 'wc_get_products' );
	}

	/**
	 * The product list for the pickers.
	 *
	 * Cached for an hour, because Elementor rebuilds a widget's controls on every keystroke in
	 * the panel and a shop query per keystroke is a slow editor. Capped, because a catalogue of
	 * ten thousand would be a select box nobody can use — past the cap the studio types an id.
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
			$products = wc_get_products( array(
				'status'  => 'publish',
				'limit'   => 200,
				'orderby' => 'title',
				'order'   => 'ASC',
				'return'  => 'objects',
			) );

			foreach ( $products as $product ) {
				$choices[ (string) $product->get_id() ] = sprintf(
					'%s (#%d)',
					$product->get_name(),
					$product->get_id()
				);
			}
		} catch ( \Throwable $error ) {
			// A shop that cannot be queried is not a reason to break the panel.
			$choices = array();
		}

		/*
		 * An empty answer is cached for two minutes, not an hour.
		 *
		 * Empty means one of three things: a shop with no products yet, a query that threw, or a
		 * call that arrived before WooCommerce was ready. Two of those fix themselves, and an
		 * hour of "there are no products" in the picker looks exactly like the picker being
		 * broken — with no way for the studio to clear it.
		 */
		set_transient( 'mizuki_product_choices', $choices, $choices ? HOUR_IN_SECONDS : 2 * MINUTE_IN_SECONDS );

		return $choices;
	}

	/**
	 * The list, for a test to check.
	 *
	 * Elementor's control stack keeps a reduced record — type, tab, section, default, name — and
	 * the rest is resolved elsewhere, so what a picker was given cannot be read back out of it.
	 * Checking the list at its source is the honest test; whether Elementor then draws a select
	 * with those options is Elementor's business.
	 */
	public function list_products_for_test() {
		return $this->product_choices();
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
	 * The pictures the page was designed around, so an untouched widget shows the studio's own
	 * page rather than a wall of grey placeholders. Filterable in one line if the uploads move:
	 *
	 *   add_filter( 'mizuki_product_default_image', function ( $url, $which ) { ... }, 10, 2 );
	 */
	private function stock( $which ) {
		$base = 'https://mizuki.com.sg/wp-content/uploads/2025/10/';

		$images = array(
			'one'   => $base . 'IMG_8761-2-819x1024.jpg',
			'two'   => $base . 'IMG_8763-2-600x750.jpg',
			'three' => $base . 'IMG_8765-2-600x750.jpg',
		);

		$url = isset( $images[ $which ] ) ? $images[ $which ] : '';

		return apply_filters( 'mizuki_product_default_image', $url, $which );
	}

	/**
	 * -------------------------------------------------------------------------
	 * Controls
	 * -------------------------------------------------------------------------
	 */

	protected function register_controls() {
		$this->register_product_controls();
		$this->register_crumbs_controls();
		$this->register_hero_controls();
		$this->register_routine_controls();
		$this->register_extract_controls();
		$this->register_ritual_controls();
		$this->register_about_controls();
		$this->register_more_controls();
		$this->register_faq_controls();
		$this->register_sticky_controls();
	}

	/** The switch every section starts with, first in its panel and on by default. */
	private function add_section_switch( $key, $label ) {
		$this->add_control(
			$key,
			array(
				'label'        => $label,
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'label_on'     => __( 'Shown', 'mizuki-booking' ),
				'label_off'    => __( 'Hidden', 'mizuki-booking' ),
				'return_value' => 'yes',
				'default'      => 'yes',
				'separator'    => 'after',
			)
		);
	}

	/** A product picker. Used for the page's own product and for each cross-sell. */
	private function product_control( $target, $key, $label, $description = '' ) {
		$choices = $this->product_choices();

		/*
		 * Which control this is depends on whether WooCommerce is here, not on whether the list
		 * came back with anything. A shop that genuinely has no products should still show a
		 * picker — swapping to a text box because the query was empty means a studio who adds
		 * their first product finds a box asking for an ID they have no way to look up.
		 */
		$has_shop = $this->woo();

		$target->add_control(
			$key,
			array(
				'label'       => $label,
				'type'        => $has_shop ? \Elementor\Controls_Manager::SELECT2 : \Elementor\Controls_Manager::TEXT,
				'options'     => $choices,
				'label_block' => true,
				'default'     => '',
				'description' => $has_shop
					? $description
					: __( 'WooCommerce is not active, so there is no list to choose from — enter a product ID.', 'mizuki-booking' ),
			)
		);
	}

	private function register_product_controls() {
		$this->start_controls_section( 'section_product', array( 'label' => __( 'Product', 'mizuki-booking' ) ) );

		$this->product_control(
			$this,
			'product_id',
			__( 'This page is about', 'mizuki-booking' ),
			__( 'The price, the categories and the Add to bag button all come from this product, so they stay right without anyone editing the page.', 'mizuki-booking' )
		);

		$this->add_control(
			'product_missing_note',
			array(
				'type'            => \Elementor\Controls_Manager::RAW_HTML,
				'raw'             => __( 'With no product chosen the page still draws — it simply has no price, no categories and no Add to bag.', 'mizuki-booking' ),
				'content_classes' => 'elementor-descriptor',
			)
		);

		$this->end_controls_section();
	}

	private function register_crumbs_controls() {
		$this->start_controls_section( 'section_crumbs', array( 'label' => __( 'Breadcrumbs', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'crumbs_show', __( 'Show the breadcrumbs', 'mizuki-booking' ) );

		$crumb = new \Elementor\Repeater();
		$crumb->add_control( 'label', array(
			'label'   => __( 'Label', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Home', 'mizuki-booking' ),
		) );
		$crumb->add_control( 'link', array(
			'label'       => __( 'Link', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '/',
			'description' => __( 'Leave empty for plain text.', 'mizuki-booking' ),
		) );

		$this->add_control( 'crumbs', array(
			'label'       => __( 'Trail', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $crumb->get_controls(),
			'title_field' => '{{{ label }}}',
			'default'     => array(
				array( 'label' => __( 'Home', 'mizuki-booking' ), 'link' => '/' ),
				array( 'label' => __( 'Skin Care', 'mizuki-booking' ), 'link' => '/product-category/skin-care/' ),
				array( 'label' => __( 'Naturepresso', 'mizuki-booking' ), 'link' => '/product-category/naturepresso/' ),
			),
		) );

		$this->add_control( 'crumbs_last', array(
			'label'        => __( 'End with the product name', 'mizuki-booking' ),
			'type'         => \Elementor\Controls_Manager::SWITCHER,
			'label_on'     => __( 'Yes', 'mizuki-booking' ),
			'label_off'    => __( 'No', 'mizuki-booking' ),
			'return_value' => 'yes',
			'default'      => 'yes',
			'description'  => __( 'Taken from the chosen product, so renaming the product renames the trail.', 'mizuki-booking' ),
		) );

		$this->add_control( 'crumbs_last_text', array(
			'label'       => __( 'Or write the last step yourself', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '',
			'description' => __( 'Used instead of the product name when filled in.', 'mizuki-booking' ),
		) );

		$this->end_controls_section();
	}

	private function register_hero_controls() {
		$this->start_controls_section( 'section_hero', array( 'label' => __( 'Product hero', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'hero_show', __( 'Show the hero', 'mizuki-booking' ) );

		$this->add_control( 'hero_gallery', array(
			'label'       => __( 'Gallery', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::GALLERY,
			'description' => __( 'Leave empty to use the product’s own WooCommerce gallery.', 'mizuki-booking' ),
			'default'     => array(
				array( 'url' => $this->stock( 'one' ) ),
				array( 'url' => $this->stock( 'two' ) ),
				array( 'url' => $this->stock( 'three' ) ),
			),
		) );

		$this->add_control( 'hero_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Botanical Collection', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_title', array(
			'label'       => __( 'Title', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '',
			'description' => __( 'Leave empty to use the product’s own name.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_show_price', array(
			'label'        => __( 'Show the price', 'mizuki-booking' ),
			'type'         => \Elementor\Controls_Manager::SWITCHER,
			'label_on'     => __( 'Yes', 'mizuki-booking' ),
			'label_off'    => __( 'No', 'mizuki-booking' ),
			'return_value' => 'yes',
			'default'      => 'yes',
		) );

		$this->add_control( 'hero_lede', array(
			'label'   => __( 'Standfirst', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'The Naturepresso Box Set — Your Complete Plant-Based Routine', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_body', array(
			'label'   => __( 'Description', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'A curated collection of four essential, plant-based skincare staples designed for gentle, everyday nourishment. Everything your skin needs, thoughtfully gathered in one box.', 'mizuki-booking' ) . '</p>',
		) );

		$this->add_control( 'hero_list', array(
			'label'       => __( 'What is in the box', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 5,
			'default'     => "Pure Rose Water Mist\nFacial Collagen Serum\nEveryday Lotion\nOrange Blossom Nourishing Oil",
			'description' => __( 'One per line.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_tagline', array(
			'label'   => __( 'Tagline', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Nurture by nature.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_button', array(
			'label'   => __( 'Button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Add to Bag', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_button_busy', array(
			'label'       => __( 'Button, while adding', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => __( 'Adding…', 'mizuki-booking' ),
			'description' => __( 'Shown for the moment the bag is being updated.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_added_text', array(
			'label'   => __( 'Said after adding', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Added to your bag.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_cart_text', array(
			'label'       => __( 'Link to the bag', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => __( 'View bag', 'mizuki-booking' ),
			'description' => __( 'Goes to the WooCommerce cart. Left out when empty.', 'mizuki-booking' ),
		) );

		$trust = new \Elementor\Repeater();
		$trust->add_control( 'icon', array(
			'label'   => __( 'Icon', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::ICONS,
			'default' => array( 'value' => 'fas fa-truck', 'library' => 'fa-solid' ),
		) );
		$trust->add_control( 'text', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );

		$this->add_control( 'hero_trust', array(
			'label'       => __( 'Reassurances', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $trust->get_controls(),
			'title_field' => '{{{ text }}}',
			'default'     => array(
				array(
					'icon' => array( 'value' => 'fas fa-truck', 'library' => 'fa-solid' ),
					'text' => __( 'Complimentary shipping over S$85', 'mizuki-booking' ),
				),
				array(
					'icon' => array( 'value' => 'fas fa-leaf', 'library' => 'fa-solid' ),
					'text' => __( 'Sustainable packaging', 'mizuki-booking' ),
				),
			),
		) );

		$this->add_control( 'hero_show_cats', array(
			'label'        => __( 'Show the product’s categories', 'mizuki-booking' ),
			'type'         => \Elementor\Controls_Manager::SWITCHER,
			'label_on'     => __( 'Yes', 'mizuki-booking' ),
			'label_off'    => __( 'No', 'mizuki-booking' ),
			'return_value' => 'yes',
			'default'      => 'yes',
			'description'  => __( 'Read from WooCommerce, so re-filing the product updates the page.', 'mizuki-booking' ),
		) );

		$this->end_controls_section();
	}

	private function register_routine_controls() {
		$this->start_controls_section( 'section_routine', array( 'label' => __( 'The routine', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'routine_show', __( 'Show the routine', 'mizuki-booking' ) );

		$this->add_control( 'routine_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'A Complete Botanical Routine', 'mizuki-booking' ),
		) );

		$this->add_control( 'routine_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Designed to work in harmony, offering hydration, protection, and deep nourishment from morning to night.', 'mizuki-booking' ),
		) );

		$stepper = new \Elementor\Repeater();
		$stepper->add_control( 'icon', array(
			'label'   => __( 'Icon', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::ICONS,
			'default' => array( 'value' => 'fas fa-tint', 'library' => 'fa-solid' ),
		) );
		$stepper->add_control( 'label', array(
			'label'   => __( 'Label', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( '1. Awaken', 'mizuki-booking' ),
		) );
		$stepper->add_control( 'text', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => '',
		) );

		$this->add_control( 'routine_steps', array(
			'label'       => __( 'Steps', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $stepper->get_controls(),
			'title_field' => '{{{ label }}}',
			'default'     => array(
				array(
					'icon'  => array( 'value' => 'fas fa-tint', 'library' => 'fa-solid' ),
					'label' => __( '1. Awaken', 'mizuki-booking' ),
					'text'  => __( 'Hydrate and prep with steam-distilled essence.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-leaf', 'library' => 'fa-solid' ),
					'label' => __( '2. Nourish', 'mizuki-booking' ),
					'text'  => __( 'Deliver targeted botanical actives and collagen.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-shield-alt', 'library' => 'fa-solid' ),
					'label' => __( '3. Protect', 'mizuki-booking' ),
					'text'  => __( 'Seal in moisture and repair overnight.', 'mizuki-booking' ),
				),
			),
		) );

		$this->end_controls_section();
	}

	private function register_extract_controls() {
		$this->start_controls_section( 'section_extract', array( 'label' => __( 'Botanical science', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'extract_show', __( 'Show this section', 'mizuki-booking' ) );

		$this->add_control( 'extract_image', array(
			'label'   => __( 'Main image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'three' ) ),
		) );

		$this->add_control( 'extract_inset', array(
			'label'   => __( 'Inset image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'two' ) ),
		) );

		$this->add_control( 'extract_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Botanical Science', 'mizuki-booking' ),
		) );

		$this->add_control( 'extract_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'The Extraction Protocol', 'mizuki-booking' ),
		) );

		$this->add_control( 'extract_body', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'Utilizing cold-press technology and precise distillation, we preserve the delicate lipid structures of our botanical ingredients. The resulting textures are both lightweight and deeply nourishing.', 'mizuki-booking' ) . '</p>',
		) );

		$point = new \Elementor\Repeater();
		$point->add_control( 'title', array(
			'label'   => __( 'Title', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );
		$point->add_control( 'text', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => '',
		) );

		$this->add_control( 'extract_points', array(
			'label'       => __( 'Points', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $point->get_controls(),
			'title_field' => '{{{ title }}}',
			'default'     => array(
				array(
					'title' => __( 'Lipid Affinity', 'mizuki-booking' ),
					'text'  => __( 'Formulated to complement the skin’s natural sebum profile, supporting rapid absorption and a comfortable, lightweight finish.', 'mizuki-booking' ),
				),
				array(
					'title' => __( 'Structural Integrity', 'mizuki-booking' ),
					'text'  => __( 'Breathable, skin-comforting layers help retain moisture and support botanical actives without a heavy or occlusive feel.', 'mizuki-booking' ),
				),
			),
		) );

		$this->end_controls_section();
	}

	private function register_ritual_controls() {
		$this->start_controls_section( 'section_ritual', array( 'label' => __( 'The steps', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'ritual_show', __( 'Show the steps', 'mizuki-booking' ) );

		$this->add_control( 'ritual_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'The Four-Step Ritual', 'mizuki-booking' ),
		) );

		$step = new \Elementor\Repeater();

		$step->add_control( 'image', array(
			'label'   => __( 'Image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'two' ) ),
		) );
		$step->add_control( 'number', array(
			'label'   => __( 'Step', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '01',
		) );
		$step->add_control( 'name', array(
			'label'   => __( 'Name', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );
		$step->add_control( 'features', array(
			'label'   => __( 'Features', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 4,
			'default' => '',
		) );
		$step->add_control( 'ingredients', array(
			'label'       => __( 'Ingredient highlights', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 3,
			'default'     => '',
			'description' => __( 'Left out when empty.', 'mizuki-booking' ),
		) );
		$step->add_control( 'texture', array(
			'label'   => __( 'Texture and feel', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => '',
		) );
		$step->add_control( 'suitable', array(
			'label'   => __( 'Suitable for', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => '',
		) );
		$step->add_control( 'howto', array(
			'label'       => __( 'How to use', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 5,
			'default'     => '',
			'description' => __( 'One step per line; they are numbered for you.', 'mizuki-booking' ),
		) );
		$step->add_control( 'pairing', array(
			'label'       => __( 'Pairing suggestion', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 2,
			'default'     => '',
			'description' => __( 'Left out when empty.', 'mizuki-booking' ),
		) );

		$this->add_control( 'ritual_steps', array(
			'label'       => __( 'Steps', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $step->get_controls(),
			'title_field' => '{{{ number }}} — {{{ name }}}',
			'default'     => $this->default_ritual_steps(),
		) );

		$this->end_controls_section();
	}

	private function default_ritual_steps() {
		return array(
			array(
				'image'    => array( 'url' => $this->stock( 'two' ) ),
				'number'   => '01',
				'name'     => __( 'Pure Rose Water Mist', 'mizuki-booking' ),
				'features' => __( 'Steam-distilled from Damask roses and blended with rose essence for a natural, subtle floral scent. Enriched with betaine to boost the skin’s hydration level.', 'mizuki-booking' ),
				'texture'  => __( 'Water-light, refreshing, and effortlessly absorbed. Ideal as a pre-skincare hydrating step or as an anytime mist. Gentle enough to use on bare skin.', 'mizuki-booking' ),
				'suitable' => __( 'Oily skin, combination skin, or anyone who prefers a simple, gentle daily hydrator.', 'mizuki-booking' ),
				'howto'    => __( "After cleansing, morning and night, spray directly onto the face as the first hydrating step.\nReapply in multiple light layers when additional hydration is needed.\nMist throughout the day to refresh and soothe dry-feeling skin.", 'mizuki-booking' ),
				'pairing'  => __( 'Follow with the Facial Collagen Serum or Everyday Lotion to support moisture retention.', 'mizuki-booking' ),
			),
			array(
				'image'    => array( 'url' => $this->stock( 'three' ) ),
				'number'   => '02',
				'name'     => __( 'Facial Collagen Serum', 'mizuki-booking' ),
				'features' => __( 'A repair-focused formula that feels lightweight while providing deep nourishment. Formulated with French immortelle essential oil, edelweiss extract, calendula extract, and hydrolyzed collagen.', 'mizuki-booking' ),
				'texture'  => __( 'Helps soothe feelings of dryness and discomfort while supporting skin that feels unsettled during seasonal changes.', 'mizuki-booking' ),
				'suitable' => __( 'Skin that feels sensitive or needs extra comfort during seasonal shifts.', 'mizuki-booking' ),
				'howto'    => __( "After cleansing and misting, apply 2–3 drops evenly over the face.\nApply a little extra to areas that need additional care, such as the cheeks and sides of the nose.\nGently press into the skin with fingertips; do not rub vigorously.", 'mizuki-booking' ),
				'pairing'  => __( 'Use after the Pure Rose Water Mist, then follow with Everyday Lotion or Orange Blossom Nourishing Oil to seal in moisture.', 'mizuki-booking' ),
			),
			array(
				'image'    => array( 'url' => $this->stock( 'two' ) ),
				'number'   => '03',
				'name'     => __( 'Everyday Lotion', 'mizuki-booking' ),
				'features' => __( 'A lightweight, fast-absorbing daily moisturizer with a soft natural gardenia scent. Formulated with edelweiss extract, calendula extract, and jojoba oil.', 'mizuki-booking' ),
				'texture'  => __( 'Nourishes and comforts dry-feeling skin while leaving the complexion soft, smooth, and fresh—not heavy or greasy. Designed for daily use, morning and night.', 'mizuki-booking' ),
				'suitable' => __( 'Oily, combination, or any skin type seeking a gentle daily moisturizer.', 'mizuki-booking' ),
				'howto'    => __( "Apply an appropriate amount to the face and neck.\nUse after facial mist and serum to layer hydration and nourishment.\nIt may also be used alone as a simple daytime or nighttime moisturizer.", 'mizuki-booking' ),
				'pairing'  => __( 'For a richer night ritual, layer with Orange Blossom Nourishing Oil.', 'mizuki-booking' ),
			),
			array(
				'image'       => array( 'url' => $this->stock( 'three' ) ),
				'number'      => '04',
				'name'        => __( 'Orange Blossom Nourishing Oil', 'mizuki-booking' ),
				'features'    => __( 'A fine, lightweight facial oil that absorbs quickly without a greasy feel—a simple final ritual to close the day.', 'mizuki-booking' ),
				'ingredients' => __( 'Neroli (orange blossom), frankincense, and myrrh essential oils blended with argan oil and moringa seed oil.', 'mizuki-booking' ),
				'texture'     => __( 'Best used at night. Skin feels softer and more radiant by morning.', 'mizuki-booking' ),
				'suitable'    => __( 'Dry skin, mature skin, and anyone who enjoys facial massage or a richer nighttime nourishment step.', 'mizuki-booking' ),
				'howto'       => __( "As the final step of the evening routine, warm 2–3 drops between the palms.\nGently press onto the face, adding a light facial massage if desired.\nUse before sleep for skin that feels soft and luminous the next morning.", 'mizuki-booking' ),
				'pairing'     => '',
			),
		);
	}

	private function register_about_controls() {
		$this->start_controls_section( 'section_about', array( 'label' => __( 'The brand', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'about_show', __( 'Show the brand', 'mizuki-booking' ) );

		$this->add_control( 'about_image', array(
			'label'   => __( 'Image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'one' ) ),
		) );

		$this->add_control( 'about_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'The Naturepresso Standard', 'mizuki-booking' ),
		) );

		$this->add_control( 'about_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Rooted in Nature.', 'mizuki-booking' ),
		) );

		$this->add_control( 'about_title_second', array(
			'label'   => __( 'Heading, second line', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Refined for Everyday Skin.', 'mizuki-booking' ),
		) );

		$this->add_control( 'about_body', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'Naturepresso is a premium Taiwanese skincare brand crafted under strict local regulations and quality standards. Every product is carefully tested to provide confidence in its safety and everyday performance.', 'mizuki-booking' ) . '</p>'
				. '<p>' . __( 'Inspired by nature, its formulations combine thoughtfully selected natural ingredients with essential oils to nourish skin gently and effectively. Lightweight, fast-absorbing textures are designed for Southeast Asia’s hot and humid climate, offering a comfortable skincare ritual from morning to night.', 'mizuki-booking' ) . '</p>',
		) );

		$this->add_control( 'about_badges', array(
			'label'       => __( 'Badges', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 4,
			'default'     => "Premium Taiwanese Formulations\nThoughtfully Tested\nLightweight for Humid Climates",
			'description' => __( 'One per line.', 'mizuki-booking' ),
		) );

		$this->end_controls_section();
	}

	private function register_more_controls() {
		$this->start_controls_section( 'section_more', array( 'label' => __( 'More products', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'more_show', __( 'Show more products', 'mizuki-booking' ) );

		$this->add_control( 'more_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Continue Your Botanical Ritual', 'mizuki-booking' ),
		) );

		$this->add_control( 'more_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Explore more skin-loving essentials from Naturepresso.', 'mizuki-booking' ),
		) );

		$item = new \Elementor\Repeater();
		$this->product_control( $item, 'product', __( 'Product', 'mizuki-booking' ) );
		$item->add_control( 'label', array(
			'label'       => __( 'Label above the name', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '',
			'description' => __( 'Leave empty to use the product’s first category.', 'mizuki-booking' ),
		) );
		$item->add_control( 'image', array(
			'label'       => __( 'Image', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::MEDIA,
			'default'     => array( 'url' => '' ),
			'description' => __( 'Leave empty to use the product’s own image.', 'mizuki-booking' ),
		) );
		$item->add_control( 'show_price', array(
			'label'        => __( 'Show the price', 'mizuki-booking' ),
			'type'         => \Elementor\Controls_Manager::SWITCHER,
			'label_on'     => __( 'Yes', 'mizuki-booking' ),
			'label_off'    => __( 'No', 'mizuki-booking' ),
			'return_value' => 'yes',
			'default'      => '',
		) );

		$this->add_control( 'more_items', array(
			'label'       => __( 'Products', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $item->get_controls(),
			'title_field' => '{{{ label || "Product" }}}',
			'default'     => array(),
			'description' => __( 'The section is left out entirely until at least one product is chosen.', 'mizuki-booking' ),
		) );

		$this->add_control( 'more_link_text', array(
			'label'   => __( 'Link', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Explore Naturepresso', 'mizuki-booking' ),
		) );

		$this->add_control( 'more_link', array(
			'label'   => __( 'Link address', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );

		$this->end_controls_section();
	}

	private function register_faq_controls() {
		$this->start_controls_section( 'section_faq', array( 'label' => __( 'Questions', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'faq_show', __( 'Show the questions', 'mizuki-booking' ) );

		$this->add_control( 'faq_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Your Ritual, Answered', 'mizuki-booking' ),
		) );

		$faq = new \Elementor\Repeater();
		$faq->add_control( 'q', array(
			'label'       => __( 'Question', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'label_block' => true,
			'default'     => '',
		) );
		$faq->add_control( 'a', array(
			'label'   => __( 'Answer', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 4,
			'default' => '',
		) );

		$this->add_control( 'faqs', array(
			'label'       => __( 'Questions', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $faq->get_controls(),
			'title_field' => '{{{ q }}}',
			'default'     => array(
				array(
					'q' => __( 'What is included in the Naturepresso Box Set?', 'mizuki-booking' ),
					'a' => __( 'The box set includes our complete four-step botanical ritual: the Pure Rose Water Mist, Facial Collagen Serum, Everyday Lotion, and Orange Blossom Nourishing Oil. Each product is formulated to work in harmony for gentle, everyday nourishment.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Is this routine suitable for sensitive skin?', 'mizuki-booking' ),
					'a' => __( 'Yes, our formulations are created with gentle, plant-based ingredients designed to nourish and comfort. However, we always recommend patch-testing any new skincare product if your skin is particularly sensitive.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'In what order should I use the products?', 'mizuki-booking' ),
					'a' => __( 'We recommend starting with the Pure Rose Water Mist to hydrate, followed by the Facial Collagen Serum to target nourishment. Next, apply the Everyday Lotion to comfort the skin, and finish your evening routine with the Orange Blossom Nourishing Oil.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Can I use the products in Singapore’s humid climate?', 'mizuki-booking' ),
					'a' => __( 'Absolutely. The Naturepresso line is specifically formulated with lightweight, non-occlusive textures that absorb rapidly, making them exceptionally comfortable in hot and humid Southeast Asian climates.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Is the box set suitable as a gift?', 'mizuki-booking' ),
					'a' => __( 'Yes, the Naturepresso Box Set is beautifully presented in our signature sustainable packaging, making it a thoughtful and elegant gift for yourself or a loved one.', 'mizuki-booking' ),
				),
			),
		) );

		$this->add_control( 'faq_link_text', array(
			'label'   => __( 'Link', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'View Delivery & FAQs', 'mizuki-booking' ),
		) );

		$this->add_control( 'faq_link', array(
			'label'   => __( 'Link address', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );

		$this->end_controls_section();
	}

	private function register_sticky_controls() {
		$this->start_controls_section( 'section_sticky', array( 'label' => __( 'Phone bar', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'sticky_show', __( 'Show the bar on phones', 'mizuki-booking' ) );

		$this->add_control( 'sticky_button', array(
			'label'   => __( 'Button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Add to Bag', 'mizuki-booking' ),
		) );

		$this->add_control(
			'sticky_note',
			array(
				'type'            => \Elementor\Controls_Manager::RAW_HTML,
				'raw'             => __( 'Slides up once the main Add to bag has scrolled past. Needs a product, and never appears on a desktop.', 'mizuki-booking' ),
				'content_classes' => 'elementor-descriptor',
			)
		);

		$this->end_controls_section();
	}

	/**
	 * -------------------------------------------------------------------------
	 * Drawing
	 * -------------------------------------------------------------------------
	 */

	private function get( $s, $key, $fallback = '' ) {
		return isset( $s[ $key ] ) && '' !== $s[ $key ] ? $s[ $key ] : $fallback;
	}

	private function rows( $s, $key ) {
		return isset( $s[ $key ] ) && is_array( $s[ $key ] ) ? $s[ $key ] : array();
	}

	private function image_url( $s, $key ) {
		return isset( $s[ $key ]['url'] ) ? $s[ $key ]['url'] : '';
	}

	/** A section shows unless its switch says otherwise; an absent switch is an older instance. */
	private function showing( $s, $key ) {
		return ! isset( $s[ $key ] ) || 'yes' === $s[ $key ];
	}

	private function on( $s, $key ) {
		return isset( $s[ $key ] ) && 'yes' === $s[ $key ];
	}

	private function lines( $text ) {
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return array();
		}

		return array_values( array_filter( array_map( 'trim', preg_split( '/\R/', $text ) ), function ( $row ) {
			return '' !== $row;
		} ) );
	}

	private function line( $tag, $class, $text ) {
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return;
		}

		printf(
			'<%1$s%2$s>%3$s</%1$s>',
			tag_escape( $tag ),
			$class ? ' class="' . esc_attr( $class ) . '"' : '',
			esc_html( $text )
		);
	}

	private function rich( $html, $class ) {
		if ( ! is_string( $html ) || '' === trim( wp_strip_all_tags( $html ) ) ) {
			return;
		}

		printf( '<div class="%s">%s</div>', esc_attr( $class ), wp_kses_post( $html ) );
	}

	private function icon( $row, $class ) {
		if ( empty( $row['icon']['value'] ) || ! class_exists( '\Elementor\Icons_Manager' ) ) {
			return;
		}

		printf( '<span class="%s">', esc_attr( $class ) );
		\Elementor\Icons_Manager::render_icon( $row['icon'], array( 'aria-hidden' => 'true' ) );
		echo '</span>';
	}

	private function svg( $paths ) {
		return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">' . $paths . '</svg>';
	}

	protected function render_widget() {
		$s       = $this->get_settings_for_display();
		$product = $this->product( $this->get( $s, 'product_id' ) );

		echo '<div class="mzk-pdp">';

		if ( $this->showing( $s, 'crumbs_show' ) ) {
			$this->render_crumbs( $s, $product );
		}
		if ( $this->showing( $s, 'hero_show' ) ) {
			$this->render_hero( $s, $product );
		}
		if ( $this->showing( $s, 'routine_show' ) ) {
			$this->render_routine( $s );
		}
		if ( $this->showing( $s, 'extract_show' ) ) {
			$this->render_extract( $s );
		}
		if ( $this->showing( $s, 'ritual_show' ) ) {
			$this->render_ritual( $s );
		}
		if ( $this->showing( $s, 'about_show' ) ) {
			$this->render_about( $s );
		}
		if ( $this->showing( $s, 'more_show' ) ) {
			$this->render_more( $s );
		}
		if ( $this->showing( $s, 'faq_show' ) ) {
			$this->render_faq( $s );
		}

		echo '</div>';

		if ( $this->showing( $s, 'sticky_show' ) ) {
			$this->render_sticky( $s, $product );
		}
	}

	/** The name this page goes by: what was typed, else the product's own. */
	private function product_name( $s, $product ) {
		$typed = $this->get( $s, 'hero_title' );

		if ( '' !== trim( $typed ) ) {
			return $typed;
		}

		return $product ? $product->get_name() : '';
	}

	private function render_crumbs( $s, $product ) {
		$trail = $this->rows( $s, 'crumbs' );
		$last  = $this->get( $s, 'crumbs_last_text' );

		if ( '' === trim( $last ) && $this->on( $s, 'crumbs_last' ) ) {
			$last = $this->product_name( $s, $product );
		}

		if ( ! $trail && '' === trim( $last ) ) {
			return;
		}

		echo '<nav class="mzk-pdp-crumbs mzk-pdp__inner" aria-label="' . esc_attr__( 'Breadcrumb', 'mizuki-booking' ) . '">';
		echo '<ol class="mzk-pdp-crumbs__list">';

		$first = true;

		foreach ( $trail as $crumb ) {
			$label = isset( $crumb['label'] ) ? trim( (string) $crumb['label'] ) : '';
			if ( '' === $label ) {
				continue;
			}

			if ( ! $first ) {
				echo '<li class="mzk-pdp-crumbs__sep" aria-hidden="true">/</li>';
			}
			$first = false;

			$link = isset( $crumb['link'] ) ? trim( (string) $crumb['link'] ) : '';

			echo '<li>';
			if ( '' !== $link ) {
				printf( '<a href="%s">%s</a>', esc_url( $link ), esc_html( $label ) );
			} else {
				echo esc_html( $label );
			}
			echo '</li>';
		}

		if ( '' !== trim( $last ) ) {
			if ( ! $first ) {
				echo '<li class="mzk-pdp-crumbs__sep" aria-hidden="true">/</li>';
			}
			printf(
				'<li class="mzk-pdp-crumbs__here" aria-current="page">%s</li>',
				esc_html( $last )
			);
		}

		echo '</ol></nav>';
	}

	/**
	 * The gallery: what was chosen in Elementor, or failing that the product's own images.
	 *
	 * Falling back rather than requiring one means a second product page needs no picture work at
	 * all — point it at a product and it shows what WooCommerce already has.
	 */
	private function gallery_images( $s, $product ) {
		$images = array();

		foreach ( $this->rows( $s, 'hero_gallery' ) as $image ) {
			if ( ! empty( $image['url'] ) ) {
				$images[] = $image['url'];
			}
		}

		if ( $images || ! $product ) {
			return $images;
		}

		$ids = array_merge(
			array( $product->get_image_id() ),
			(array) $product->get_gallery_image_ids()
		);

		foreach ( array_unique( array_filter( $ids ) ) as $id ) {
			$url = wp_get_attachment_image_url( (int) $id, 'large' );
			if ( $url ) {
				$images[] = $url;
			}
		}

		return $images;
	}

	private function render_hero( $s, $product ) {
		$images = $this->gallery_images( $s, $product );
		$name   = $this->product_name( $s, $product );

		echo '<section class="mzk-pdp-hero mzk-pdp__inner">';
		echo '<div class="mzk-pdp-hero__grid">';

		/* Gallery */
		echo '<div class="mzk-pdp-hero__gallery">';

		if ( $images ) {
			echo '<div class="mzk-pdp-gallery" data-mzk-gallery>';
			printf(
				'<div class="mzk-pdp-gallery__stage"><img src="%s" alt="%s" data-mzk-gallery-stage /></div>',
				esc_url( $images[0] ),
				esc_attr( $name )
			);

			if ( count( $images ) > 1 ) {
				// Arrows go inside the stage so they sit over the picture, and are added after it
				// so the image is first in the source for anything reading the page in order.
				echo '<div class="mzk-pdp-gallery__thumbs" role="list">';
				foreach ( $images as $index => $url ) {
					printf(
						'<button type="button" class="mzk-pdp-gallery__thumb" data-index="%1$d" aria-current="%2$s" aria-label="%3$s"><img src="%4$s" alt="" loading="lazy" /></button>',
						(int) $index,
						0 === $index ? 'true' : 'false',
						esc_attr( sprintf(
							/* translators: %d: the picture's place in the gallery. */
							__( 'Show picture %d', 'mizuki-booking' ),
							(int) $index + 1
						) ),
						esc_url( $url )
					);
				}
				echo '</div>';
			}

			echo '</div>';
		}

		echo '</div>';

		/* Info */
		echo '<div class="mzk-pdp-hero__info">';

		$this->line( 'span', 'mzk-pdp__eyebrow', $this->get( $s, 'hero_eyebrow' ) );
		$this->line( 'h1', 'mzk-pdp-hero__title', $name );

		if ( $product && $this->on( $s, 'hero_show_price' ) ) {
			$price = $product->get_price_html();
			if ( $price ) {
				// get_price_html() returns markup — del/ins for a sale, a currency span — so it
				// is filtered rather than escaped, or a sale price arrives as visible tags.
				printf( '<div class="mzk-pdp-hero__price">%s</div>', wp_kses_post( $price ) );
			}
		}

		echo '<hr class="mzk-pdp-hero__rule" />';

		$this->line( 'p', 'mzk-pdp-hero__lede', $this->get( $s, 'hero_lede' ) );
		$this->rich( $this->get( $s, 'hero_body' ), 'mzk-pdp-hero__body' );

		$list = $this->lines( $this->get( $s, 'hero_list' ) );
		if ( $list ) {
			echo '<ul class="mzk-pdp-hero__list">';
			foreach ( $list as $item ) {
				printf( '<li>%s</li>', esc_html( $item ) );
			}
			echo '</ul>';
		}

		$this->line( 'div', 'mzk-pdp-hero__tagline', $this->get( $s, 'hero_tagline' ) );

		$this->render_buy( $s, $product );

		$trust = $this->rows( $s, 'hero_trust' );
		if ( $trust ) {
			echo '<hr class="mzk-pdp-hero__rule" />';
			echo '<ul class="mzk-pdp-trust">';
			foreach ( $trust as $row ) {
				$text = isset( $row['text'] ) ? trim( (string) $row['text'] ) : '';
				if ( '' === $text ) {
					continue;
				}
				echo '<li>';
				$this->icon( $row, 'mzk-pdp-trust__icon' );
				printf( '<span>%s</span>', esc_html( $text ) );
				echo '</li>';
			}
			echo '</ul>';
		}

		if ( $product && $this->on( $s, 'hero_show_cats' ) ) {
			$this->render_categories( $product );
		}

		echo '</div>';

		echo '</div></section>';
	}

	/**
	 * Add to bag.
	 *
	 * A plain form posting `add-to-cart`, which is what WooCommerce itself listens for on every
	 * page, not only a product page. So it works with the script blocked, it works in a new tab,
	 * and it goes through the same validation, stock check and hooks as the shop's own button —
	 * which a hand-rolled AJAX call would quietly skip.
	 */
	private function render_buy( $s, $product ) {
		if ( ! $product ) {
			return;
		}

		if ( ! $product->is_purchasable() || ! $product->is_in_stock() ) {
			printf(
				'<p class="mzk-pdp-hero__tagline">%s</p>',
				esc_html__( 'Currently unavailable', 'mizuki-booking' )
			);
			return;
		}

		$label = $this->get( $s, 'hero_button', __( 'Add to Bag', 'mizuki-booking' ) );

		/*
		 * The form still posts to WooCommerce the ordinary way; the script upgrades it to a
		 * request that does not leave the page. So the button works with JavaScript blocked, in a
		 * new tab, and if the endpoint is ever unreachable — and either way the adding is done by
		 * WooCommerce, with its own stock check, validation and hooks.
		 *
		 * Left off when the shop is set to send people to the cart after adding: that is a
		 * deliberate choice by whoever set it, and staying put would quietly undo it.
		 */
		$ajax = '';

		if ( class_exists( 'WC_AJAX' ) && 'yes' !== get_option( 'woocommerce_cart_redirect_after_add' ) ) {
			$ajax = \WC_AJAX::get_endpoint( 'add_to_cart' );
		}

		printf(
			'<form class="mzk-pdp-buy" method="post" action="%s" data-mzk-buy%s>',
			esc_url( $product->get_permalink() ),
			$ajax ? ' data-mzk-ajax="' . esc_url( $ajax ) . '"' : ''
		);

		printf( '<input type="hidden" name="add-to-cart" value="%d" />', (int) $product->get_id() );

		echo '<div class="mzk-pdp-qty">';
		printf(
			'<button type="button" class="mzk-pdp-qty__btn" data-mzk-qty="-1" aria-label="%s">%s</button>',
			esc_attr__( 'One fewer', 'mizuki-booking' ),
			$this->svg( '<line x1="5" y1="12" x2="19" y2="12"/>' ) // phpcs:ignore WordPress.Security.EscapeOutput
		);
		printf(
			'<input class="mzk-pdp-qty__input" type="number" name="quantity" value="1" min="1" step="1" inputmode="numeric" aria-label="%s" />',
			esc_attr__( 'Quantity', 'mizuki-booking' )
		);
		printf(
			'<button type="button" class="mzk-pdp-qty__btn" data-mzk-qty="1" aria-label="%s">%s</button>',
			esc_attr__( 'One more', 'mizuki-booking' ),
			$this->svg( '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' ) // phpcs:ignore WordPress.Security.EscapeOutput
		);
		echo '</div>';

		printf(
			'<button type="submit" class="mzk-pdp__btn mzk-pdp-buy__submit" data-mzk-busy="%s">%s</button>',
			esc_attr( $this->get( $s, 'hero_button_busy', __( 'Adding…', 'mizuki-booking' ) ) ),
			esc_html( $label )
		);

		echo '</form>';

		/*
		 * Where the confirmation goes. Empty and polite, so a screen reader announces it when it
		 * fills rather than reading an empty box on arrival — and rendered whether or not the
		 * script is there, because it costs nothing and the alternative is creating it at the
		 * moment it is needed, which is the moment least likely to go well.
		 */
		printf(
			'<p class="mzk-pdp-buy__said" data-mzk-said data-added="%1$s" data-cart="%2$s" data-cart-url="%3$s" role="status" aria-live="polite" hidden></p>',
			esc_attr( $this->get( $s, 'hero_added_text', __( 'Added to your bag.', 'mizuki-booking' ) ) ),
			esc_attr( $this->get( $s, 'hero_cart_text', __( 'View bag', 'mizuki-booking' ) ) ),
			esc_url( function_exists( 'wc_get_cart_url' ) ? wc_get_cart_url() : '' )
		);
	}

	private function render_categories( $product ) {
		$terms = get_the_terms( $product->get_id(), 'product_cat' );

		if ( ! $terms || is_wp_error( $terms ) ) {
			return;
		}

		$links = array();

		foreach ( $terms as $term ) {
			$url = get_term_link( $term );
			if ( is_wp_error( $url ) ) {
				continue;
			}
			$links[] = sprintf( '<a href="%s">%s</a>', esc_url( $url ), esc_html( $term->name ) );
		}

		if ( ! $links ) {
			return;
		}

		printf(
			'<div class="mzk-pdp-hero__meta"><span>%s</span> %s</div>',
			esc_html( _n( 'Category:', 'Categories:', count( $links ), 'mizuki-booking' ) ),
			implode( ', ', $links ) // phpcs:ignore WordPress.Security.EscapeOutput -- escaped above.
		);
	}

	private function render_routine( $s ) {
		$steps = $this->rows( $s, 'routine_steps' );

		echo '<section class="mzk-pdp-routine"><div class="mzk-pdp__inner mzk-pdp-routine__inner">';
		$this->line( 'h2', 'mzk-pdp__h2', $this->get( $s, 'routine_title' ) );
		$this->line( 'p', 'mzk-pdp__lede mzk-pdp-routine__intro', $this->get( $s, 'routine_intro' ) );

		if ( $steps ) {
			echo '<div class="mzk-pdp-routine__steps">';

			$first = true;
			foreach ( $steps as $step ) {
				if ( ! $first ) {
					echo '<div class="mzk-pdp-routine__rule" aria-hidden="true"></div>';
				}
				$first = false;

				echo '<div class="mzk-pdp-routine__step">';
				echo '<div class="mzk-pdp-routine__dial">';
				$this->icon( $step, 'mzk-pdp-routine__glyph' );
				echo '</div>';
				$this->line( 'div', 'mzk-pdp-routine__label', isset( $step['label'] ) ? $step['label'] : '' );
				$this->line( 'p', 'mzk-pdp-routine__text', isset( $step['text'] ) ? $step['text'] : '' );
				echo '</div>';
			}

			echo '</div>';
		}

		echo '</div></section>';
	}

	private function render_extract( $s ) {
		$main   = $this->image_url( $s, 'extract_image' );
		$inset  = $this->image_url( $s, 'extract_inset' );
		$points = $this->rows( $s, 'extract_points' );

		echo '<section class="mzk-pdp-extract"><div class="mzk-pdp__inner mzk-pdp-extract__grid">';

		if ( $main || $inset ) {
			echo '<div class="mzk-pdp-extract__media">';
			if ( $main ) {
				printf( '<div class="mzk-pdp-extract__main"><img src="%s" alt="" loading="lazy" /></div>', esc_url( $main ) );
			}
			if ( $inset ) {
				printf( '<div class="mzk-pdp-extract__inset"><img src="%s" alt="" loading="lazy" /></div>', esc_url( $inset ) );
			}
			echo '</div>';
		}

		echo '<div class="mzk-pdp-extract__text">';
		$this->line( 'span', 'mzk-pdp__eyebrow', $this->get( $s, 'extract_eyebrow' ) );
		$this->line( 'h2', 'mzk-pdp__h2', $this->get( $s, 'extract_title' ) );
		$this->rich( $this->get( $s, 'extract_body' ), 'mzk-pdp__lede mzk-pdp-extract__body' );

		if ( $points ) {
			echo '<ul class="mzk-pdp-points">';
			foreach ( $points as $point ) {
				echo '<li>';
				$this->line( 'h3', 'mzk-pdp-points__title', isset( $point['title'] ) ? $point['title'] : '' );
				$this->line( 'p', 'mzk-pdp-points__text', isset( $point['text'] ) ? $point['text'] : '' );
				echo '</li>';
			}
			echo '</ul>';
		}

		echo '</div></div></section>';
	}

	private function render_ritual( $s ) {
		$steps = $this->rows( $s, 'ritual_steps' );

		echo '<section class="mzk-pdp-ritual"><div class="mzk-pdp__inner">';

		$title = $this->get( $s, 'ritual_title' );
		if ( '' !== trim( $title ) ) {
			echo '<div class="mzk-pdp-ritual__head">';
			$this->line( 'h2', 'mzk-pdp__h2', $title );
			echo '</div>';
		}

		if ( ! $steps ) {
			echo '</div></section>';
			return;
		}

		echo '<div class="mzk-pdp-ritual__steps">';

		foreach ( $steps as $index => $step ) {
			// Alternating sides, so the eye is not walked down one column for four screens.
			printf(
				'<div class="mzk-pdp-step%s">',
				( $index % 2 ) ? ' mzk-pdp-step--flip' : ''
			);

			$image = isset( $step['image']['url'] ) ? $step['image']['url'] : '';
			if ( $image ) {
				printf(
					'<div class="mzk-pdp-step__media"><div class="mzk-pdp-step__frame"><img src="%s" alt="%s" loading="lazy" /></div></div>',
					esc_url( $image ),
					esc_attr( isset( $step['name'] ) ? $step['name'] : '' )
				);
			}

			echo '<div class="mzk-pdp-step__text">';

			$number = isset( $step['number'] ) ? trim( (string) $step['number'] ) : '';
			if ( '' !== $number ) {
				printf(
					'<span class="mzk-pdp__eyebrow">%s</span>',
					esc_html( sprintf(
						/* translators: %s: the step's number, such as 01. */
						__( 'Step %s', 'mizuki-booking' ),
						$number
					) )
				);
			}

			$this->line( 'h3', 'mzk-pdp-step__name', isset( $step['name'] ) ? $step['name'] : '' );

			echo '<div class="mzk-pdp-step__blocks">';

			$ingredients = isset( $step['ingredients'] ) ? trim( (string) $step['ingredients'] ) : '';

			$this->render_step_block(
				// With an ingredients block below it, the first one is the key features rather
				// than all of them — the wording the design uses.
				$ingredients ? __( 'Key Features', 'mizuki-booking' ) : __( 'Features', 'mizuki-booking' ),
				isset( $step['features'] ) ? $step['features'] : ''
			);

			$this->render_step_block( __( 'Ingredient Highlights', 'mizuki-booking' ), $ingredients );
			$this->render_step_block( __( 'Texture & Feel', 'mizuki-booking' ), isset( $step['texture'] ) ? $step['texture'] : '' );
			$this->render_step_block( __( 'Suitable For', 'mizuki-booking' ), isset( $step['suitable'] ) ? $step['suitable'] : '' );

			$howto = $this->lines( isset( $step['howto'] ) ? $step['howto'] : '' );
			if ( $howto ) {
				echo '<hr />';
				echo '<div>';
				$this->line( 'div', 'mzk-pdp-step__label', __( 'How To Use', 'mizuki-booking' ) );
				echo '<ol class="mzk-pdp-step__howto">';
				foreach ( $howto as $instruction ) {
					printf( '<li>%s</li>', esc_html( $instruction ) );
				}
				echo '</ol>';
				echo '</div>';
			}

			$this->render_step_block(
				__( 'Pairing Suggestion', 'mizuki-booking' ),
				isset( $step['pairing'] ) ? $step['pairing'] : '',
				'mzk-pdp-step__value mzk-pdp-step__value--italic'
			);

			echo '</div></div></div>';
		}

		echo '</div></div></section>';
	}

	private function render_step_block( $label, $text, $class = 'mzk-pdp-step__value' ) {
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return;
		}

		echo '<div>';
		$this->line( 'div', 'mzk-pdp-step__label', $label );
		$this->line( 'p', $class, $text );
		echo '</div>';
	}

	private function render_about( $s ) {
		$image  = $this->image_url( $s, 'about_image' );
		$badges = $this->lines( $this->get( $s, 'about_badges' ) );

		echo '<section class="mzk-pdp-about"><div class="mzk-pdp__inner mzk-pdp-about__grid">';

		if ( $image ) {
			printf(
				'<div class="mzk-pdp-about__media"><div class="mzk-pdp-about__frame"><img src="%s" alt="" loading="lazy" /></div></div>',
				esc_url( $image )
			);
		}

		echo '<div class="mzk-pdp-about__text">';
		$this->line( 'span', 'mzk-pdp__eyebrow', $this->get( $s, 'about_eyebrow' ) );

		$title  = $this->get( $s, 'about_title' );
		$second = $this->get( $s, 'about_title_second' );
		if ( '' !== trim( $title ) || '' !== trim( $second ) ) {
			echo '<h2 class="mzk-pdp-about__title">';
			echo esc_html( $title );
			if ( '' !== trim( $second ) ) {
				echo '<br />' . esc_html( $second );
			}
			echo '</h2>';
		}

		$this->rich( $this->get( $s, 'about_body' ), 'mzk-pdp-about__body' );

		if ( $badges ) {
			echo '<ul class="mzk-pdp-about__badges">';
			foreach ( $badges as $badge ) {
				printf( '<li>%s</li>', esc_html( $badge ) );
			}
			echo '</ul>';
		}

		echo '</div></div></section>';
	}

	/**
	 * More products.
	 *
	 * Built from real products, so a name change or a price change on the shop shows here without
	 * anyone touching the page. Nothing is drawn at all until one is chosen — an empty
	 * "Continue your ritual" with three grey boxes under it is worse than no section.
	 */
	private function render_more( $s ) {
		$items = array();

		foreach ( $this->rows( $s, 'more_items' ) as $row ) {
			$product = $this->product( isset( $row['product'] ) ? $row['product'] : '' );
			if ( $product ) {
				$items[] = array( 'row' => $row, 'product' => $product );
			}
		}

		if ( ! $items ) {
			return;
		}

		echo '<section class="mzk-pdp-more"><div class="mzk-pdp__inner">';

		echo '<div class="mzk-pdp-more__head">';
		$this->line( 'h2', 'mzk-pdp__h2', $this->get( $s, 'more_title' ) );
		$this->line( 'p', 'mzk-pdp__lede', $this->get( $s, 'more_intro' ) );
		echo '</div>';

		echo '<div class="mzk-pdp-more__grid">';

		foreach ( $items as $item ) {
			$row     = $item['row'];
			$product = $item['product'];

			$image = ! empty( $row['image']['url'] ) ? $row['image']['url'] : '';
			if ( ! $image ) {
				$image = wp_get_attachment_image_url( (int) $product->get_image_id(), 'large' );
			}

			$label = isset( $row['label'] ) ? trim( (string) $row['label'] ) : '';
			if ( '' === $label ) {
				$terms = get_the_terms( $product->get_id(), 'product_cat' );
				if ( $terms && ! is_wp_error( $terms ) ) {
					$first = reset( $terms );
					$label = $first->name;
				}
			}

			printf( '<a class="mzk-pdp-more__item" href="%s">', esc_url( $product->get_permalink() ) );

			if ( $image ) {
				printf(
					'<span class="mzk-pdp-more__frame"><img src="%s" alt="" loading="lazy" /></span>',
					esc_url( $image )
				);
			}

			if ( '' !== $label ) {
				printf( '<span class="mzk-pdp-more__cat">%s</span>', esc_html( $label ) );
			}

			printf( '<span class="mzk-pdp-more__name">%s</span>', esc_html( $product->get_name() ) );

			if ( ! empty( $row['show_price'] ) && 'yes' === $row['show_price'] ) {
				$price = $product->get_price_html();
				if ( $price ) {
					printf( '<span class="mzk-pdp-more__price">%s</span>', wp_kses_post( $price ) );
				}
			}

			echo '</a>';
		}

		echo '</div>';

		$text = $this->get( $s, 'more_link_text' );
		$link = $this->get( $s, 'more_link' );
		if ( '' !== trim( $text ) && '' !== trim( $link ) ) {
			printf(
				'<div class="mzk-pdp-more__foot"><a class="mzk-pdp__textlink" href="%s">%s</a></div>',
				esc_url( $link ),
				esc_html( $text )
			);
		}

		echo '</div></section>';
	}

	private function render_faq( $s ) {
		$faqs = $this->rows( $s, 'faqs' );

		echo '<section class="mzk-pdp-faq"><div class="mzk-pdp__inner mzk-pdp-faq__inner">';

		$title = $this->get( $s, 'faq_title' );
		if ( '' !== trim( $title ) ) {
			echo '<div class="mzk-pdp-faq__head">';
			$this->line( 'h2', 'mzk-pdp__h2', $title );
			echo '</div>';
		}

		if ( $faqs ) {
			echo '<div class="mzk-pdp-faq__list">';

			$group = 'mzk-pdp-faq-' . $this->get_id();

			foreach ( $faqs as $index => $faq ) {
				$question = isset( $faq['q'] ) ? trim( (string) $faq['q'] ) : '';
				$answer   = isset( $faq['a'] ) ? trim( (string) $faq['a'] ) : '';

				if ( '' === $question ) {
					continue;
				}

				// The first answer is open, so the section does not read as a wall of shut doors.
				$open = 0 === $index;
				$id   = $group . '-' . (int) $index;

				echo '<div class="mzk-pdp-faq__item">';
				printf(
					'<button type="button" class="mzk-pdp-faq__q" aria-expanded="%1$s" aria-controls="%2$s">
						<span>%3$s</span>
						<span class="mzk-pdp-faq__mark">
							<span class="mzk-pdp-faq__mark-plus">%4$s</span>
							<span class="mzk-pdp-faq__mark-minus">%5$s</span>
						</span>
					</button>',
					$open ? 'true' : 'false',
					esc_attr( $id ),
					esc_html( $question ),
					$this->svg( '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>' ), // phpcs:ignore WordPress.Security.EscapeOutput
					$this->svg( '<line x1="5" y1="12" x2="19" y2="12"/>' ) // phpcs:ignore WordPress.Security.EscapeOutput
				);

				printf(
					'<div class="mzk-pdp-faq__a" id="%1$s" data-open="%2$s"><div><p>%3$s</p></div></div>',
					esc_attr( $id ),
					$open ? 'true' : 'false',
					esc_html( $answer )
				);

				echo '</div>';
			}

			echo '</div>';
		}

		$text = $this->get( $s, 'faq_link_text' );
		$link = $this->get( $s, 'faq_link' );
		if ( '' !== trim( $text ) && '' !== trim( $link ) ) {
			printf(
				'<div class="mzk-pdp-faq__foot"><a class="mzk-pdp__textlink" href="%s">%s</a></div>',
				esc_url( $link ),
				esc_html( $text )
			);
		}

		echo '</div></section>';
	}

	/**
	 * The bar that follows you down a phone.
	 *
	 * Its button submits the form above rather than carrying a second one: two forms posting the
	 * same add-to-cart is two ways for the quantity to disagree with what is on screen.
	 */
	private function render_sticky( $s, $product ) {
		if ( ! $product || ! $product->is_purchasable() || ! $product->is_in_stock() ) {
			return;
		}

		$price = $product->get_price_html();
		$label = $this->get( $s, 'sticky_button', __( 'Add to Bag', 'mizuki-booking' ) );

		printf(
			'<div class="mzk-pdp-sticky" data-mzk-sticky hidden>
				<div>
					<span class="mzk-pdp-sticky__price">%1$s</span>
					<span class="mzk-pdp-sticky__name">%2$s</span>
				</div>
				<button type="button" class="mzk-pdp-sticky__btn" data-mzk-sticky-add>%3$s</button>
			</div>',
			wp_kses_post( $price ),
			esc_html( $this->product_name( $s, $product ) ),
			esc_html( $label )
		);
	}
}
