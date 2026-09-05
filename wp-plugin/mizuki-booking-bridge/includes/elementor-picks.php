<?php
/**
 * The Mizuki Picks page, as one widget.
 *
 * Same bargain as the other page widgets: every string and every picture is a control, the look
 * lives in css/picks.css, and each of the seven sections has its own switch.
 *
 * The slider is the part that is not just writing. Each card is a WooCommerce product chosen in
 * the panel, so the name, the price, the picture and the link come from the shop and stay right
 * when the shop changes. Nothing is drawn at all until one is chosen — a "Curated beauty, ready
 * to discover" heading over an empty rail is worse than no section.
 *
 * Nothing here assumes WooCommerce is installed. Every call into it is behind a check, because a
 * widget that fatals when a plugin is deactivated takes the whole site with it.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Mizuki_Elementor_Picks_Page extends \Elementor\Widget_Base {

	use Mizuki_Elementor_Shared;

	public function get_name() {
		return 'mizuki-picks-page';
	}

	public function get_title() {
		return __( 'Mizuki Picks page', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-products';
	}

	public function get_keywords() {
		return array( 'mizuki', 'picks', 'shop', 'woocommerce', 'page', 'curated', 'beauty', 'slider' );
	}

	public function get_style_depends() {
		return array( 'mizuki-picks' );
	}

	public function get_script_depends() {
		return array( 'mizuki-elementor', 'mizuki-picks' );
	}

	/**
	 * -------------------------------------------------------------------------
	 * WooCommerce, at arm's length
	 * -------------------------------------------------------------------------
	 *
	 * The list behind the pickers is shared with the product page widget — same transient, same
	 * two-minute cache for an empty answer, same invalidation when the shop changes.
	 */

	private function woo() {
		return function_exists( 'wc_get_product' ) && function_exists( 'wc_get_products' );
	}

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

		// An empty answer is cached briefly: it means a shop with no products, a query that
		// threw, or a call before WooCommerce was ready, and two of those fix themselves.
		set_transient( 'mizuki_product_choices', $choices, $choices ? HOUR_IN_SECONDS : 2 * MINUTE_IN_SECONDS );

		return $choices;
	}

	/** For a test to check the list at its source; Elementor's control stack cannot be read back. */
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
	 *   add_filter( 'mizuki_picks_default_image', function ( $url, $which ) { ... }, 10, 2 );
	 */
	private function stock( $which ) {
		$images = array(
			'banner'  => 'https://mizuki.com.sg/wp-content/uploads/2024/05/works-hopsbanner.png',
			'floral'  => 'https://mizuki.com.sg/wp-content/uploads/2025/10/IMG_8761-2-819x1024.jpg',
			'group'   => 'https://mizuki.com.sg/wp-content/uploads/2025/10/IMG_8763-2-600x750.jpg',
			'bottle'  => 'https://mizuki.com.sg/wp-content/uploads/2025/10/IMG_8765-2-600x750.jpg',
		);

		$url = isset( $images[ $which ] ) ? $images[ $which ] : '';

		return apply_filters( 'mizuki_picks_default_image', $url, $which );
	}

	/**
	 * -------------------------------------------------------------------------
	 * Controls
	 * -------------------------------------------------------------------------
	 */

	protected function register_controls() {
		$this->register_banner_controls();
		$this->register_intro_controls();
		$this->register_picks_controls();
		$this->register_featured_controls();
		$this->register_why_controls();
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

	private function add_link_controls( $prefix, $label, $text, $link = '' ) {
		$this->add_control( $prefix . '_text', array(
			'label'   => $label,
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => $text,
		) );

		$this->add_control( $prefix . '_link', array(
			'label'       => $label . ' ' . __( 'link', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => $link,
			'description' => __( 'Left out when empty.', 'mizuki-booking' ),
		) );
	}

	private function register_banner_controls() {
		$this->start_controls_section( 'section_banner', array( 'label' => __( 'Banner', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'banner_show', __( 'Show the banner', 'mizuki-booking' ) );

		$this->add_control( 'banner_image', array(
			'label'   => __( 'Background image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'banner' ) ),
		) );

		$this->add_control( 'banner_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Mizuki Picks', 'mizuki-booking' ),
		) );

		$this->add_control( 'banner_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Beauty, Thoughtfully Curated.', 'mizuki-booking' ),
		) );

		$this->add_control( 'banner_lede', array(
			'label'   => __( 'Standfirst', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Botanical beauty essentials selected with the same care we bring to every bloom.', 'mizuki-booking' ),
		) );

		$this->add_control( 'banner_text', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Discover refined skincare and self-care rituals chosen for beautiful everyday moments.', 'mizuki-booking' ),
		) );

		$this->add_link_controls( 'banner_button', __( 'Button', 'mizuki-booking' ), __( 'Shop The Picks', 'mizuki-booking' ), '#mizuki-picks' );
		$this->add_link_controls( 'banner_more', __( 'Text link', 'mizuki-booking' ), __( 'Explore the Collection', 'mizuki-booking' ), '#mizuki-picks' );

		$this->end_controls_section();
	}

	private function register_intro_controls() {
		$this->start_controls_section( 'section_intro', array( 'label' => __( 'Introduction', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'intro_show', __( 'Show the introduction', 'mizuki-booking' ) );

		$this->add_control( 'intro_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'The Mizuki Edit', 'mizuki-booking' ),
		) );

		$this->add_control( 'intro_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'A Beautifully Considered Edit of Care', 'mizuki-booking' ),
		) );

		$this->add_control( 'intro_body', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'Mizuki Picks brings together beauty essentials selected with intention—products that feel refined, gentle, and rewarding to use every day. Inspired by the care, balance, and natural beauty found in our floral world, each pick is chosen to turn ordinary routines into quiet moments of self-care.', 'mizuki-booking' ) . '</p>'
				. '<p>' . __( 'From lightweight skincare to thoughtful gifting, discover beautiful essentials made to fit naturally into your day.', 'mizuki-booking' ) . '</p>',
		) );

		$this->add_link_controls( 'intro_more', __( 'Text link', 'mizuki-booking' ), __( 'Discover What’s In The Edit', 'mizuki-booking' ), '#mizuki-picks' );

		$this->end_controls_section();
	}

	private function register_picks_controls() {
		$this->start_controls_section( 'section_picks', array( 'label' => __( 'The picks', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'picks_show', __( 'Show the picks', 'mizuki-booking' ) );

		$this->add_control( 'picks_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Shop Mizuki Picks', 'mizuki-booking' ),
		) );

		$this->add_control( 'picks_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Curated Beauty, Ready to Discover', 'mizuki-booking' ),
		) );

		$this->add_control( 'picks_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Explore our current selection of refined skincare essentials, chosen for simple rituals, soft textures, and everyday enjoyment.', 'mizuki-booking' ),
		) );

		$this->add_link_controls( 'picks_all', __( 'Text link', 'mizuki-booking' ), __( 'View All Products', 'mizuki-booking' ), '' );

		$card    = new \Elementor\Repeater();
		$choices = $this->product_choices();

		/*
		 * The picker is a picker whenever WooCommerce is here, whatever the list came back with.
		 * Swapping to a text box because the query was empty means a studio who adds their first
		 * product finds a box asking for an ID they have no way to look up.
		 */
		$card->add_control( 'product', array(
			'label'       => __( 'Product', 'mizuki-booking' ),
			'type'        => $this->woo() ? \Elementor\Controls_Manager::SELECT2 : \Elementor\Controls_Manager::TEXT,
			'options'     => $choices,
			'label_block' => true,
			'default'     => '',
			'description' => $this->woo()
				? __( 'The name, price, picture and link all come from this product.', 'mizuki-booking' )
				: __( 'WooCommerce is not active, so there is no list to choose from — enter a product ID.', 'mizuki-booking' ),
		) );

		$card->add_control( 'label', array(
			'label'       => __( 'Label above the name', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '',
			'description' => __( 'Leave empty to use the product’s first category.', 'mizuki-booking' ),
		) );

		$card->add_control( 'text', array(
			'label'       => __( 'Description', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 3,
			'default'     => '',
			'description' => __( 'Leave empty to use the product’s short description.', 'mizuki-booking' ),
		) );

		$card->add_control( 'image', array(
			'label'       => __( 'Image', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::MEDIA,
			'default'     => array( 'url' => '' ),
			'description' => __( 'Leave empty to use the product’s own image.', 'mizuki-booking' ),
		) );

		$card->add_control( 'show_price', array(
			'label'        => __( 'Show the price', 'mizuki-booking' ),
			'type'         => \Elementor\Controls_Manager::SWITCHER,
			'label_on'     => __( 'Yes', 'mizuki-booking' ),
			'label_off'    => __( 'No', 'mizuki-booking' ),
			'return_value' => 'yes',
			'default'      => '',
		) );

		$card->add_control( 'cta', array(
			'label'   => __( 'Link text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'View Product', 'mizuki-booking' ),
		) );

		$this->add_control( 'picks', array(
			'label'       => __( 'Products', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $card->get_controls(),
			'title_field' => '{{{ label || "Product" }}}',
			'default'     => array(),
			'description' => __( 'The whole section is left out until at least one product is chosen.', 'mizuki-booking' ),
		) );

		$this->add_control( 'picks_swipe', array(
			'label'   => __( 'Hint on phones', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Swipe to explore', 'mizuki-booking' ),
		) );

		$this->add_link_controls( 'picks_button', __( 'Button', 'mizuki-booking' ), __( 'Shop All Mizuki Picks', 'mizuki-booking' ), '' );

		$this->end_controls_section();
	}

	private function register_featured_controls() {
		$this->start_controls_section( 'section_featured', array( 'label' => __( 'Featured brand', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'featured_show', __( 'Show the featured brand', 'mizuki-booking' ) );

		$this->add_control( 'featured_image', array(
			'label'   => __( 'Main image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'group' ) ),
		) );

		$this->add_control( 'featured_inset', array(
			'label'   => __( 'Inset image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'bottle' ) ),
		) );

		$this->add_control( 'featured_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Featured Brand', 'mizuki-booking' ),
		) );

		$this->add_control( 'featured_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Discover Naturepresso', 'mizuki-booking' ),
		) );

		$this->add_control( 'featured_lede', array(
			'label'   => __( 'Standfirst', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Botanical skincare for calm, everyday rituals.', 'mizuki-booking' ),
		) );

		$this->add_control( 'featured_body', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'Naturepresso is a premium Taiwanese botanical skincare collection selected for its refined formulas, gentle sensorial experience, and lightweight textures. Made for everyday use, the range layers beautifully from a fresh morning start to a comforting nighttime finish.', 'mizuki-booking' ) . '</p>'
				. '<p>' . __( 'Thoughtfully selected for Mizuki Picks, with lightweight textures that feel especially suited to warm and humid days.', 'mizuki-booking' ) . '</p>',
		) );

		$this->add_link_controls( 'featured_button', __( 'Button', 'mizuki-booking' ), __( 'Explore Naturepresso', 'mizuki-booking' ), '' );

		$this->end_controls_section();
	}

	private function register_why_controls() {
		$this->start_controls_section( 'section_why', array( 'label' => __( 'Why Mizuki Picks', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'why_show', __( 'Show this section', 'mizuki-booking' ) );

		$this->add_control( 'why_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Why Mizuki Picks', 'mizuki-booking' ),
		) );

		$this->add_control( 'why_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Chosen with Care, Made to Enjoy', 'mizuki-booking' ),
		) );

		$this->add_control( 'why_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Every product is selected to make thoughtful beauty feel simple, beautiful, and easy to return to.', 'mizuki-booking' ),
		) );

		$point = new \Elementor\Repeater();
		$point->add_control( 'icon', array(
			'label'   => __( 'Icon', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::ICONS,
			'default' => array( 'value' => 'fas fa-spa', 'library' => 'fa-solid' ),
		) );
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

		$this->add_control( 'why_points', array(
			'label'       => __( 'Points', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $point->get_controls(),
			'title_field' => '{{{ title }}}',
			'default'     => array(
				array(
					'icon'  => array( 'value' => 'fas fa-spa', 'library' => 'fa-solid' ),
					'title' => __( 'Thoughtfully Curated', 'mizuki-booking' ),
					'text'  => __( 'A considered edit of beauty essentials chosen for quality, comfort, and everyday appeal.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-tint', 'library' => 'fa-solid' ),
					'title' => __( 'Lightweight Rituals', 'mizuki-booking' ),
					'text'  => __( 'Easy-to-layer textures that suit simple routines and warm, humid days.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-gift', 'library' => 'fa-solid' ),
					'title' => __( 'Beautiful to Give', 'mizuki-booking' ),
					'text'  => __( 'Elegant self-care picks and complete sets made for thoughtful gifting.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-truck', 'library' => 'fa-solid' ),
					'title' => __( 'Delivered with Care', 'mizuki-booking' ),
					'text'  => __( 'Complimentary delivery for qualifying Singapore orders above S$85.', 'mizuki-booking' ),
				),
			),
		) );

		$this->end_controls_section();
	}

	private function register_faq_controls() {
		$this->start_controls_section( 'section_faq', array( 'label' => __( 'Questions', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'faq_show', __( 'Show the questions', 'mizuki-booking' ) );

		$this->add_control( 'faq_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Mizuki Picks FAQ', 'mizuki-booking' ),
		) );

		$this->add_control( 'faq_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'A Few Helpful Answers', 'mizuki-booking' ),
		) );

		$this->add_control( 'faq_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Everything you need to know before choosing your next moment of care.', 'mizuki-booking' ),
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
					'q' => __( 'What is Mizuki Picks?', 'mizuki-booking' ),
					'a' => __( 'Mizuki Picks is Mizuki’s curated edit of thoughtful beauty and self-care essentials. Each product is selected for its quality, sensorial experience, and place in an easy everyday ritual.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'What products are currently available in Mizuki Picks?', 'mizuki-booking' ),
					'a' => __( 'The current selection includes Naturepresso skincare essentials: Pure Rose Water Mist, Facial Collagen Serum, Everyday Lotion, Orange Blossom Nourishing Oil, and the complete Naturepresso Box Set.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'What is included in the Naturepresso Box Set?', 'mizuki-booking' ),
					'a' => __( 'The Naturepresso Box Set includes Pure Rose Water Mist, Facial Collagen Serum, Everyday Lotion, and Orange Blossom Nourishing Oil—a complete botanical routine from hydration through nighttime nourishment.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Can I use these products in Singapore’s humid climate?', 'mizuki-booking' ),
					'a' => __( 'The Naturepresso range features lightweight, comfortable textures designed to absorb easily and layer well, making them a natural fit for everyday routines in warm and humid conditions.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Is the Naturepresso Box Set suitable as a gift?', 'mizuki-booking' ),
					'a' => __( 'Yes. The complete set is thoughtfully curated as a beautiful gift for someone who enjoys a gentle, botanical skincare ritual—or as a meaningful moment of care for yourself.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Do you offer delivery?', 'mizuki-booking' ),
					'a' => __( 'Mizuki offers complimentary delivery for qualifying Singapore orders above S$85. Please refer to Delivery & FAQs for full delivery information.', 'mizuki-booking' ),
				),
			),
		) );

		$this->add_link_controls( 'faq_more', __( 'Text link', 'mizuki-booking' ), __( 'View Delivery & FAQs', 'mizuki-booking' ), '' );

		$this->end_controls_section();
	}

	private function register_sticky_controls() {
		$this->start_controls_section( 'section_sticky', array( 'label' => __( 'Phone bar', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'sticky_show', __( 'Show the bar on phones', 'mizuki-booking' ) );

		$this->add_link_controls( 'sticky_button', __( 'Button', 'mizuki-booking' ), __( 'Shop Mizuki Picks', 'mizuki-booking' ), '' );

		$this->add_control(
			'sticky_note',
			array(
				'type'            => \Elementor\Controls_Manager::RAW_HTML,
				'raw'             => __( 'Slides up once the picks have scrolled past, and never appears on a desktop. Needs a link to go to.', 'mizuki-booking' ),
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

	private function arrow() {
		return '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
	}

	private function chevron( $way ) {
		return 'left' === $way
			? '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>'
			: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
	}

	/** A text link, drawn only when it has both words and somewhere to go. */
	private function text_link( $s, $prefix, $class = 'mzk-pk__link' ) {
		$text = $this->get( $s, $prefix . '_text' );
		$link = $this->get( $s, $prefix . '_link' );

		if ( '' === trim( $text ) || '' === trim( $link ) ) {
			return;
		}

		printf(
			'<a class="%s" href="%s"><span>%s</span>%s</a>',
			esc_attr( $class ),
			esc_url( $link ),
			esc_html( $text ),
			$this->arrow() // phpcs:ignore WordPress.Security.EscapeOutput -- a fixed SVG.
		);
	}

	private function button( $s, $prefix, $class = 'mzk-pk__btn' ) {
		$text = $this->get( $s, $prefix . '_text' );
		$link = $this->get( $s, $prefix . '_link' );

		if ( '' === trim( $text ) ) {
			return;
		}

		if ( '' === trim( $link ) ) {
			// A button that goes nowhere is a button, not a link to nothing.
			printf( '<button type="button" class="%s">%s</button>', esc_attr( $class ), esc_html( $text ) );
			return;
		}

		printf( '<a class="%s" href="%s">%s</a>', esc_attr( $class ), esc_url( $link ), esc_html( $text ) );
	}

	protected function render_widget() {
		$s = $this->get_settings_for_display();

		echo '<div class="mzk-pk">';

		if ( $this->showing( $s, 'banner_show' ) ) {
			$this->render_banner( $s );
		}
		if ( $this->showing( $s, 'intro_show' ) ) {
			$this->render_intro( $s );
		}
		if ( $this->showing( $s, 'picks_show' ) ) {
			$this->render_picks( $s );
		}
		if ( $this->showing( $s, 'featured_show' ) ) {
			$this->render_featured( $s );
		}
		if ( $this->showing( $s, 'why_show' ) ) {
			$this->render_why( $s );
		}
		if ( $this->showing( $s, 'faq_show' ) ) {
			$this->render_faq( $s );
		}

		echo '</div>';

		if ( $this->showing( $s, 'sticky_show' ) ) {
			$this->render_sticky( $s );
		}
	}

	private function render_banner( $s ) {
		$image = $this->image_url( $s, 'banner_image' );

		echo '<section class="mzk-pk-banner">';

		if ( $image ) {
			printf(
				'<div class="mzk-pk-banner__bg"><img src="%s" alt="" fetchpriority="high" /></div>',
				esc_url( $image )
			);
		}

		echo '<div class="mzk-pk-banner__content"><div class="mzk-pk-banner__box">';
		$this->line( 'span', 'mzk-pk__eyebrow mzk-pk-banner__eyebrow', $this->get( $s, 'banner_eyebrow' ) );
		$this->line( 'h1', 'mzk-pk-banner__title', $this->get( $s, 'banner_title' ) );
		$this->line( 'p', 'mzk-pk-banner__lede', $this->get( $s, 'banner_lede' ) );
		$this->line( 'p', 'mzk-pk-banner__text', $this->get( $s, 'banner_text' ) );

		$hasButton = '' !== trim( $this->get( $s, 'banner_button_text' ) );
		$hasLink   = '' !== trim( $this->get( $s, 'banner_more_text' ) ) && '' !== trim( $this->get( $s, 'banner_more_link' ) );

		if ( $hasButton || $hasLink ) {
			echo '<div class="mzk-pk-banner__actions">';
			$this->button( $s, 'banner_button' );
			$this->text_link( $s, 'banner_more', 'mzk-pk__link mzk-pk__link--light' );
			echo '</div>';
		}

		echo '</div></div></section>';
	}

	private function render_intro( $s ) {
		echo '<section class="mzk-pk-intro"><div class="mzk-pk__inner mzk-pk-intro__inner">';

		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'intro_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2 mzk-pk-intro__title', $this->get( $s, 'intro_title' ) );
		$this->rich( $this->get( $s, 'intro_body' ), 'mzk-pk__body mzk-pk-intro__body' );

		if ( '' !== trim( $this->get( $s, 'intro_more_text' ) ) && '' !== trim( $this->get( $s, 'intro_more_link' ) ) ) {
			echo '<div class="mzk-pk-intro__foot">';
			$this->text_link( $s, 'intro_more' );
			echo '</div>';
		}

		echo '</div></section>';
	}

	/**
	 * The picks.
	 *
	 * Every card is a real product, so the name, the price, the picture and the link stay right
	 * when the shop changes. A row pointing at a product that has since been deleted is skipped
	 * rather than drawn as an empty card, and the whole section is left out when none resolve.
	 */
	private function render_picks( $s ) {
		$cards = array();

		foreach ( $this->rows( $s, 'picks' ) as $row ) {
			$product = $this->product( isset( $row['product'] ) ? $row['product'] : '' );
			if ( $product ) {
				$cards[] = array( 'row' => $row, 'product' => $product );
			}
		}

		if ( ! $cards ) {
			return;
		}

		$total = count( $cards );

		echo '<section class="mzk-pk-picks" id="mizuki-picks">';
		echo '<div class="mzk-pk-slider">';

		echo '<div class="mzk-pk__inner mzk-pk-picks__head">';

		echo '<div class="mzk-pk-picks__blurb">';
		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'picks_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2 mzk-pk-picks__title', $this->get( $s, 'picks_title' ) );
		$this->line( 'p', 'mzk-pk-picks__intro', $this->get( $s, 'picks_intro' ) );
		echo '</div>';

		/*
		 * The controls live inside .mzk-pk-slider with the track. The script finds which slider to
		 * scroll by walking up from what was clicked, so an arrow rendered outside the wrapper is
		 * an arrow that silently does nothing.
		 */
		echo '<div class="mzk-pk-picks__nav">';
		$this->text_link( $s, 'picks_all' );

		if ( $total > 1 ) {
			printf(
				'<div class="mzk-pk-picks__arrows">
					<span class="mzk-pk-picks__count" data-mzk-pk-count>%1$s</span>
					<button type="button" class="mzk-pk-picks__arrow mzk-pk-slider__prev" aria-label="%2$s">%3$s</button>
					<button type="button" class="mzk-pk-picks__arrow mzk-pk-slider__next" aria-label="%4$s">%5$s</button>
				</div>',
				esc_html( sprintf( '%02d / %02d', 1, $total ) ),
				esc_attr__( 'Previous pick', 'mizuki-booking' ),
				$this->chevron( 'left' ),  // phpcs:ignore WordPress.Security.EscapeOutput
				esc_attr__( 'Next pick', 'mizuki-booking' ),
				$this->chevron( 'right' )  // phpcs:ignore WordPress.Security.EscapeOutput
			);
		}
		echo '</div>';

		echo '</div>';

		echo '<div class="mzk-pk-slider__rail">';
		printf(
			'<ul class="mzk-pk-slider__track" tabindex="0" role="list" aria-label="%s">',
			esc_attr( $this->get( $s, 'picks_title', __( 'Products', 'mizuki-booking' ) ) )
		);

		foreach ( $cards as $card ) {
			$this->render_pick( $card['row'], $card['product'] );
		}

		echo '</ul>';

		$swipe = $this->get( $s, 'picks_swipe' );
		if ( '' !== trim( $swipe ) ) {
			printf(
				'<div class="mzk-pk-picks__swipe"><span>%s</span><span data-mzk-pk-count>%s</span></div>',
				esc_html( $swipe ),
				esc_html( sprintf( '%02d / %02d', 1, $total ) )
			);
		}

		echo '</div>';

		echo '</div>';

		if ( '' !== trim( $this->get( $s, 'picks_button_text' ) ) ) {
			echo '<div class="mzk-pk__inner mzk-pk-picks__foot">';
			$this->button( $s, 'picks_button' );
			echo '</div>';
		}

		echo '</section>';
	}

	private function render_pick( $row, $product ) {
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

		$text = isset( $row['text'] ) ? trim( (string) $row['text'] ) : '';
		if ( '' === $text ) {
			// The short description is the shop's own one-liner, which is what this card wants.
			$text = trim( wp_strip_all_tags( (string) $product->get_short_description() ) );
		}

		echo '<li class="mzk-pk-card">';
		printf( '<a class="mzk-pk-card__link" href="%s">', esc_url( $product->get_permalink() ) );

		if ( $image ) {
			printf(
				'<span class="mzk-pk-card__media"><img src="%s" alt="%s" loading="lazy" /></span>',
				esc_url( $image ),
				esc_attr( $product->get_name() )
			);
		}

		echo '<span class="mzk-pk-card__body">';

		if ( '' !== $label ) {
			printf( '<span class="mzk-pk__eyebrow mzk-pk-card__label">%s</span>', esc_html( $label ) );
		}

		printf( '<span class="mzk-pk-card__title">%s</span>', esc_html( $product->get_name() ) );

		if ( '' !== $text ) {
			printf( '<span class="mzk-pk-card__text">%s</span>', esc_html( $text ) );
		}

		if ( ! empty( $row['show_price'] ) && 'yes' === $row['show_price'] ) {
			$price = $product->get_price_html();
			if ( $price ) {
				// get_price_html() returns markup — del/ins for a sale — so it is filtered rather
				// than escaped, or a sale price arrives as visible tags.
				printf( '<span class="mzk-pk-card__price">%s</span>', wp_kses_post( $price ) );
			}
		}

		$cta = isset( $row['cta'] ) ? trim( (string) $row['cta'] ) : '';
		if ( '' !== $cta ) {
			printf(
				'<span class="mzk-pk__link mzk-pk-card__cta"><span>%s</span>%s</span>',
				esc_html( $cta ),
				$this->arrow() // phpcs:ignore WordPress.Security.EscapeOutput -- a fixed SVG.
			);
		}

		echo '</span></a></li>';
	}

	private function render_featured( $s ) {
		$main  = $this->image_url( $s, 'featured_image' );
		$inset = $this->image_url( $s, 'featured_inset' );

		echo '<section class="mzk-pk-featured"><div class="mzk-pk__inner mzk-pk-featured__grid">';

		if ( $main || $inset ) {
			echo '<div class="mzk-pk-featured__media">';
			if ( $main ) {
				printf( '<div class="mzk-pk-featured__main"><img src="%s" alt="" loading="lazy" /></div>', esc_url( $main ) );
			}
			if ( $inset ) {
				printf( '<div class="mzk-pk-featured__inset"><img src="%s" alt="" loading="lazy" /></div>', esc_url( $inset ) );
			}
			echo '</div>';
		}

		echo '<div class="mzk-pk-featured__text">';
		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'featured_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2 mzk-pk-featured__title', $this->get( $s, 'featured_title' ) );
		$this->line( 'p', 'mzk-pk-featured__lede', $this->get( $s, 'featured_lede' ) );
		$this->rich( $this->get( $s, 'featured_body' ), 'mzk-pk__body mzk-pk-featured__body' );
		$this->button( $s, 'featured_button' );
		echo '</div>';

		echo '</div></section>';
	}

	private function render_why( $s ) {
		$points = $this->rows( $s, 'why_points' );

		echo '<section class="mzk-pk-why"><div class="mzk-pk__inner">';

		echo '<div class="mzk-pk-why__head">';
		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'why_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2', $this->get( $s, 'why_title' ) );
		$this->line( 'p', 'mzk-pk__body mzk-pk-why__intro', $this->get( $s, 'why_intro' ) );
		echo '</div>';

		if ( $points ) {
			echo '<div class="mzk-pk-why__grid">';
			foreach ( $points as $point ) {
				echo '<div class="mzk-pk-why__item">';
				echo '<div class="mzk-pk-why__dial">';
				$this->icon( $point, 'mzk-pk-why__glyph' );
				echo '</div>';
				$this->line( 'h3', 'mzk-pk-why__title', isset( $point['title'] ) ? $point['title'] : '' );
				$this->line( 'p', 'mzk-pk-why__text', isset( $point['text'] ) ? $point['text'] : '' );
				echo '</div>';
			}
			echo '</div>';
		}

		echo '</div></section>';
	}

	private function render_faq( $s ) {
		$faqs = $this->rows( $s, 'faqs' );

		echo '<section class="mzk-pk-faq"><div class="mzk-pk__inner mzk-pk-faq__inner">';

		echo '<div class="mzk-pk-faq__head">';
		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'faq_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2', $this->get( $s, 'faq_title' ) );
		$this->line( 'p', 'mzk-pk__body', $this->get( $s, 'faq_intro' ) );
		echo '</div>';

		if ( $faqs ) {
			echo '<div class="mzk-pk-faq__list">';

			$group = 'mzk-pk-faq-' . $this->get_id();

			foreach ( $faqs as $index => $faq ) {
				$question = isset( $faq['q'] ) ? trim( (string) $faq['q'] ) : '';
				$answer   = isset( $faq['a'] ) ? trim( (string) $faq['a'] ) : '';

				if ( '' === $question ) {
					continue;
				}

				// The first answer is open, so the section does not read as a wall of shut doors.
				$open = 0 === $index;
				$id   = $group . '-' . (int) $index;

				echo '<div class="mzk-pk-faq__item">';
				printf(
					'<button type="button" class="mzk-pk-faq__q" aria-expanded="%1$s" aria-controls="%2$s">
						<span>%3$s</span>
						<span class="mzk-pk-faq__mark">
							<span class="mzk-pk-faq__plus"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
							<span class="mzk-pk-faq__minus"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
						</span>
					</button>',
					$open ? 'true' : 'false',
					esc_attr( $id ),
					esc_html( $question )
				);

				printf(
					'<div class="mzk-pk-faq__a" id="%1$s" data-open="%2$s"><div><p>%3$s</p></div></div>',
					esc_attr( $id ),
					$open ? 'true' : 'false',
					esc_html( $answer )
				);

				echo '</div>';
			}

			echo '</div>';
		}

		if ( '' !== trim( $this->get( $s, 'faq_more_text' ) ) && '' !== trim( $this->get( $s, 'faq_more_link' ) ) ) {
			echo '<div class="mzk-pk-faq__foot">';
			$this->text_link( $s, 'faq_more' );
			echo '</div>';
		}

		echo '</div></section>';
	}

	/** The bar that follows you down a phone. Needs somewhere to go, or it is a dead button. */
	private function render_sticky( $s ) {
		$text = $this->get( $s, 'sticky_button_text' );
		$link = $this->get( $s, 'sticky_button_link' );

		if ( '' === trim( $text ) || '' === trim( $link ) ) {
			return;
		}

		printf(
			'<div class="mzk-pk-sticky" data-mzk-pk-sticky hidden><a class="mzk-pk-sticky__btn" href="%s">%s</a></div>',
			esc_url( $link ),
			esc_html( $text )
		);
	}
}
