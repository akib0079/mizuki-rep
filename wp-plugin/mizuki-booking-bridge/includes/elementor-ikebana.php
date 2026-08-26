<?php
/**
 * The Ikebana workshops page, as one widget.
 *
 * The same trade as the IFDA page: every string and every image is a control, none of the
 * spacing, colour or type is, and the look lives in css/ikebana.css. The studio edits words and
 * pictures, and the page cannot drift out of shape while they do it.
 *
 * What is different here is that the page is a set of parts rather than one argument, so each of
 * the six sections has its own switch. A studio with no featured course this season turns that
 * section off rather than emptying every field in it and hoping the spacing collapses tidily.
 *
 * The workshops run in a scroll-snap track and the gallery opens in a lightbox; both are in
 * js/ikebana.js, and both are built so the page still works if that never loads.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Mizuki_Elementor_Ikebana_Page extends \Elementor\Widget_Base {

	use Mizuki_Elementor_Shared;

	public function get_name() {
		return 'mizuki-ikebana-page';
	}

	public function get_title() {
		return __( 'Ikebana workshops page', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-gallery-grid';
	}

	public function get_keywords() {
		return array( 'mizuki', 'ikebana', 'workshop', 'page', 'gallery', 'slider', 'floral' );
	}

	public function get_style_depends() {
		return array( 'mizuki-ikebana' );
	}

	public function get_script_depends() {
		return array( 'mizuki-elementor', 'mizuki-ikebana' );
	}

	/**
	 * The pictures the page was designed around, so an untouched widget shows the studio's own
	 * page rather than a wall of grey placeholders. Filterable in one line if the uploads move:
	 *
	 *   add_filter( 'mizuki_ikebana_default_image', function ( $url, $which ) { ... }, 10, 2 );
	 */
	private function stock( $which ) {
		$base = 'https://mizuki.com.sg/wp-content/uploads/';

		$images = array(
			'hero'        => $base . '2024/08/17FB658D-F24C-4CD9-97C5-EB714EE3A7A2.jpg',
			'intro'       => $base . '2024/08/preserved-red-3-scaled.jpg',
			'ikebana'     => $base . '2024/05/colour-theme-3.webp',
			'seasonal'    => $base . '2024/08/centerpiece.jpg',
			'private'     => $base . '2025/05/IMG_6437-scaled.jpg',
			'preserved'   => $base . '2024/08/preserved-red-3-scaled.jpg',
			'featured'    => $base . '2024/08/centerpiece.jpg',
			'student'     => $base . '2025/08/IMG_5848-scaled.jpg',
		);

		$url = isset( $images[ $which ] ) ? $images[ $which ] : '';

		return apply_filters( 'mizuki_ikebana_default_image', $url, $which );
	}

	/**
	 * -------------------------------------------------------------------------
	 * Controls
	 * -------------------------------------------------------------------------
	 */

	protected function register_controls() {
		$this->register_hero_controls();
		$this->register_intro_controls();
		$this->register_workshops_controls();
		$this->register_featured_controls();
		$this->register_benefits_controls();
		$this->register_gallery_controls();
	}

	/**
	 * The switch every section starts with.
	 *
	 * First control in its panel and defaulted on, so turning a section off is one click in the
	 * place you are already looking rather than a hunt through a settings tab.
	 */
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

	private function register_hero_controls() {
		$this->start_controls_section( 'section_hero', array( 'label' => __( 'Hero', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'hero_show', __( 'Show the hero', 'mizuki-booking' ) );

		$this->add_control( 'hero_image', array(
			'label'   => __( 'Background image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'hero' ) ),
		) );

		$this->add_control( 'hero_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Discover the art of flowers, space, and expression.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_intro', array(
			'label'       => __( 'Introduction', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 3,
			'default'     => '',
			'description' => __( 'Optional. The design leads with the heading alone.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_button_text', array(
			'label'   => __( 'Button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Explore Upcoming Workshops', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_button_link', array(
			'label'       => __( 'Button link', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '#workshops',
			'description' => __( 'Leave as #workshops to scroll to the workshops below.', 'mizuki-booking' ),
		) );

		$this->end_controls_section();
	}

	private function register_intro_controls() {
		$this->start_controls_section( 'section_intro', array( 'label' => __( 'Introduction', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'intro_show', __( 'Show the introduction', 'mizuki-booking' ) );

		$this->add_control( 'intro_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Mizuki', 'mizuki-booking' ),
		) );

		$this->add_control( 'intro_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'A slower, more thoughtful way', 'mizuki-booking' ),
		) );

		$this->add_control( 'intro_accent', array(
			'label'       => __( 'Heading, second line', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => __( 'to experience floral design.', 'mizuki-booking' ),
			'description' => __( 'Set in italic teal beneath the first line.', 'mizuki-booking' ),
		) );

		$this->add_control( 'intro_body', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'At Mizuki, we believe floral arrangement is more than just placing blooms in a vase. It is a practice of mindfulness, an exploration of space (Ma), and a journey into the profound beauty of nature.', 'mizuki-booking' ) . '</p>'
				. '<p>' . __( 'Whether you are discovering the ancient art of Ikebana or exploring contemporary seasonal styling, our workshops are designed to nurture your creativity in a serene, supportive environment.', 'mizuki-booking' ) . '</p>',
		) );

		$this->add_control( 'intro_image', array(
			'label'   => __( 'Image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'intro' ) ),
		) );

		$this->end_controls_section();
	}

	private function register_workshops_controls() {
		$this->start_controls_section( 'section_workshops', array( 'label' => __( 'Upcoming workshops', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'workshops_show', __( 'Show the workshops', 'mizuki-booking' ) );

		$this->add_control( 'workshops_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Upcoming Workshops', 'mizuki-booking' ),
		) );

		$this->add_control( 'workshops_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Discover the timeless Japanese art of Ikebana, where flowers, branches, and space come together in harmony, balance, and natural beauty.', 'mizuki-booking' ),
		) );

		$card = new \Elementor\Repeater();

		$card->add_control( 'image', array(
			'label'   => __( 'Image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'ikebana' ) ),
		) );

		$card->add_control( 'tag', array(
			'label'   => __( 'Tag', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Ikebana', 'mizuki-booking' ),
		) );

		$card->add_control( 'title', array(
			'label'   => __( 'Title', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Seasonal Ikebana Workshop', 'mizuki-booking' ),
		) );

		/*
		 * Five detail rows, each its own icon and its own words.
		 *
		 * A repeater inside a repeater is what this wants to be, and Elementor's panel cannot
		 * render one — the PHP accepts it and the control never appears. (Its "nested repeater"
		 * is a different feature: repeater rows mapped to containers on the canvas, as Nested
		 * Tabs uses.) So the rows are flat pairs. Five is more than the design uses and rows left
		 * empty are skipped, so a card of two details draws two.
		 */
		for ( $row = 1; $row <= 5; $row++ ) {
			$card->add_control(
				'detail_' . $row . '_icon',
				array(
					'label'       => sprintf(
						/* translators: %d: which detail row. */
						__( 'Detail %d icon', 'mizuki-booking' ),
						$row
					),
					'type'        => \Elementor\Controls_Manager::ICONS,
					'skin'        => 'inline',
					'label_block' => false,
					'default'     => 1 === $row
						? array( 'value' => 'far fa-clock', 'library' => 'fa-regular' )
						: array( 'value' => '', 'library' => '' ),
				)
			);

			$card->add_control(
				'detail_' . $row . '_text',
				array(
					'label'       => sprintf(
						/* translators: %d: which detail row. */
						__( 'Detail %d', 'mizuki-booking' ),
						$row
					),
					'type'        => \Elementor\Controls_Manager::TEXT,
					'label_block' => true,
					'default'     => '',
					'separator'   => 'after',
				)
			);
		}

		$card->add_control( 'button_text', array(
			'label'   => __( 'Button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'View Details', 'mizuki-booking' ),
		) );

		$card->add_control( 'button_link', array(
			'label'   => __( 'Button link', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );

		$this->add_control( 'workshops', array(
			'label'       => __( 'Workshops', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $card->get_controls(),
			'title_field' => '{{{ title }}}',
			'default'     => array(
				array(
					'image'       => array( 'url' => $this->stock( 'ikebana' ) ),
					'tag'         => __( 'Ikebana', 'mizuki-booking' ),
					'title'       => __( 'Seasonal Ikebana Workshop', 'mizuki-booking' ),
					'detail_1_icon' => array( 'value' => 'far fa-clock', 'library' => 'fa-regular' ),
					'detail_1_text' => __( '2.5 Hours', 'mizuki-booking' ),
					'detail_2_icon' => array( 'value' => 'fas fa-users', 'library' => 'fa-solid' ),
					'detail_2_text' => __( 'Small Group (Max 6)', 'mizuki-booking' ),
					'detail_3_icon' => array( 'value' => 'fas fa-seedling', 'library' => 'fa-solid' ),
					'detail_3_text' => __( 'Beginner Friendly', 'mizuki-booking' ),
					'button_text' => __( 'View Details', 'mizuki-booking' ),
				),
				array(
					'image'       => array( 'url' => $this->stock( 'seasonal' ) ),
					'tag'         => __( 'Seasonal Floral Design', 'mizuki-booking' ),
					'title'       => __( 'Seasonal Floral Workshop', 'mizuki-booking' ),
					'detail_1_icon' => array( 'value' => 'far fa-clock', 'library' => 'fa-regular' ),
					'detail_1_text' => __( '2 Hours', 'mizuki-booking' ),
					'detail_2_icon' => array( 'value' => 'fas fa-fan', 'library' => 'fa-solid' ),
					'detail_2_text' => __( 'Vase Arrangement', 'mizuki-booking' ),
					'detail_3_icon' => array( 'value' => 'fas fa-gift', 'library' => 'fa-solid' ),
					'detail_3_text' => __( 'Premium Seasonal Blooms', 'mizuki-booking' ),
					'button_text' => __( 'View Details', 'mizuki-booking' ),
				),
				array(
					'image'       => array( 'url' => $this->stock( 'private' ) ),
					'tag'         => __( 'Private Group', 'mizuki-booking' ),
					'title'       => __( 'Private Floral Workshop', 'mizuki-booking' ),
					'detail_1_icon' => array( 'value' => 'far fa-calendar', 'library' => 'fa-regular' ),
					'detail_1_text' => __( 'Custom Schedule', 'mizuki-booking' ),
					'detail_2_icon' => array( 'value' => 'fas fa-users', 'library' => 'fa-solid' ),
					'detail_2_text' => __( 'Events &amp; Team Building', 'mizuki-booking' ),
					'detail_3_icon' => array( 'value' => 'fas fa-book-open', 'library' => 'fa-solid' ),
					'detail_3_text' => __( 'Tailored Curriculum', 'mizuki-booking' ),
					'button_text' => __( 'Enquire Now', 'mizuki-booking' ),
				),
				array(
					'image'       => array( 'url' => $this->stock( 'preserved' ) ),
					'tag'         => __( 'Preserved Floral', 'mizuki-booking' ),
					'title'       => __( 'Preserved Flower Design', 'mizuki-booking' ),
					'detail_1_icon' => array( 'value' => 'far fa-clock', 'library' => 'fa-regular' ),
					'detail_1_text' => __( '3 Hours', 'mizuki-booking' ),
					'detail_2_icon' => array( 'value' => 'fas fa-spa', 'library' => 'fa-solid' ),
					'detail_2_text' => __( 'Lasting Arrangements', 'mizuki-booking' ),
					'detail_3_icon' => array( 'value' => 'fas fa-palette', 'library' => 'fa-solid' ),
					'detail_3_text' => __( 'Colour Theory Basics', 'mizuki-booking' ),
					'button_text' => __( 'View Details', 'mizuki-booking' ),
				),
			),
		) );

		$this->end_controls_section();
	}

	private function register_featured_controls() {
		$this->start_controls_section( 'section_featured', array( 'label' => __( 'Featured course', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'featured_show', __( 'Show the featured course', 'mizuki-booking' ) );

		$this->add_control( 'featured_image', array(
			'label'   => __( 'Image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->stock( 'featured' ) ),
		) );

		$this->add_control( 'featured_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Featured Course', 'mizuki-booking' ),
		) );

		$this->add_control( 'featured_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Autumn Ikebana Course', 'mizuki-booking' ),
		) );

		$this->add_control( 'featured_body', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'Immerse yourself in a comprehensive 4-session journey designed for beginners. Learn the foundational techniques of Sogetsu Ikebana, focusing on line, colour, and mass to create dynamic expressions of nature.', 'mizuki-booking' ) . '</p>',
		) );

		$fact = new \Elementor\Repeater();

		$fact->add_control( 'icon', array(
			'label'   => __( 'Icon', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::ICONS,
			'default' => array( 'value' => 'far fa-calendar', 'library' => 'fa-regular' ),
		) );

		$fact->add_control( 'label', array(
			'label'   => __( 'Label', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Duration', 'mizuki-booking' ),
		) );

		$fact->add_control( 'value', array(
			'label'   => __( 'Value', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( '4 Sessions, weekly', 'mizuki-booking' ),
		) );

		$this->add_control( 'featured_facts', array(
			'label'       => __( 'Details', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $fact->get_controls(),
			'title_field' => '{{{ label }}}',
			'default'     => array(
				array(
					'icon'  => array( 'value' => 'far fa-calendar', 'library' => 'fa-regular' ),
					'label' => __( 'Duration', 'mizuki-booking' ),
					'value' => __( '4 Sessions, weekly', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-user-graduate', 'library' => 'fa-solid' ),
					'label' => __( 'Level', 'mizuki-booking' ),
					'value' => __( 'Beginner to Intermediate', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-certificate', 'library' => 'fa-solid' ),
					'label' => __( 'Outcome', 'mizuki-booking' ),
					'value' => __( 'Mastery of basic styles and a certificate', 'mizuki-booking' ),
				),
			),
		) );

		$this->add_control( 'featured_button_text', array(
			'label'   => __( 'Button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Enquire for Next Intake', 'mizuki-booking' ),
		) );

		$this->add_control( 'featured_button_link', array(
			'label'   => __( 'Button link', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );

		$this->end_controls_section();
	}

	private function register_benefits_controls() {
		$this->start_controls_section( 'section_benefits', array( 'label' => __( 'What is included', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'benefits_show', __( 'Show what is included', 'mizuki-booking' ) );

		$benefit = new \Elementor\Repeater();

		$benefit->add_control( 'icon', array(
			'label'   => __( 'Icon', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::ICONS,
			'default' => array( 'value' => 'fas fa-box-open', 'library' => 'fa-solid' ),
		) );

		$benefit->add_control( 'title', array(
			'label'   => __( 'Title', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'All Materials Included', 'mizuki-booking' ),
		) );

		$benefit->add_control( 'text', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => '',
		) );

		$this->add_control( 'benefits', array(
			'label'       => __( 'Points', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $benefit->get_controls(),
			'title_field' => '{{{ title }}}',
			'default'     => array(
				array(
					'icon'  => array( 'value' => 'fas fa-box-open', 'library' => 'fa-solid' ),
					'title' => __( 'All Materials Included', 'mizuki-booking' ),
					'text'  => __( 'Premium seasonal blooms, vases, kenzan, and tools are provided for your use during class.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-chalkboard-teacher', 'library' => 'fa-solid' ),
					'title' => __( 'Guided by Experts', 'mizuki-booking' ),
					'text'  => __( 'Learn directly from certified instructors with years of experience in floral artistry and design.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-star', 'library' => 'fa-solid' ),
					'title' => __( 'Beginner Friendly', 'mizuki-booking' ),
					'text'  => __( 'No prior experience required. Our step-by-step approach ensures you feel confident from day one.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-leaf', 'library' => 'fa-solid' ),
					'title' => __( 'Take Home Creation', 'mizuki-booking' ),
					'text'  => __( 'Bring your beautifully crafted arrangement home to enjoy, spreading tranquility to your own space.', 'mizuki-booking' ),
				),
			),
		) );

		$this->end_controls_section();
	}

	private function register_gallery_controls() {
		$this->start_controls_section( 'section_gallery', array( 'label' => __( 'Gallery', 'mizuki-booking' ) ) );

		$this->add_section_switch( 'gallery_show', __( 'Show the gallery', 'mizuki-booking' ) );

		$this->add_control( 'gallery_eyebrow', array(
			'label'   => __( 'Eyebrow', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Gallery', 'mizuki-booking' ),
		) );

		$this->add_control( 'gallery_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Student & Master Works', 'mizuki-booking' ),
		) );

		/*
		 * Elementor's own gallery control rather than a repeater of media fields: it opens the
		 * media library once and takes a whole selection, which is how somebody actually adds
		 * eleven photographs.
		 */
		$this->add_control( 'gallery_images', array(
			'label'       => __( 'Pictures', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::GALLERY,
			'description' => __( 'Opens full size when clicked.', 'mizuki-booking' ),
			'default'     => array(
				array( 'url' => $this->stock( 'ikebana' ) ),
				array( 'url' => $this->stock( 'student' ) ),
				array( 'url' => $this->stock( 'preserved' ) ),
				array( 'url' => $this->stock( 'seasonal' ) ),
				array( 'url' => $this->stock( 'private' ) ),
				array( 'url' => $this->stock( 'hero' ) ),
			),
		) );

		$this->add_control( 'gallery_lightbox', array(
			'label'        => __( 'Open pictures in a lightbox', 'mizuki-booking' ),
			'type'         => \Elementor\Controls_Manager::SWITCHER,
			'label_on'     => __( 'Yes', 'mizuki-booking' ),
			'label_off'    => __( 'No', 'mizuki-booking' ),
			'return_value' => 'yes',
			'default'      => 'yes',
		) );

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

	/** A section is drawn unless its switch says otherwise; an absent switch means an old
	    instance saved before the switch existed, and those were all showing. */
	private function showing( $s, $key ) {
		return ! isset( $s[ $key ] ) || 'yes' === $s[ $key ];
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

	private function icon( $row, $class ) {
		if ( empty( $row['icon']['value'] ) || ! class_exists( '\Elementor\Icons_Manager' ) ) {
			return;
		}

		printf( '<span class="%s">', esc_attr( $class ) );
		\Elementor\Icons_Manager::render_icon( $row['icon'], array( 'aria-hidden' => 'true' ) );
		echo '</span>';
	}

	/** A link when it points somewhere, a button when it does not — never a link to nowhere. */
	private function action( $text, $link, $class ) {
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return;
		}

		if ( is_string( $link ) && '' !== trim( $link ) ) {
			printf(
				'<a class="%s" href="%s">%s</a>',
				esc_attr( $class ),
				esc_url( $link ),
				esc_html( $text )
			);
			return;
		}

		printf( '<button type="button" class="%s">%s</button>', esc_attr( $class ), esc_html( $text ) );
	}

	private function rich( $html, $class ) {
		if ( ! is_string( $html ) || '' === trim( wp_strip_all_tags( $html ) ) ) {
			return;
		}

		printf( '<div class="%s">%s</div>', esc_attr( $class ), wp_kses_post( $html ) );
	}

	protected function render_widget() {
		$s = $this->get_settings_for_display();

		echo '<div class="mzk-ike">';

		if ( $this->showing( $s, 'hero_show' ) ) {
			$this->render_hero( $s );
		}
		if ( $this->showing( $s, 'intro_show' ) ) {
			$this->render_intro( $s );
		}
		if ( $this->showing( $s, 'workshops_show' ) ) {
			$this->render_workshops( $s );
		}
		if ( $this->showing( $s, 'featured_show' ) ) {
			$this->render_featured( $s );
		}
		if ( $this->showing( $s, 'benefits_show' ) ) {
			$this->render_benefits( $s );
		}
		if ( $this->showing( $s, 'gallery_show' ) ) {
			$this->render_gallery( $s );
		}

		echo '</div>';
	}

	private function render_hero( $s ) {
		$image = $this->image_url( $s, 'hero_image' );

		echo '<section class="mzk-ike-hero">';

		if ( $image ) {
			printf(
				'<div class="mzk-ike-hero__bg"><img src="%s" alt="" fetchpriority="high" /></div>',
				esc_url( $image )
			);
		}

		echo '<div class="mzk-ike-hero__content"><div class="mzk-ike-hero__box">';
		$this->line( 'h1', 'mzk-ike-hero__title', $this->get( $s, 'hero_title' ) );
		$this->line( 'p', 'mzk-ike-hero__intro', $this->get( $s, 'hero_intro' ) );

		$text = $this->get( $s, 'hero_button_text' );
		if ( '' !== trim( $text ) ) {
			echo '<div class="mzk-ike-hero__actions">';
			$this->action( $text, $this->get( $s, 'hero_button_link' ), 'mzk-ike__btn mzk-ike__btn--solid' );
			echo '</div>';
		}

		echo '</div></div></section>';
	}

	private function render_intro( $s ) {
		$image = $this->image_url( $s, 'intro_image' );

		echo '<section class="mzk-ike-intro"><div class="mzk-ike__inner mzk-ike-intro__grid">';

		if ( $image ) {
			printf(
				'<div class="mzk-ike-intro__media"><div class="mzk-ike__framed"><img src="%s" alt="%s" loading="lazy" /></div></div>',
				esc_url( $image ),
				esc_attr( $this->get( $s, 'intro_title' ) )
			);
		}

		echo '<div class="mzk-ike-intro__text">';
		$this->line( 'span', 'mzk-ike__eyebrow mzk-ike-intro__eyebrow', $this->get( $s, 'intro_eyebrow' ) );

		$title  = $this->get( $s, 'intro_title' );
		$accent = $this->get( $s, 'intro_accent' );
		if ( '' !== trim( $title ) || '' !== trim( $accent ) ) {
			echo '<h2 class="mzk-ike-intro__title">';
			echo esc_html( $title );
			if ( '' !== trim( $accent ) ) {
				printf( '<span class="mzk-ike-intro__accent">%s</span>', esc_html( $accent ) );
			}
			echo '</h2>';
		}

		$this->rich( $this->get( $s, 'intro_body' ), 'mzk-ike-intro__body' );
		echo '</div>';

		echo '</div></section>';
	}

	private function render_workshops( $s ) {
		$cards = $this->rows( $s, 'workshops' );

		echo '<section class="mzk-ike-workshops" id="workshops"><div class="mzk-ike__inner mzk-ike-workshops__inner">';

		/*
		 * The wrapper starts here rather than at the track, because it has to contain the arrows
		 * too. The script finds a slider by walking up from whatever was clicked, so an arrow
		 * rendered outside the wrapper is an arrow that silently does nothing — which is what
		 * shipped the first time, and which no amount of PHP-side testing would have caught.
		 */
		echo '<div class="mzk-ike-slider">';

		echo '<div class="mzk-ike-workshops__head"><div class="mzk-ike-workshops__blurb">';
		$this->line( 'h2', 'mzk-ike-workshops__title', $this->get( $s, 'workshops_title' ) );
		$this->line( 'p', 'mzk-ike-workshops__intro', $this->get( $s, 'workshops_intro' ) );
		echo '</div>';

		if ( count( $cards ) > 1 ) {
			printf(
				'<div class="mzk-ike-slider__nav">
					<button type="button" class="mzk-ike-slider__arrow mzk-ike-slider__prev" aria-label="%1$s">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg>
					</button>
					<button type="button" class="mzk-ike-slider__arrow mzk-ike-slider__next" aria-label="%2$s">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
					</button>
				</div>',
				esc_attr__( 'Previous workshops', 'mizuki-booking' ),
				esc_attr__( 'More workshops', 'mizuki-booking' )
			);
		}
		echo '</div>';

		if ( ! $cards ) {
			echo '</div></div></section>';
			return;
		}

		printf(
			'<ul class="mzk-ike-slider__track" tabindex="0" role="list" aria-label="%s">',
			esc_attr( $this->get( $s, 'workshops_title', __( 'Workshops', 'mizuki-booking' ) ) )
		);

		foreach ( $cards as $card ) {
			echo '<li class="mzk-ike-card">';

			$image = isset( $card['image']['url'] ) ? $card['image']['url'] : '';
			if ( $image ) {
				echo '<div class="mzk-ike-card__figure">';
				$tag = isset( $card['tag'] ) ? $card['tag'] : '';
				if ( '' !== trim( $tag ) ) {
					printf( '<span class="mzk-ike-card__tag">%s</span>', esc_html( $tag ) );
				}
				printf(
					'<img src="%s" alt="%s" loading="lazy" />',
					esc_url( $image ),
					esc_attr( isset( $card['title'] ) ? $card['title'] : '' )
				);
				echo '</div>';
			}

			echo '<div class="mzk-ike-card__body">';
			$this->line( 'h3', 'mzk-ike-card__title', isset( $card['title'] ) ? $card['title'] : '' );

			$facts = $this->card_details( $card );
			if ( $facts ) {
				echo '<ul class="mzk-ike-card__facts">';
				foreach ( $facts as $fact ) {
					echo '<li>';
					if ( $fact['icon'] ) {
						$this->icon( array( 'icon' => $fact['icon'] ), 'mzk-ike-card__icon' );
					} else {
						// Keeps the words in line with the rows that do have one.
						echo '<span class="mzk-ike-card__icon mzk-ike-card__icon--none" aria-hidden="true"></span>';
					}
					printf( '<span>%s</span>', esc_html( $fact['text'] ) );
					echo '</li>';
				}
				echo '</ul>';
			}

			echo '<div class="mzk-ike-card__action">';
			$this->action(
				isset( $card['button_text'] ) ? $card['button_text'] : '',
				isset( $card['button_link'] ) ? $card['button_link'] : '',
				'mzk-ike__btn mzk-ike__btn--outline'
			);
			echo '</div>';

			echo '</div></li>';
		}

		echo '</ul>';

		/*
		 * The dots are built by the script, not here, because how many there should be is not a
		 * property of the content — it is how far the track can actually scroll, which depends on
		 * how many cards fit at this width. Four cards with three in view is two pages, not four,
		 * and drawing four left two dots that did nothing when pressed.
		 */
		if ( count( $cards ) > 1 ) {
			printf(
				'<div class="mzk-ike-slider__dots" role="tablist" aria-label="%s"></div>',
				esc_attr__( 'Choose a page of workshops', 'mizuki-booking' )
			);
		}

		echo '</div></div></section>';
	}

	/**
	 * A card's detail rows, each with its own icon.
	 *
	 * Falls back to the single textarea and single icon this widget shipped with. Elementor keeps
	 * the settings of controls that no longer exist, so a card typed before the change still has
	 * its words — dropping them because the panel moved on would be losing the studio's writing
	 * to an implementation detail.
	 */
	private function card_details( $card ) {
		$rows = array();

		for ( $row = 1; $row <= 5; $row++ ) {
			$text = isset( $card[ 'detail_' . $row . '_text' ] ) ? trim( (string) $card[ 'detail_' . $row . '_text' ] ) : '';
			if ( '' === $text ) {
				continue;
			}

			$icon = isset( $card[ 'detail_' . $row . '_icon' ] ) ? $card[ 'detail_' . $row . '_icon' ] : null;
			if ( empty( $icon['value'] ) ) {
				$icon = null;
			}

			$rows[] = array( 'text' => $text, 'icon' => $icon );
		}

		if ( $rows ) {
			return $rows;
		}

		$legacy = isset( $card['icon'] ) && ! empty( $card['icon']['value'] ) ? $card['icon'] : null;

		foreach ( $this->lines( isset( $card['facts'] ) ? $card['facts'] : '' ) as $text ) {
			$rows[] = array( 'text' => $text, 'icon' => $legacy );
		}

		return $rows;
	}

	private function render_featured( $s ) {
		$image = $this->image_url( $s, 'featured_image' );
		$facts = $this->rows( $s, 'featured_facts' );

		echo '<section class="mzk-ike-featured"><div class="mzk-ike__inner mzk-ike-featured__grid">';

		if ( $image ) {
			printf(
				'<div class="mzk-ike-featured__media"><div class="mzk-ike__framed"><img src="%s" alt="%s" loading="lazy" /></div></div>',
				esc_url( $image ),
				esc_attr( $this->get( $s, 'featured_title' ) )
			);
		}

		echo '<div class="mzk-ike-featured__text">';
		$this->line( 'span', 'mzk-ike__eyebrow mzk-ike-featured__eyebrow', $this->get( $s, 'featured_eyebrow' ) );
		$this->line( 'h2', 'mzk-ike-featured__title', $this->get( $s, 'featured_title' ) );
		$this->rich( $this->get( $s, 'featured_body' ), 'mzk-ike-featured__body' );

		if ( $facts ) {
			echo '<ul class="mzk-ike-facts">';
			foreach ( $facts as $fact ) {
				echo '<li>';
				$this->icon( $fact, 'mzk-ike-facts__icon' );
				echo '<div>';
				$this->line( 'p', 'mzk-ike-facts__label', isset( $fact['label'] ) ? $fact['label'] : '' );
				$this->line( 'p', 'mzk-ike-facts__value', isset( $fact['value'] ) ? $fact['value'] : '' );
				echo '</div></li>';
			}
			echo '</ul>';
		}

		$text = $this->get( $s, 'featured_button_text' );
		if ( '' !== trim( $text ) ) {
			echo '<div class="mzk-ike-featured__action">';
			$this->action( $text, $this->get( $s, 'featured_button_link' ), 'mzk-ike__btn mzk-ike__btn--solid' );
			echo '</div>';
		}

		echo '</div></div></section>';
	}

	private function render_benefits( $s ) {
		$points = $this->rows( $s, 'benefits' );

		if ( ! $points ) {
			return;
		}

		echo '<section class="mzk-ike-benefits"><div class="mzk-ike__inner mzk-ike-benefits__grid">';

		foreach ( $points as $point ) {
			echo '<div class="mzk-ike-benefit">';
			$this->icon( $point, 'mzk-ike-benefit__icon' );
			$this->line( 'h3', '', isset( $point['title'] ) ? $point['title'] : '' );
			$this->line( 'p', '', isset( $point['text'] ) ? $point['text'] : '' );
			echo '</div>';
		}

		echo '</div></section>';
	}

	private function render_gallery( $s ) {
		$images   = $this->rows( $s, 'gallery_images' );
		$lightbox = ! isset( $s['gallery_lightbox'] ) || 'yes' === $s['gallery_lightbox'];

		echo '<section class="mzk-ike-gallery"><div class="mzk-ike__inner">';

		echo '<div class="mzk-ike-gallery__head">';
		$this->line( 'span', 'mzk-ike__eyebrow mzk-ike-gallery__eyebrow', $this->get( $s, 'gallery_eyebrow' ) );
		$this->line( 'h2', 'mzk-ike-gallery__title', $this->get( $s, 'gallery_title' ) );
		echo '</div>';

		if ( ! $images ) {
			echo '</div></section>';
			return;
		}

		echo '<div class="mzk-ike-gallery__grid">';

		foreach ( $images as $index => $image ) {
			$url = isset( $image['url'] ) ? $image['url'] : '';
			if ( ! $url ) {
				continue;
			}

			$alt = '';
			if ( ! empty( $image['id'] ) ) {
				$alt = get_post_meta( (int) $image['id'], '_wp_attachment_image_alt', true );
			}

			$label = sprintf(
				/* translators: %d: the picture's place in the gallery. */
				__( 'Open picture %d', 'mizuki-booking' ),
				(int) $index + 1
			);

			/*
			 * A button when it opens something and a plain figure when it does not. A div with a
			 * click handler is unreachable from a keyboard, and a picture that cannot be opened
			 * should not offer a cursor that says it can.
			 */
			if ( $lightbox ) {
				printf(
					'<button type="button" class="mzk-ike-gallery__item" data-full="%1$s" aria-label="%2$s"><img src="%1$s" alt="%3$s" loading="lazy" /></button>',
					esc_url( $url ),
					esc_attr( $label ),
					esc_attr( $alt )
				);
			} else {
				printf(
					'<div class="mzk-ike-gallery__item mzk-ike-gallery__item--plain"><img src="%s" alt="%s" loading="lazy" /></div>',
					esc_url( $url ),
					esc_attr( $alt )
				);
			}
		}

		echo '</div></div></section>';

		if ( $lightbox ) {
			$this->render_lightbox();
		}
	}

	/**
	 * One lightbox for the page, not one per picture.
	 *
	 * Rendered here and moved to <body> by the script: `position: fixed` resolves against the
	 * nearest ancestor with a transform or a filter, and Elementor applies both, so left where
	 * it sits the overlay would cover its own section rather than the window.
	 */
	public static $lightbox_drawn = false;

	private function render_lightbox() {
		/*
		 * Once per page, not once per widget: two of these on one page would otherwise render two
		 * dialogs sharing an id, and every gallery on the page would open whichever one the
		 * browser found first.
		 *
		 * A property rather than a static local so a page boundary can be expressed. One request
		 * draws one page, but a test process draws many, and without a way to say "new page" the
		 * second page in a run silently has no lightbox at all.
		 */
		if ( self::$lightbox_drawn ) {
			return;
		}
		self::$lightbox_drawn = true;

		printf(
			'<div class="mzk-ike-lightbox" id="mzk-ike-lightbox" role="dialog" aria-modal="true" aria-label="%1$s" hidden>
				<button type="button" class="mzk-ike-lightbox__btn mzk-ike-lightbox__close" aria-label="%2$s">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>
				</button>
				<button type="button" class="mzk-ike-lightbox__btn mzk-ike-lightbox__prev" aria-label="%3$s">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg>
				</button>
				<button type="button" class="mzk-ike-lightbox__btn mzk-ike-lightbox__next" aria-label="%4$s">
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
				</button>
				<figure class="mzk-ike-lightbox__figure">
					<img class="mzk-ike-lightbox__img" alt="" />
					<figcaption class="mzk-ike-lightbox__caption" hidden></figcaption>
				</figure>
				<p class="mzk-ike-lightbox__count"></p>
			</div>',
			esc_attr__( 'Gallery', 'mizuki-booking' ),
			esc_attr__( 'Close', 'mizuki-booking' ),
			esc_attr__( 'Previous picture', 'mizuki-booking' ),
			esc_attr__( 'Next picture', 'mizuki-booking' )
		);
	}
}
