<?php
/**
 * The Tools & Vases page, as one widget.
 *
 * The shorter of the two shop pages: a banner, a line about why the vessel matters, the rail of
 * products, and the questions. Everything it does beyond its own words comes from
 * Mizuki_Elementor_Shop_Page, which it shares with Mizuki Picks — the same rail, the same
 * accordion, the same phone bar, the same palette and faces.
 *
 * Three things are set differently here and nothing else: the banner is centred rather than run
 * to the left, the cards let the picture and the name carry them with no line of description,
 * and the phone shows a dash per product rather than a written count.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Mizuki_Elementor_Tools_Page extends \Elementor\Widget_Base {

	/*
	 * Both traits declare which scripts a widget needs, so which one wins is stated rather than
	 * left to PHP — it refuses to guess, and the fatal it raises names a collision rather than
	 * the reason for one. This page wants the shop-page pair.
	 */
	use Mizuki_Elementor_Shared, Mizuki_Elementor_Shop_Page {
		Mizuki_Elementor_Shop_Page::get_script_depends insteadof Mizuki_Elementor_Shared;
	}

	public function get_name() {
		return 'mizuki-tools-page';
	}

	public function get_title() {
		return __( 'Tools & Vases page', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-cart-medium';
	}

	public function get_keywords() {
		return array( 'mizuki', 'tools', 'vases', 'shop', 'woocommerce', 'page', 'scissors', 'slider' );
	}

	/** Centred, where Mizuki Picks runs its banner to the left. */
	protected function page_modifier() {
		return 'mzk-pk--centred';
	}

	/** The picture and the name carry these cards; there is no line of description. */
	protected function cards_show_text() {
		return false;
	}

	/** A dash per product reads at a glance on a short list. */
	protected function mobile_pagination() {
		return 'dashes';
	}

	private function stock( $which ) {
		$images = array(
			'banner' => 'https://mizuki.com.sg/wp-content/uploads/2024/08/XL-bouquet-6-scaled.jpg',
			'vase'   => 'https://mizuki.com.sg/wp-content/uploads/2025/10/IMG_6339-300x300.jpg',
			'glass'  => 'https://mizuki.com.sg/wp-content/uploads/2025/10/IMG_4364-300x300.jpg',
		);

		$url = isset( $images[ $which ] ) ? $images[ $which ] : '';

		return apply_filters( 'mizuki_tools_default_image', $url, $which );
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
		$this->register_faq_controls();
		$this->register_sticky_controls();
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
			'default' => __( 'Mizuki Home', 'mizuki-booking' ),
		) );

		$this->add_control( 'banner_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Tools & Vases', 'mizuki-booking' ),
		) );

		$this->add_control( 'banner_lede', array(
			'label'   => __( 'Standfirst', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Beautiful essentials for arranging, caring for, and displaying every bloom.', 'mizuki-booking' ),
		) );

		$this->add_control( 'banner_text', array(
			'label'       => __( 'Text', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 3,
			'default'     => '',
			'description' => __( 'Optional. This page leads with the heading and the standfirst alone.', 'mizuki-booking' ),
		) );

		$this->add_link_controls( 'banner_button', __( 'Button', 'mizuki-booking' ), __( 'Shop The Collection', 'mizuki-booking' ), '#mizuki-picks' );
		$this->add_link_controls( 'banner_more', __( 'Text link', 'mizuki-booking' ), '', '' );

		$this->end_controls_section();
	}

	private function register_intro_controls() {
		$this->start_controls_section( 'section_intro', array( 'label' => __( 'Introduction', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'intro_show', __( 'Show the introduction', 'mizuki-booking' ) );

		$this->add_control( 'intro_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'The Details That Make A Difference', 'mizuki-booking' ),
		) );

		$this->add_control( 'intro_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Every Bloom Deserves the Right Home.', 'mizuki-booking' ),
		) );

		$this->add_control( 'intro_body', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'The right vase does more than hold flowers—it gives every stem space to open, balance, and belong. Thoughtful tools make the care behind each arrangement feel easier, more enjoyable, and more considered.', 'mizuki-booking' ) . '</p>',
		) );

		$this->add_link_controls( 'intro_more', __( 'Text link', 'mizuki-booking' ), '', '' );

		$this->end_controls_section();
	}

	private function register_picks_controls() {
		$this->start_controls_section( 'section_picks', array( 'label' => __( 'The collection', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'picks_show', __( 'Show the collection', 'mizuki-booking' ) );

		$this->add_control( 'picks_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Shop The Collection', 'mizuki-booking' ),
		) );

		$this->add_control( 'picks_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Tools for Every Arrangement', 'mizuki-booking' ),
		) );

		$this->add_control( 'picks_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'A curated selection of practical and beautiful essentials for fresh flowers, everyday styling, and thoughtful gifting.', 'mizuki-booking' ),
		) );

		$this->add_link_controls( 'picks_all', __( 'Text link', 'mizuki-booking' ), __( 'View All Tools & Vases', 'mizuki-booking' ), '' );

		$card = new \Elementor\Repeater();

		$card->add_control( 'product', array(
			'label'       => __( 'Product', 'mizuki-booking' ),
			'type'        => $this->woo() ? \Elementor\Controls_Manager::SELECT2 : \Elementor\Controls_Manager::TEXT,
			'options'     => $this->product_choices(),
			'label_block' => true,
			'default'     => '',
			'description' => $this->woo()
				? __( 'The name, picture and link all come from this product.', 'mizuki-booking' )
				: __( 'WooCommerce is not active, so there is no list to choose from — enter a product ID.', 'mizuki-booking' ),
		) );

		$card->add_control( 'label', array(
			'label'       => __( 'Label above the name', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '',
			'description' => __( 'Leave empty to use the product’s first category.', 'mizuki-booking' ),
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

		$this->add_link_controls( 'picks_button', __( 'Button', 'mizuki-booking' ), __( 'Shop All Tools & Vases', 'mizuki-booking' ), '' );

		$this->end_controls_section();
	}

	private function register_faq_controls() {
		$this->start_controls_section( 'section_faq', array( 'label' => __( 'Questions', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'faq_show', __( 'Show the questions', 'mizuki-booking' ) );

		$this->add_control( 'faq_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Tools & Vases FAQ', 'mizuki-booking' ),
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
			'default' => __( 'Everything you need to know before choosing the right piece for your flowers and home.', 'mizuki-booking' ),
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
					'q' => __( 'What can I use floral scissors for?', 'mizuki-booking' ),
					'a' => __( 'Floral scissors are designed for trimming fresh flower stems, removing leaves below the waterline, refreshing bouquet ends, and making simple at-home arrangements easier to care for.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Why should I use floral scissors instead of regular household scissors?', 'mizuki-booking' ),
					'a' => __( 'A clean, precise cut helps fresh stems take up water more easily. Floral scissors are also more comfortable for repeated trimming when arranging or refreshing flowers.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'How do I choose the right vase for my flowers?', 'mizuki-booking' ),
					'a' => __( 'Choose a vase based on the height, stem quantity, and shape of your flowers. Taller stems often need a taller or narrower vessel for support, while small blooms and single stems work beautifully in compact glass vases.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Are the vases suitable for everyday home styling?', 'mizuki-booking' ),
					'a' => __( 'Yes. The collection is selected to work beautifully with fresh flowers, dried stems, leafy branches, or as simple sculptural accents in your home.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Can Tools & Vases products be given as gifts?', 'mizuki-booking' ),
					'a' => __( 'Yes. Floral scissors and vases make thoughtful gifts for flower lovers, new-home celebrations, birthdays, and anyone who enjoys arranging flowers at home.', 'mizuki-booking' ),
				),
				array(
					'q' => __( 'Do you offer delivery in Singapore?', 'mizuki-booking' ),
					'a' => __( 'Mizuki offers complimentary delivery for qualifying Singapore orders above S$85. Please refer to Delivery & FAQs for complete delivery information.', 'mizuki-booking' ),
				),
			),
		) );

		$this->add_link_controls( 'faq_more', __( 'Text link', 'mizuki-booking' ), __( 'View Delivery & FAQs', 'mizuki-booking' ), '' );

		$this->end_controls_section();
	}

	private function register_sticky_controls() {
		$this->start_controls_section( 'section_sticky', array( 'label' => __( 'Phone bar', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'sticky_show', __( 'Show the bar on phones', 'mizuki-booking' ) );

		$this->add_link_controls( 'sticky_button', __( 'Button', 'mizuki-booking' ), __( 'Shop Tools & Vases', 'mizuki-booking' ), '' );

		$this->add_control(
			'sticky_note',
			array(
				'type'            => \Elementor\Controls_Manager::RAW_HTML,
				'raw'             => __( 'Slides up once the collection has scrolled past, and never appears on a desktop. Needs a link to go to.', 'mizuki-booking' ),
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

	protected function render_widget() {
		$s = $this->get_settings_for_display();

		printf( '<div class="mzk-pk %s">', esc_attr( $this->page_modifier() ) );

		if ( $this->showing( $s, 'banner_show' ) ) {
			$this->render_banner( $s );
		}
		if ( $this->showing( $s, 'intro_show' ) ) {
			$this->render_intro( $s );
		}
		if ( $this->showing( $s, 'picks_show' ) ) {
			$this->render_picks( $s );
		}
		if ( $this->showing( $s, 'faq_show' ) ) {
			$this->render_faq( $s );
		}

		echo '</div>';

		if ( $this->showing( $s, 'sticky_show' ) ) {
			$this->render_sticky( $s );
		}
	}
}
