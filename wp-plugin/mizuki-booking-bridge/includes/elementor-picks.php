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

	/*
	 * Both traits declare which scripts a widget needs, so which one wins is stated rather than
	 * left to PHP — it refuses to guess, and the fatal it raises names a collision rather than
	 * the reason for one. This page wants the shop-page pair, not the booking widgets' pair.
	 */
	use Mizuki_Elementor_Shared, Mizuki_Elementor_Shop_Page {
		Mizuki_Elementor_Shop_Page::get_script_depends insteadof Mizuki_Elementor_Shared;
	}

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
		$card->add_control( 'product', $this->picker_args(
			__( 'Product', 'mizuki-booking' ),
			$this->product_choices(),
			__( 'The name, picture and link all come from this product.', 'mizuki-booking' )
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

		$card->add_control( 'cta', array(
			'label'   => __( 'Link text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'View Product', 'mizuki-booking' ),
		) );

		$this->add_product_source_controls(
			'picks',
			$card,
			__( 'The whole section is left out until at least one product is chosen.', 'mizuki-booking' )
		);

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

}
