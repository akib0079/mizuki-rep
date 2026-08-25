<?php
/**
 * The IFDA course page, as one widget.
 *
 * This is the exception to the rule the other widgets follow. They deliberately leave the page to
 * Elementor and only supply what Elementor cannot build — a real calendar, a real account block.
 * This one is a whole page, because the IFDA page is a fixed piece of writing with a fixed shape:
 * a hero, who IFDA are, what the certification is worth, and two courses side by side. Rebuilding
 * that out of forty Elementor elements is possible and nobody would enjoy maintaining it.
 *
 * So: every string and every image is a control, and none of the spacing, colour or type is. The
 * look lives in assets/ifda.css. That is the trade — the studio edits words and pictures, and the
 * page cannot drift out of shape while they do it.
 *
 * The booking block at the foot is the same one the other widgets mount, with the same course and
 * the same shadow root. The course buttons above it are ordinary links carrying `mizuki-book`,
 * which the existing script already understands, so choosing a course scrolls down and switches
 * the calendar to it without a line of new JavaScript.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Mizuki_Elementor_IFDA_Page extends \Elementor\Widget_Base {

	use Mizuki_Elementor_Shared;

	public function get_name() {
		return 'mizuki-ifda-page';
	}

	public function get_title() {
		return __( 'IFDA course page', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-single-page';
	}

	public function get_keywords() {
		return array( 'mizuki', 'ifda', 'course', 'page', 'korean', 'preserved', 'certification' );
	}

	public function get_style_depends() {
		return array( 'mizuki-ifda' );
	}

	/**
	 * -------------------------------------------------------------------------
	 * Controls
	 * -------------------------------------------------------------------------
	 */

	protected function register_controls() {
		$this->register_hero_controls();
		$this->register_about_controls();
		$this->register_certification_controls();
		$this->register_course_controls();
		$this->register_booking_controls();
	}

	private function placeholder() {
		return class_exists( '\Elementor\Utils' ) ? \Elementor\Utils::get_placeholder_image_src() : '';
	}

	private function register_hero_controls() {
		$this->start_controls_section( 'section_hero', array( 'label' => __( 'Hero', 'mizuki-booking' ) ) );

		$this->add_control( 'hero_image', array(
			'label'   => __( 'Background image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->placeholder() ),
		) );

		$this->add_control( 'hero_mark', array(
			'label'       => __( 'Small logo', 'mizuki-booking' ),
			'description' => __( 'Shown above the heading. Drawn in white, so a dark logo is fine.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::MEDIA,
			'default'     => array( 'url' => '' ),
		) );

		$this->add_control( 'hero_eyebrow', array(
			'label'   => __( 'Small line above the heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Official Singapore Branch of Korea IFDA', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Learn Korean Preserved Floral Design', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Discover the art of preserved flowers through IFDA-certified courses, guided by Mizuki with Korean authenticity, thoughtful technique, and lasting artistry.', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_primary_text', array(
			'label'   => __( 'First button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Explore Courses', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_primary_link', array(
			'label'       => __( 'First button goes to', 'mizuki-booking' ),
			'description' => __( 'An anchor on this page, or a full address.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '#course-details',
		) );

		$this->add_control( 'hero_secondary_text', array(
			'label'   => __( 'Second button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Book a Lesson', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_secondary_link', array(
			'label'   => __( 'Second button goes to', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '#book-lesson',
		) );

		$this->add_control( 'hero_trust', array(
			'label'   => __( 'Line above the credentials', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Certificates issued directly by Korea IFDA', 'mizuki-booking' ),
		) );

		$credential = new \Elementor\Repeater();
		$credential->add_control( 'text', array(
			'label'   => __( 'Credential', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Official Singapore Branch', 'mizuki-booking' ),
		) );

		$this->add_control( 'hero_credentials', array(
			'label'       => __( 'Credentials', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $credential->get_controls(),
			'title_field' => '{{{ text }}}',
			'default'     => array(
				array( 'text' => __( 'Official Singapore Branch', 'mizuki-booking' ) ),
				array( 'text' => __( 'Certification Courses', 'mizuki-booking' ) ),
				array( 'text' => __( 'Flexible Lesson Scheduling', 'mizuki-booking' ) ),
			),
		) );

		$this->end_controls_section();
	}

	private function register_about_controls() {
		$this->start_controls_section( 'section_about', array( 'label' => __( 'About IFDA', 'mizuki-booking' ) ) );

		$this->add_control( 'about_eyebrow', array(
			'label'   => __( 'Small line above the heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'About IFDA', 'mizuki-booking' ),
		) );

		$this->add_control( 'about_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'International Flower Design Association', 'mizuki-booking' ),
		) );

		$this->add_control( 'about_lead', array(
			'label'   => __( 'Opening line', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Korean floral education rooted in bold colour, natural beauty, and thoughtful design.', 'mizuki-booking' ),
		) );

		$this->add_control( 'about_body', array(
			'label'   => __( 'Body', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '<p>' . __( 'Founded by renowned Korean florist Ms. Yang Eun-Jin, IFDA is celebrated for its bold colour combinations and natural aesthetics. Even preserved flowers retain their organic beauty through designs that feel expressive, balanced, and alive.', 'mizuki-booking' ) . '</p>'
				. '<p>' . __( 'From this summer, Mizuki has become the official Singapore branch of Korea IFDA, bringing authentic Korean floral-design education closer to home.', 'mizuki-booking' ) . '</p>'
				. '<p>' . __( 'We now provide certification courses, with all certificates issued directly by Korea IFDA.', 'mizuki-booking' ) . '</p>',
		) );

		$this->add_control( 'about_image', array(
			'label'   => __( 'Image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->placeholder() ),
		) );

		$this->end_controls_section();
	}

	private function register_certification_controls() {
		$this->start_controls_section( 'section_cert', array( 'label' => __( 'Certification', 'mizuki-booking' ) ) );

		$this->add_control( 'cert_eyebrow', array(
			'label'   => __( 'Small line above the heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Recognised Floral Education', 'mizuki-booking' ),
		) );

		$this->add_control( 'cert_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Learn with recognised Korean certification.', 'mizuki-booking' ),
		) );

		$this->add_control( 'cert_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Mizuki’s IFDA courses combine hands-on floral artistry with recognised educational standards.', 'mizuki-booking' ),
		) );

		$card = new \Elementor\Repeater();
		$card->add_control( 'icon', array(
			'label'   => __( 'Icon', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::ICONS,
			'default' => array( 'value' => 'fas fa-certificate', 'library' => 'fa-solid' ),
		) );
		$card->add_control( 'title', array(
			'label'   => __( 'Title', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Official Singapore Branch', 'mizuki-booking' ),
		) );
		$card->add_control( 'text', array(
			'label'   => __( 'Text', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Mizuki brings authentic Korea IFDA floral-design education to Singapore.', 'mizuki-booking' ),
		) );

		$this->add_control( 'cert_cards', array(
			'label'       => __( 'Cards', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $card->get_controls(),
			'title_field' => '{{{ title }}}',
			'default'     => array(
				array(
					'icon'  => array( 'value' => 'fas fa-map-marker-alt', 'library' => 'fa-solid' ),
					'title' => __( 'Official Singapore Branch', 'mizuki-booking' ),
					'text'  => __( 'Mizuki brings authentic Korea IFDA floral-design education to Singapore.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-award', 'library' => 'fa-solid' ),
					'title' => __( 'Korea-issued Certificates', 'mizuki-booking' ),
					'text'  => __( 'All course certificates are issued directly by Korea IFDA upon successful completion and qualification.', 'mizuki-booking' ),
				),
				array(
					'icon'  => array( 'value' => 'fas fa-university', 'library' => 'fa-solid' ),
					'title' => __( 'Officially Accredited', 'mizuki-booking' ),
					'text'  => __( 'Courses are accredited by the Ministry of Agriculture, Food and Rural Affairs and the Korean Institute for Vocational Education and Training.', 'mizuki-booking' ),
				),
			),
		) );

		$this->add_control( 'cert_note', array(
			'label'       => __( 'Footnote', 'mizuki-booking' ),
			'description' => __( 'One accrediting body per line.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 4,
			'default'     => __( "The courses are officially accredited by:\nMinistry of Agriculture, Food and Rural Affairs, as floral design falls under agriculture\nKorean Institute for Vocational Education and Training", 'mizuki-booking' ),
		) );

		$this->end_controls_section();
	}

	private function register_course_controls() {
		$this->start_controls_section( 'section_courses', array( 'label' => __( 'Courses', 'mizuki-booking' ) ) );

		$this->add_control( 'courses_eyebrow', array(
			'label'   => __( 'Small line above the heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Course Details', 'mizuki-booking' ),
		) );

		$this->add_control( 'courses_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Explore our IFDA programmes.', 'mizuki-booking' ),
		) );

		/*
		 * One repeater item per tab. The lists inside are line-per-item text boxes rather than
		 * repeaters of their own, because Elementor does not nest repeaters — and for a
		 * thirteen-item list, typing thirteen lines is faster than opening thirteen panels.
		 */
		$course = new \Elementor\Repeater();

		$course->add_control( 'tab_label', array(
			'label'   => __( 'Tab', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Beginner Course', 'mizuki-booking' ),
		) );

		$course->add_control( 'image', array(
			'label'   => __( 'Image', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => $this->placeholder() ),
		) );

		$course->add_control( 'eyebrow', array(
			'label'   => __( 'Small line above the title', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'IFDA Preserved Flower Design', 'mizuki-booking' ),
		) );

		$course->add_control( 'title', array(
			'label'   => __( 'Title', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Beginner Course', 'mizuki-booking' ),
		) );

		$course->add_control( 'tagline', array(
			'label'   => __( 'Tagline', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'A confident first step into the art of preserved floral design.', 'mizuki-booking' ),
		) );

		$course->add_control( 'body', array(
			'label'   => __( 'Description', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::WYSIWYG,
			'default' => '',
		) );

		$course->add_control( 'learn_title', array(
			'label'   => __( 'List heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'What you will learn', 'mizuki-booking' ),
		) );

		$course->add_control( 'learn_items', array(
			'label'       => __( 'What you will learn', 'mizuki-booking' ),
			'description' => __( 'One per line.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 8,
			'default'     => '',
		) );

		$course->add_control( 'book_text', array(
			'label'   => __( 'Booking button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Book Beginner Course Lesson', 'mizuki-booking' ),
		) );

		$course->add_control( 'book_course', array(
			'label'       => __( 'Booking button opens', 'mizuki-booking' ),
			'description' => __( 'The course slug the calendar should switch to, e.g. ifda. Leave empty to use the one set under Booking.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => '',
		) );

		$course->add_control( 'ask_text', array(
			'label'   => __( 'Second button', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Ask a Question', 'mizuki-booking' ),
		) );

		$course->add_control( 'ask_link', array(
			'label'   => __( 'Second button goes to', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => '',
		) );

		$course->add_control( 'projects_title', array(
			'label'   => __( 'Pieces heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Create 7 signature pieces', 'mizuki-booking' ),
		) );

		$course->add_control( 'projects_intro', array(
			'label'   => __( 'Pieces introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 2,
			'default' => __( 'Build confidence by creating a curated series of small, beautiful preserved-flower designs.', 'mizuki-booking' ),
		) );

		$course->add_control( 'projects_items', array(
			'label'       => __( 'The pieces', 'mizuki-booking' ),
			'description' => __( 'One per line. They are numbered automatically.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXTAREA,
			'rows'        => 8,
			'default'     => '',
		) );

		$course->add_control( 'callout_title', array(
			'label'   => __( 'Note heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Learn without rushing.', 'mizuki-booking' ),
		) );

		$course->add_control( 'callout_text', array(
			'label'   => __( 'Note', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'With preserved flowers that will not fade or wilt, you can enjoy greater flexibility in scheduling and learn at your own rhythm, without the rush.', 'mizuki-booking' ),
		) );

		$this->add_control( 'courses', array(
			'label'       => __( 'Courses', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::REPEATER,
			'fields'      => $course->get_controls(),
			'title_field' => '{{{ tab_label }}}',
			'default'     => $this->default_courses(),
		) );

		$this->end_controls_section();
	}

	/** The two courses as the studio's own page has them, so a fresh widget is not an empty one. */
	private function default_courses() {
		return array(
			array(
				'tab_label'      => __( 'Beginner Course', 'mizuki-booking' ),
				'image'          => array( 'url' => $this->placeholder() ),
				'eyebrow'        => __( 'IFDA Preserved Flower Design', 'mizuki-booking' ),
				'title'          => __( 'Beginner Course', 'mizuki-booking' ),
				'tagline'        => __( 'A confident first step into the art of preserved floral design.', 'mizuki-booking' ),
				'body'           => '<p>' . __( 'Designed for those new to floral design or looking to expand their skills, this course lays a strong foundation in preserved flower techniques. It is the perfect first step before advancing to the IFDA Master Course.', 'mizuki-booking' ) . '</p>'
					. '<p>' . __( 'We begin with simpler, smaller projects to help you build confidence and essential techniques at a comfortable pace. Whether you are exploring a new hobby or adding to your professional florist toolkit, this course offers a rewarding start.', 'mizuki-booking' ) . '</p>',
				'learn_title'    => __( 'What you will learn', 'mizuki-booking' ),
				'learn_items'    => __( "Essential preserved-flower handling and floral-design techniques\nIFDA’s signature rose-blooming method\nConfidence through smaller guided floral projects\nFoundational composition, proportion, and finishing techniques\nPractical techniques for creating polished, long-lasting floral work\nFlexible learning at your own pace", 'mizuki-booking' ),
				'book_text'      => __( 'Book Beginner Course Lesson', 'mizuki-booking' ),
				'book_course'    => '',
				'ask_text'       => __( 'Ask a Question', 'mizuki-booking' ),
				'ask_link'       => '',
				'projects_title' => __( 'Create 7 signature pieces', 'mizuki-booking' ),
				'projects_intro' => __( 'Build confidence by creating a curated series of small, beautiful preserved-flower designs.', 'mizuki-booking' ),
				'projects_items' => __( "Hairpin\nBoutonniere\nGypsophila Wreath\nHydrangea Topiary\nMini Bouquet\nMini Flower Box\nSmall Centrepiece", 'mizuki-booking' ),
				'callout_title'  => __( 'Learn without rushing.', 'mizuki-booking' ),
				'callout_text'   => __( 'With preserved flowers that will not fade or wilt, you can enjoy greater flexibility in scheduling and learn at your own rhythm, without the rush.', 'mizuki-booking' ),
			),
			array(
				'tab_label'      => __( 'Master Course', 'mizuki-booking' ),
				'image'          => array( 'url' => $this->placeholder() ),
				'eyebrow'        => __( 'IFDA Preserved Flower Design', 'mizuki-booking' ),
				'title'          => __( 'Master Course', 'mizuki-booking' ),
				'tagline'        => __( 'Create more expressive arrangements with stronger technical and design confidence.', 'mizuki-booking' ),
				'body'           => '<p>' . __( 'A step further in preserved floral artistry, this course offers more elaborate designs and introduces a wider range of blooming techniques.', 'mizuki-booking' ) . '</p>'
					. '<p>' . __( 'Perfect for florists looking to deepen their skills, and equally welcoming to beginners seeking a creative, hands-on hobby.', 'mizuki-booking' ) . '</p>'
					. '<p>' . __( 'With a focus on conceptual design thinking, you will learn how to translate ideas into cohesive arrangements through thoughtful colour coordination, material selection, and balanced composition. The course makes design principles clear and approachable.', 'mizuki-booking' ) . '</p>',
				'learn_title'    => __( 'What you will learn', 'mizuki-booking' ),
				'learn_items'    => __( "More elaborate preserved floral designs\nA wider range of blooming techniques\nConceptual floral-design thinking\nThoughtful colour coordination\nMaterial selection and floral styling\nBalanced composition and visual harmony\nThe confidence to translate ideas into cohesive arrangements\nFlexible learning at your own pace", 'mizuki-booking' ),
				'book_text'      => __( 'Book Master Course Lesson', 'mizuki-booking' ),
				'book_course'    => '',
				'ask_text'       => __( 'Ask a Question', 'mizuki-booking' ),
				'ask_link'       => '',
				'projects_title' => __( 'Create 13 signature pieces', 'mizuki-booking' ),
				'projects_intro' => __( 'Develop your design eye through a wide range of preserved-flower projects, from detailed accessories to larger statement arrangements.', 'mizuki-booking' ),
				'projects_items' => __( "Hairpin\nBoutonniere\nFlower Dome\nFloral Frame\nFloral Tiara\nWreath\nFlower Box\nFlower Urn\nButterfly-style Basket\nNatural-style Topiary\nBirdcage Design\nBouquet\nBridal Bouquet", 'mizuki-booking' ),
				'callout_title'  => __( 'Creative learning with flexibility.', 'mizuki-booking' ),
				'callout_text'   => __( 'Thanks to the long-lasting nature of preserved materials, the course allows for flexible scheduling and the freedom to learn at your own pace.', 'mizuki-booking' ),
			),
		);
	}

	private function register_booking_controls() {
		$this->start_controls_section( 'section_booking', array( 'label' => __( 'Booking', 'mizuki-booking' ) ) );

		$this->add_control( 'booking_show', array(
			'label'        => __( 'Show the booking block', 'mizuki-booking' ),
			'type'         => \Elementor\Controls_Manager::SWITCHER,
			'default'      => 'yes',
			'description'  => __( 'The calendar and student sign-in, at the foot of the page.', 'mizuki-booking' ),
		) );

		$this->add_control( 'booking_mark', array(
			'label'   => __( 'Small logo', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::MEDIA,
			'default' => array( 'url' => '' ),
		) );

		$this->add_control( 'booking_eyebrow', array(
			'label'   => __( 'Small line above the heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Book Your Lesson', 'mizuki-booking' ),
		) );

		$this->add_control( 'booking_title', array(
			'label'   => __( 'Heading', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => __( 'Choose a time that works for you.', 'mizuki-booking' ),
		) );

		$this->add_control( 'booking_intro', array(
			'label'   => __( 'Introduction', 'mizuki-booking' ),
			'type'    => \Elementor\Controls_Manager::TEXTAREA,
			'rows'    => 3,
			'default' => __( 'Select an available IFDA lesson slot. Existing IFDA students can sign in below to book lessons included in their course fee.', 'mizuki-booking' ),
		) );

		$this->add_course_control( __( 'Which course the calendar and sign-in are for.', 'mizuki-booking' ), 'ifda' );

		$this->add_control( 'booking_anchor', array(
			'label'       => __( 'Anchor', 'mizuki-booking' ),
			'description' => __( 'What the buttons above scroll to.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => 'book-lesson',
		) );

		$this->add_control( 'live_preview', array(
			'label'       => __( 'Show it while editing', 'mizuki-booking' ),
			'description' => __( 'Off by default: the real block talks to the booking system on every keystroke.', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::SWITCHER,
			'default'     => '',
		) );

		$this->end_controls_section();
	}

	/**
	 * -------------------------------------------------------------------------
	 * Drawing
	 * -------------------------------------------------------------------------
	 */

	protected function render_widget() {
		$s = $this->get_settings_for_display();

		echo '<div class="mzk-ifda">';
		$this->render_hero( $s );
		$this->render_about( $s );
		$this->render_certification( $s );
		$this->render_courses( $s );
		$this->render_booking( $s );
		echo '</div>';
	}

	/* ---------------------------------------------------------------- parts */

	private function render_hero( $s ) {
		$image = $this->image_url( $s, 'hero_image' );
		$mark  = $this->image_url( $s, 'hero_mark' );

		echo '<section class="mzk-ifda-hero">';

		if ( $image ) {
			printf(
				'<div class="mzk-ifda-hero__bg"><img src="%s" alt="" /></div>',
				esc_url( $image )
			);
		}

		echo '<div class="mzk-ifda-hero__content">';

		if ( $mark ) {
			printf( '<img class="mzk-ifda-hero__mark" src="%s" alt="" />', esc_url( $mark ) );
		}

		$this->line( 'span', 'mzk-ifda__eyebrow mzk-ifda-hero__eyebrow', $this->get( $s, 'hero_eyebrow' ) );
		$this->line( 'h1', 'mzk-ifda-hero__title', $this->get( $s, 'hero_title' ) );
		$this->line( 'p', 'mzk-ifda-hero__intro', $this->get( $s, 'hero_intro' ) );

		$primary   = $this->get( $s, 'hero_primary_text' );
		$secondary = $this->get( $s, 'hero_secondary_text' );

		if ( '' !== $primary || '' !== $secondary ) {
			echo '<div class="mzk-ifda-hero__actions">';
			$this->button( $primary, $this->get( $s, 'hero_primary_link' ), 'mzk-ifda__btn--solid' );
			$this->button( $secondary, $this->get( $s, 'hero_secondary_link' ), 'mzk-ifda__btn--ghost' );
			echo '</div>';
		}

		$trust       = $this->get( $s, 'hero_trust' );
		$credentials = $this->rows( $s, 'hero_credentials' );

		if ( '' !== $trust || $credentials ) {
			echo '<div class="mzk-ifda-hero__trust">';
			$this->line( 'p', '', $trust );

			if ( $credentials ) {
				echo '<ul class="mzk-ifda-hero__creds">';
				foreach ( $credentials as $credential ) {
					$text = isset( $credential['text'] ) ? $credential['text'] : '';
					if ( '' !== trim( $text ) ) {
						printf( '<li>%s</li>', esc_html( $text ) );
					}
				}
				echo '</ul>';
			}
			echo '</div>';
		}

		echo '</div></section>';
	}

	private function render_about( $s ) {
		$image = $this->image_url( $s, 'about_image' );

		echo '<section class="mzk-ifda-about"><div class="mzk-ifda__inner mzk-ifda-about__grid">';
		echo '<div class="mzk-ifda-about__text">';

		$this->line( 'span', 'mzk-ifda__eyebrow mzk-ifda-about__eyebrow', $this->get( $s, 'about_eyebrow' ) );
		$this->line( 'h2', 'mzk-ifda-about__title', $this->get( $s, 'about_title' ) );
		$this->line( 'p', 'mzk-ifda-about__lead', $this->get( $s, 'about_lead' ) );

		$body = $this->get( $s, 'about_body' );
		if ( '' !== trim( wp_strip_all_tags( $body ) ) ) {
			printf( '<div class="mzk-ifda-about__body">%s</div>', wp_kses_post( $body ) );
		}

		echo '</div>';

		if ( $image ) {
			printf(
				'<div class="mzk-ifda-about__media"><img src="%s" alt="%s" loading="lazy" /></div>',
				esc_url( $image ),
				esc_attr( $this->get( $s, 'about_title' ) )
			);
		}

		echo '</div></section>';
	}

	private function render_certification( $s ) {
		$cards = $this->rows( $s, 'cert_cards' );

		echo '<section class="mzk-ifda-cert"><div class="mzk-ifda__inner">';
		echo '<div class="mzk-ifda-cert__head">';
		$this->line( 'span', 'mzk-ifda__eyebrow mzk-ifda-cert__eyebrow', $this->get( $s, 'cert_eyebrow' ) );
		$this->line( 'h2', 'mzk-ifda-cert__title', $this->get( $s, 'cert_title' ) );
		$this->line( 'p', 'mzk-ifda-cert__intro', $this->get( $s, 'cert_intro' ) );
		echo '</div>';

		if ( $cards ) {
			echo '<div class="mzk-ifda-cert__cards">';
			foreach ( $cards as $card ) {
				echo '<div class="mzk-ifda-cert__card">';

				if ( ! empty( $card['icon']['value'] ) && class_exists( '\Elementor\Icons_Manager' ) ) {
					echo '<div class="mzk-ifda-cert__icon">';
					\Elementor\Icons_Manager::render_icon( $card['icon'], array( 'aria-hidden' => 'true' ) );
					echo '</div>';
				}

				$this->line( 'h3', '', isset( $card['title'] ) ? $card['title'] : '' );
				$this->line( 'p', '', isset( $card['text'] ) ? $card['text'] : '' );
				echo '</div>';
			}
			echo '</div>';
		}

		$note = $this->lines( $this->get( $s, 'cert_note' ) );
		if ( $note ) {
			echo '<div class="mzk-ifda-cert__note"><p>';
			foreach ( $note as $index => $row ) {
				// The first line introduces the rest, so it carries the weight.
				printf(
					'%s%s',
					$index ? '<br />' : '',
					0 === $index ? '<strong>' . esc_html( $row ) . '</strong>' : esc_html( $row )
				);
			}
			echo '</p></div>';
		}

		echo '</div></section>';
	}

	private function render_courses( $s ) {
		$courses = $this->rows( $s, 'courses' );

		echo '<section class="mzk-ifda-courses" id="course-details"><div class="mzk-ifda__inner">';
		echo '<div class="mzk-ifda-courses__head">';
		$this->line( 'span', 'mzk-ifda__eyebrow mzk-ifda-courses__eyebrow', $this->get( $s, 'courses_eyebrow' ) );
		$this->line( 'h2', 'mzk-ifda-courses__title', $this->get( $s, 'courses_title' ) );
		echo '</div>';

		if ( ! $courses ) {
			echo '</div></section>';
			return;
		}

		$group = 'mzk-ifda-' . $this->get_id();

		/*
		 * A real tab list. Only shown when there is more than one course — a single tab is a
		 * heading pretending to be a control.
		 */
		if ( count( $courses ) > 1 ) {
			printf( '<div class="mzk-ifda-tabs" role="tablist" data-mzk-ifda-tabs="%s">', esc_attr( $group ) );
			foreach ( $courses as $index => $course ) {
				printf(
					'<button type="button" class="mzk-ifda-tab" role="tab" id="%1$s-tab-%2$d" aria-controls="%1$s-panel-%2$d" aria-selected="%3$s" tabindex="%4$s">%5$s</button>',
					esc_attr( $group ),
					(int) $index,
					$index ? 'false' : 'true',
					$index ? '-1' : '0',
					esc_html( isset( $course['tab_label'] ) ? $course['tab_label'] : '' )
				);
			}
			echo '</div>';
		}

		foreach ( $courses as $index => $course ) {
			printf(
				'<div class="mzk-ifda-panel%1$s" role="tabpanel" id="%2$s-panel-%3$d" aria-labelledby="%2$s-tab-%3$d"%4$s>',
				$index % 2 ? ' mzk-ifda-panel--alt' : '',
				esc_attr( $group ),
				(int) $index,
				$index ? ' hidden' : ''
			);
			$this->render_course( $course, $s );
			echo '</div>';
		}

		echo '</div></section>';
	}

	private function render_course( $course, $s ) {
		$image = isset( $course['image']['url'] ) ? $course['image']['url'] : '';

		echo '<div class="mzk-ifda-course">';

		if ( $image ) {
			printf(
				'<div class="mzk-ifda-course__media"><img src="%s" alt="%s" loading="lazy" /></div>',
				esc_url( $image ),
				esc_attr( isset( $course['title'] ) ? $course['title'] : '' )
			);
		}

		echo '<div class="mzk-ifda-course__body">';

		$this->line( 'span', 'mzk-ifda__eyebrow mzk-ifda-course__eyebrow', isset( $course['eyebrow'] ) ? $course['eyebrow'] : '' );
		$this->line( 'h2', 'mzk-ifda-course__title', isset( $course['title'] ) ? $course['title'] : '' );
		$this->line( 'p', 'mzk-ifda-course__tagline', isset( $course['tagline'] ) ? $course['tagline'] : '' );

		$body = isset( $course['body'] ) ? $course['body'] : '';
		if ( '' !== trim( wp_strip_all_tags( $body ) ) ) {
			printf( '<div class="mzk-ifda-course__intro">%s</div>', wp_kses_post( $body ) );
		}

		$learn = $this->lines( isset( $course['learn_items'] ) ? $course['learn_items'] : '' );
		if ( $learn ) {
			$this->line( 'h3', 'mzk-ifda-course__learn-title', isset( $course['learn_title'] ) ? $course['learn_title'] : '' );
			echo '<ul class="mzk-ifda-learn">';
			foreach ( $learn as $item ) {
				printf( '<li><span>%s</span></li>', esc_html( $item ) );
			}
			echo '</ul>';
		}

		$this->render_course_actions( $course, $s );
		$this->render_course_projects( $course );

		$callout_title = isset( $course['callout_title'] ) ? $course['callout_title'] : '';
		$callout_text  = isset( $course['callout_text'] ) ? $course['callout_text'] : '';

		if ( '' !== trim( $callout_title ) || '' !== trim( $callout_text ) ) {
			echo '<div class="mzk-ifda-callout">';
			echo '<svg class="mzk-ifda-callout__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';
			echo '<div>';
			$this->line( 'h4', '', $callout_title );
			$this->line( 'p', '', $callout_text );
			echo '</div></div>';
		}

		echo '</div></div>';
	}

	private function render_course_actions( $course, $s ) {
		$book = isset( $course['book_text'] ) ? $course['book_text'] : '';
		$ask  = isset( $course['ask_text'] ) ? $course['ask_text'] : '';

		if ( '' === trim( $book ) && '' === trim( $ask ) ) {
			return;
		}

		$anchor = sanitize_title( $this->get( $s, 'booking_anchor', 'book-lesson' ) );
		$slug   = isset( $course['book_course'] ) ? sanitize_title( $course['book_course'] ) : '';

		if ( '' === $slug ) {
			$slug = mizuki_elementor_course_value( $s );
		}

		echo '<div class="mzk-ifda-course__actions">';

		if ( '' !== trim( $book ) ) {
			/*
			 * `mizuki-book` is all this needs. The plugin's existing script already turns any
			 * element carrying that class into a booking button: it scrolls to the anchor and
			 * switches the calendar to `data-course` on the way. It is a real link first, so it
			 * still works with the script blocked.
			 */
			printf(
				'<a class="mzk-ifda__btn mzk-ifda__btn--solid mizuki-book" href="#%s"%s>%s</a>',
				esc_attr( $anchor ),
				$slug ? ' data-course="' . esc_attr( $slug ) . '"' : '',
				esc_html( $book )
			);
		}

		if ( '' !== trim( $ask ) ) {
			$this->button( $ask, isset( $course['ask_link'] ) ? $course['ask_link'] : '', 'mzk-ifda__btn--outline' );
		}

		echo '</div>';
	}

	private function render_course_projects( $course ) {
		$items = $this->lines( isset( $course['projects_items'] ) ? $course['projects_items'] : '' );
		$title = isset( $course['projects_title'] ) ? $course['projects_title'] : '';

		if ( ! $items && '' === trim( $title ) ) {
			return;
		}

		echo '<div class="mzk-ifda-projects">';
		$this->line( 'h3', 'mzk-ifda-projects__title', $title );
		$this->line( 'p', 'mzk-ifda-projects__intro', isset( $course['projects_intro'] ) ? $course['projects_intro'] : '' );

		if ( $items ) {
			// Past eight, cards become a wall of boxes, so the longer list reads as a list.
			printf(
				'<ul class="mzk-ifda-projects__list%s">',
				count( $items ) > 8 ? ' mzk-ifda-projects__list--long' : ''
			);
			foreach ( $items as $index => $item ) {
				printf(
					'<li><span class="mzk-ifda-projects__n">%02d</span><span>%s</span></li>',
					(int) $index + 1,
					esc_html( $item )
				);
			}
			echo '</ul>';
		}

		echo '</div>';
	}

	private function render_booking( $s ) {
		if ( 'yes' !== $this->get( $s, 'booking_show', 'yes' ) ) {
			return;
		}

		$anchor = sanitize_title( $this->get( $s, 'booking_anchor', 'book-lesson' ) );
		$mark   = $this->image_url( $s, 'booking_mark' );

		printf( '<section class="mzk-ifda-booking"%s>', $anchor ? ' id="' . esc_attr( $anchor ) . '"' : '' );
		echo '<div class="mzk-ifda__inner">';
		echo '<div class="mzk-ifda-booking__head">';

		if ( $mark ) {
			printf( '<img class="mzk-ifda-booking__mark" src="%s" alt="" />', esc_url( $mark ) );
		}

		$this->line( 'span', 'mzk-ifda__eyebrow mzk-ifda-booking__eyebrow', $this->get( $s, 'booking_eyebrow' ) );
		$this->line( 'h2', 'mzk-ifda-booking__title', $this->get( $s, 'booking_title' ) );
		$this->line( 'p', 'mzk-ifda-booking__intro', $this->get( $s, 'booking_intro' ) );
		echo '</div>';

		echo '<div class="mzk-ifda-booking__mount">';

		$editing = \Elementor\Plugin::$instance->editor->is_edit_mode();

		if ( $editing && 'yes' !== $this->get( $s, 'live_preview' ) ) {
			echo $this->editor_placeholder(  // phpcs:ignore WordPress.Security.EscapeOutput
				__( 'Booking calendar and student sign-in', 'mizuki-booking' ),
				__( 'The real block appears on the published page.', 'mizuki-booking' )
			);
		} else {
			echo mizuki_render_widget(  // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside.
				array( 'course' => mizuki_elementor_course_value( $s ) ),
				'course-portal'
			);
		}

		echo '</div></div></section>';
	}

	/* --------------------------------------------------------------- helpers */

	/** Elementor returns exactly what was saved, so anything added since simply is not there. */
	private function get( $settings, $key, $fallback = '' ) {
		return isset( $settings[ $key ] ) && '' !== $settings[ $key ] ? $settings[ $key ] : $fallback;
	}

	private function rows( $settings, $key ) {
		return isset( $settings[ $key ] ) && is_array( $settings[ $key ] ) ? $settings[ $key ] : array();
	}

	private function image_url( $settings, $key ) {
		return isset( $settings[ $key ]['url'] ) ? $settings[ $key ]['url'] : '';
	}

	/** One item per line, with the blank ones dropped so a stray return does not become a bullet. */
	private function lines( $text ) {
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return array();
		}

		$rows = preg_split( '/\R/', $text );

		return array_values( array_filter( array_map( 'trim', $rows ), function ( $row ) {
			return '' !== $row;
		} ) );
	}

	/** Skipped entirely when empty, so an unused field leaves no empty box on the page. */
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

	private function button( $text, $link, $variant ) {
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return;
		}

		$link = is_string( $link ) ? trim( $link ) : '';

		// An anchor is not a URL, and esc_url would throw it away.
		$href = ( '' !== $link && '#' === $link[0] ) ? $link : esc_url( $link );

		printf(
			'<a class="mzk-ifda__btn %s" href="%s">%s</a>',
			esc_attr( $variant ),
			esc_attr( $href ? $href : '#' ),
			esc_html( $text )
		);
	}
}
