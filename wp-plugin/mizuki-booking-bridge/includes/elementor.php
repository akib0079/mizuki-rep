<?php
/**
 * Elementor widgets for the Mizuki booking system.
 *
 * The booking system owns classes, places and balances; Elementor owns the page around them. So
 * these widgets deliberately do not try to be a page builder. There is no hero widget and no
 * "about" widget, because Elementor's own Heading, Text and Image widgets already do that better
 * than anything we would write, and the studio already knows how to use them.
 *
 * What is here is only what Elementor cannot do: a real calendar with real availability, the
 * student's own account block, and a button that opens the calendar at the right course.
 *
 * Colours are passed in as CSS custom properties rather than ordinary rules. The widget renders
 * inside a shadow root — which is what stops the theme breaking it — and ordinary selectors do
 * not cross that boundary. Custom properties do.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * -----------------------------------------------------------------------------
 * Registration
 * -----------------------------------------------------------------------------
 */

add_action( 'elementor/elements/categories_registered', 'mizuki_elementor_category' );
function mizuki_elementor_category( $manager ) {
	$manager->add_category(
		'mizuki',
		array(
			'title' => __( 'Mizuki Booking', 'mizuki-booking' ),
			'icon'  => 'eicon-calendar',
		)
	);
}

/*
 * Elementor renamed this hook in 3.5. Both are wired so the plugin does not silently register
 * nothing on a site that has not updated — which looks exactly like the widgets not existing.
 */
add_action( 'elementor/widgets/register', 'mizuki_elementor_register' );
add_action( 'elementor/widgets/widgets_registered', 'mizuki_elementor_register' );

function mizuki_elementor_register( $widgets_manager ) {
	static $done = false;
	if ( $done ) {
		return;
	}
	$done = true;

	$widgets = array(
		new Mizuki_Elementor_Calendar(),
		new Mizuki_Elementor_Account(),
		new Mizuki_Elementor_Book_Button(),
	);

	foreach ( $widgets as $widget ) {
		if ( method_exists( $widgets_manager, 'register' ) ) {
			$widgets_manager->register( $widget );
		} else {
			$widgets_manager->register_widget_type( $widget );
		}
	}
}

/**
 * -----------------------------------------------------------------------------
 * The course list, for the pickers
 * -----------------------------------------------------------------------------
 *
 * Asked of the booking system rather than typed by hand, so the studio picks "IFDA" from a list
 * instead of remembering that its slug is `ifda`. Cached for an hour; a failure is cached for two
 * minutes so an editing session against a system that is down does not make a request per keypress.
 */
function mizuki_elementor_courses() {
	$cached = get_transient( 'mizuki_course_list' );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	$api_base = mizuki_api_base();
	if ( ! $api_base ) {
		return array();
	}

	$response = wp_remote_get( $api_base . '/api/public/courses', array( 'timeout' => 5 ) );

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		set_transient( 'mizuki_course_list', array(), 2 * MINUTE_IN_SECONDS );
		return array();
	}

	$body    = json_decode( wp_remote_retrieve_body( $response ), true );
	$courses = array();

	foreach ( (array) ( isset( $body['courses'] ) ? $body['courses'] : array() ) as $course ) {
		if ( ! empty( $course['slug'] ) && ! empty( $course['name'] ) ) {
			$courses[ sanitize_title( $course['slug'] ) ] = sanitize_text_field( $course['name'] );
		}
	}

	set_transient( 'mizuki_course_list', $courses, HOUR_IN_SECONDS );
	return $courses;
}

/** Courses go stale when the studio adds one; clearing on demand beats waiting an hour. */
add_action( 'update_option_mizuki_booking_settings', 'mizuki_forget_course_list' );
function mizuki_forget_course_list() {
	delete_transient( 'mizuki_course_list' );
}

function mizuki_elementor_course_choices() {
	$choices = array( '' => __( 'Every course', 'mizuki-booking' ) );

	foreach ( mizuki_elementor_courses() as $slug => $name ) {
		$choices[ $slug ] = $name;
	}

	// Always offered, so a course added since this page was cached is still reachable — and so
	// the picker is not a dead end when the booking system cannot be reached from the editor.
	$choices['__custom'] = __( 'Another course (type its name below)', 'mizuki-booking' );

	return $choices;
}

/** What the picker actually resolved to. */
function mizuki_elementor_course_value( $settings ) {
	$course = isset( $settings['course'] ) ? $settings['course'] : '';

	if ( '__custom' === $course ) {
		return isset( $settings['course_custom'] ) ? sanitize_title( $settings['course_custom'] ) : '';
	}

	return sanitize_title( $course );
}

/**
 * -----------------------------------------------------------------------------
 * Shared pieces
 * -----------------------------------------------------------------------------
 */

trait Mizuki_Elementor_Shared {

	public function get_categories() {
		return array( 'mizuki' );
	}

	public function get_script_depends() {
		return array( 'mizuki-booking', 'mizuki-elementor' );
	}

	/** Which course this instance is about. Shared because all three widgets ask it. */
	protected function add_course_control( $description ) {
		$this->add_control(
			'course',
			array(
				'label'       => __( 'Course', 'mizuki-booking' ),
				'type'        => \Elementor\Controls_Manager::SELECT,
				'options'     => mizuki_elementor_course_choices(),
				'default'     => '',
				'description' => $description,
			)
		);

		$this->add_control(
			'course_custom',
			array(
				'label'       => __( 'Course name', 'mizuki-booking' ),
				'type'        => \Elementor\Controls_Manager::TEXT,
				'placeholder' => 'ifda',
				'description' => __( 'The short name the booking system uses for it, all lower case — for example ifda.', 'mizuki-booking' ),
				'condition'   => array( 'course' => '__custom' ),
			)
		);
	}

	/**
	 * The colours, as custom properties.
	 *
	 * Every one of these is left empty by default, so an untouched widget looks like the rest of
	 * the booking system. Fill one in and it wins, because these cross into the shadow root where
	 * an ordinary colour rule would simply never arrive.
	 */
	protected function add_palette_section() {
		$this->start_controls_section(
			'palette',
			array(
				'label' => __( 'Colours', 'mizuki-booking' ),
				'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
			)
		);

		$colours = array(
			'accent'       => array( __( 'Buttons and links', 'mizuki-booking' ), '--mzk-accent' ),
			'accent_dark'  => array( __( 'Buttons, hovered', 'mizuki-booking' ), '--mzk-accent-dark' ),
			'accent_light' => array( __( 'Highlight and focus ring', 'mizuki-booking' ), '--mzk-accent-light' ),
			'ink'          => array( __( 'Text', 'mizuki-booking' ), '--mzk-ink' ),
			'soft'         => array( __( 'Quiet text', 'mizuki-booking' ), '--mzk-soft' ),
			'line'         => array( __( 'Borders', 'mizuki-booking' ), '--mzk-line' ),
			'bg'           => array( __( 'Cards', 'mizuki-booking' ), '--mzk-bg' ),
			'canvas'       => array( __( 'Background', 'mizuki-booking' ), '--mzk-canvas' ),
		);

		foreach ( $colours as $name => $colour ) {
			$this->add_control(
				'colour_' . $name,
				array(
					'label'     => $colour[0],
					'type'      => \Elementor\Controls_Manager::COLOR,
					'selectors' => array(
						'{{WRAPPER}} [data-mizuki-booking]' => $colour[1] . ': {{VALUE}};',
					),
				)
			);
		}

		$this->end_controls_section();

		$this->start_controls_section(
			'lettering',
			array(
				'label' => __( 'Font', 'mizuki-booking' ),
				'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
			)
		);

		$this->add_group_control(
			\Elementor\Group_Control_Typography::get_type(),
			array(
				'name'     => 'font',
				'selector' => '{{WRAPPER}} [data-mizuki-booking]',
				// Only the family is offered, because only the family is honoured. The widget pins
				// its own sizes and weights so that a theme cannot make a date cell unreadable,
				// and a control that silently does nothing is worse than no control.
				'exclude'  => array( 'font_size', 'font_weight', 'line_height', 'letter_spacing', 'text_transform', 'text_decoration', 'font_style', 'word_spacing' ),
			)
		);

		$this->end_controls_section();
	}

	/**
	 * A stand-in for the editor, for when the real thing would be in the way.
	 *
	 * Off by default: a placeholder is never the height of the thing it stands for, so a page laid
	 * out against one is laid out wrong.
	 */
	protected function editor_placeholder( $title, $detail ) {
		return sprintf(
			'<div style="border:1px dashed #b6c2c6;border-radius:12px;padding:26px;text-align:center;color:#5d6f7a;font:14px/1.5 system-ui,sans-serif;background:#f7fafb">
				<strong style="display:block;color:#26313a;font-size:15px;margin-bottom:4px">%s</strong>%s</div>',
			esc_html( $title ),
			esc_html( $detail )
		);
	}
}

/**
 * -----------------------------------------------------------------------------
 * The calendar
 * -----------------------------------------------------------------------------
 */

class Mizuki_Elementor_Calendar extends \Elementor\Widget_Base {

	use Mizuki_Elementor_Shared;

	public function get_name() {
		return 'mizuki-calendar';
	}

	public function get_title() {
		return __( 'Booking calendar', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-calendar';
	}

	public function get_keywords() {
		return array( 'mizuki', 'booking', 'calendar', 'class', 'lesson', 'course' );
	}

	protected function register_controls() {
		$this->start_controls_section(
			'content',
			array( 'label' => __( 'Calendar', 'mizuki-booking' ) )
		);

		$this->add_course_control(
			__( 'Show only this course, so a student is not reading past classes they are not enrolled in.', 'mizuki-booking' )
		);

		$this->add_control(
			'view',
			array(
				'label'   => __( 'Show', 'mizuki-booking' ),
				'type'    => \Elementor\Controls_Manager::SELECT,
				'default' => 'calendar',
				'options' => array(
					'calendar' => __( 'The calendar only', 'mizuki-booking' ),
					'all'      => __( 'The calendar and "my bookings", as tabs', 'mizuki-booking' ),
				),
			)
		);

		$this->add_control(
			'anchor',
			array(
				'label'       => __( 'Anchor name', 'mizuki-booking' ),
				'type'        => \Elementor\Controls_Manager::TEXT,
				'default'     => 'book',
				'placeholder' => 'book',
				'description' => __( 'What the booking buttons on this page scroll to. Leave it as "book" unless there are two calendars on one page.', 'mizuki-booking' ),
			)
		);

		$this->add_control(
			'live_preview',
			array(
				'label'        => __( 'Show the real calendar while editing', 'mizuki-booking' ),
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'description'  => __( 'Leave this on so the page is laid out against the real height. Turn it off if a live calendar makes editing slow.', 'mizuki-booking' ),
				'label_on'     => __( 'Yes', 'mizuki-booking' ),
				'label_off'    => __( 'No', 'mizuki-booking' ),
				'return_value' => 'yes',
			)
		);

		$this->end_controls_section();

		$this->add_palette_section();
	}

	protected function render() {
		$settings = $this->get_settings_for_display();
		$editing  = \Elementor\Plugin::$instance->editor->is_edit_mode();

		if ( $editing && 'yes' !== $settings['live_preview'] ) {
			echo $this->editor_placeholder(  // phpcs:ignore WordPress.Security.EscapeOutput
				__( 'Booking calendar', 'mizuki-booking' ),
				__( 'The real calendar appears on the published page.', 'mizuki-booking' )
			);
			return;
		}

		$anchor = sanitize_title( $settings['anchor'] );
		$view   = 'all' === $settings['view'] ? 'all' : 'calendar';

		$embed = mizuki_render_widget(
			array( 'course' => mizuki_elementor_course_value( $settings ) ),
			$view
		);

		if ( '' === $embed ) {
			return;
		}

		printf(
			'<div class="mizuki-calendar-anchor"%s>%s</div>',
			$anchor ? ' id="' . esc_attr( $anchor ) . '"' : '',
			$embed // phpcs:ignore WordPress.Security.EscapeOutput -- built from escaped parts above.
		);
	}
}

/**
 * -----------------------------------------------------------------------------
 * The student's account block
 * -----------------------------------------------------------------------------
 */

class Mizuki_Elementor_Account extends \Elementor\Widget_Base {

	use Mizuki_Elementor_Shared;

	public function get_name() {
		return 'mizuki-account';
	}

	public function get_title() {
		return __( 'Student sign-in', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-lock-user';
	}

	public function get_keywords() {
		return array( 'mizuki', 'student', 'sign in', 'login', 'account', 'balance', 'lessons' );
	}

	protected function register_controls() {
		$this->start_controls_section(
			'content',
			array( 'label' => __( 'Sign in', 'mizuki-booking' ) )
		);

		$this->add_control(
			'about',
			array(
				'type'            => \Elementor\Controls_Manager::RAW_HTML,
				'raw'             => __( 'Shows a sign-in form to a visitor, and to a signed-in student their course, how many lessons are left and by when. There is nothing to sign up for here — the studio enrols a student once their course fee is paid.', 'mizuki-booking' ),
				'content_classes' => 'elementor-descriptor',
			)
		);

		$this->add_course_control(
			__( 'Which course balance to show. Leave it on every course and it shows whichever one they hold.', 'mizuki-booking' )
		);

		$this->add_control(
			'heading',
			array(
				'label'       => __( 'Heading', 'mizuki-booking' ),
				'type'        => \Elementor\Controls_Manager::TEXT,
				'placeholder' => __( 'Already taking IFDA?', 'mizuki-booking' ),
				'description' => __( 'Leave empty to use the course name automatically.', 'mizuki-booking' ),
			)
		);

		$this->add_control(
			'intro',
			array(
				'label'       => __( 'Sentence underneath', 'mizuki-booking' ),
				'type'        => \Elementor\Controls_Manager::TEXTAREA,
				'rows'        => 4,
				'placeholder' => __( 'Your lessons are included in your course fee, so there is nothing to pay…', 'mizuki-booking' ),
			)
		);

		$this->add_control(
			'live_preview',
			array(
				'label'        => __( 'Show the real block while editing', 'mizuki-booking' ),
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'default'      => 'yes',
				'label_on'     => __( 'Yes', 'mizuki-booking' ),
				'label_off'    => __( 'No', 'mizuki-booking' ),
				'return_value' => 'yes',
			)
		);

		$this->end_controls_section();

		$this->add_palette_section();
	}

	protected function render() {
		$settings = $this->get_settings_for_display();
		$editing  = \Elementor\Plugin::$instance->editor->is_edit_mode();

		if ( $editing && 'yes' !== $settings['live_preview'] ) {
			echo $this->editor_placeholder(  // phpcs:ignore WordPress.Security.EscapeOutput
				__( 'Student sign-in', 'mizuki-booking' ),
				__( 'The real block appears on the published page.', 'mizuki-booking' )
			);
			return;
		}

		echo mizuki_render_widget(  // phpcs:ignore WordPress.Security.EscapeOutput -- escaped inside.
			array( 'course' => mizuki_elementor_course_value( $settings ) ),
			'account',
			array(
				'data-heading' => sanitize_text_field( $settings['heading'] ),
				'data-intro'   => sanitize_textarea_field( $settings['intro'] ),
			)
		);
	}
}

/**
 * -----------------------------------------------------------------------------
 * A button that opens the calendar
 * -----------------------------------------------------------------------------
 *
 * It is a real link to a real anchor, so it works before any JavaScript runs and it works for
 * somebody who opens it in a new tab. The script only adds what a link cannot do on its own:
 * setting the calendar to the course the button is about before scrolling to it.
 */

class Mizuki_Elementor_Book_Button extends \Elementor\Widget_Base {

	use Mizuki_Elementor_Shared;

	public function get_name() {
		return 'mizuki-book-button';
	}

	public function get_title() {
		return __( 'Book a lesson button', 'mizuki-booking' );
	}

	public function get_icon() {
		return 'eicon-button';
	}

	public function get_keywords() {
		return array( 'mizuki', 'book', 'enquire', 'button', 'calendar' );
	}

	protected function register_controls() {
		$this->start_controls_section(
			'content',
			array( 'label' => __( 'Button', 'mizuki-booking' ) )
		);

		$this->add_control(
			'label',
			array(
				'label'   => __( 'Text', 'mizuki-booking' ),
				'type'    => \Elementor\Controls_Manager::TEXT,
				'default' => __( 'Book a lesson', 'mizuki-booking' ),
			)
		);

		$this->add_control(
			'target',
			array(
				'label'       => __( 'Scrolls to', 'mizuki-booking' ),
				'type'        => \Elementor\Controls_Manager::TEXT,
				'default'     => 'book',
				'description' => __( 'The anchor name on the booking calendar further down the page.', 'mizuki-booking' ),
			)
		);

		$this->add_course_control(
			__( 'Opens the calendar showing only this course. Leave it on every course for a general "book a lesson".', 'mizuki-booking' )
		);

		$this->add_responsive_control(
			'align',
			array(
				'label'     => __( 'Alignment', 'mizuki-booking' ),
				'type'      => \Elementor\Controls_Manager::CHOOSE,
				'options'   => array(
					'flex-start' => array( 'title' => __( 'Left', 'mizuki-booking' ), 'icon' => 'eicon-text-align-left' ),
					'center'     => array( 'title' => __( 'Centre', 'mizuki-booking' ), 'icon' => 'eicon-text-align-center' ),
					'flex-end'   => array( 'title' => __( 'Right', 'mizuki-booking' ), 'icon' => 'eicon-text-align-right' ),
					'stretch'    => array( 'title' => __( 'Full width', 'mizuki-booking' ), 'icon' => 'eicon-text-align-justify' ),
				),
				'default'   => 'flex-start',
				'selectors' => array( '{{WRAPPER}} .mizuki-book-wrap' => 'align-items: {{VALUE}};' ),
			)
		);

		$this->end_controls_section();

		$this->start_controls_section(
			'button_style',
			array(
				'label' => __( 'Button', 'mizuki-booking' ),
				'tab'   => \Elementor\Controls_Manager::TAB_STYLE,
			)
		);

		$this->add_group_control(
			\Elementor\Group_Control_Typography::get_type(),
			array( 'name' => 'button_font', 'selector' => '{{WRAPPER}} .mizuki-book-btn' )
		);

		$this->start_controls_tabs( 'button_states' );

		$this->start_controls_tab( 'button_normal', array( 'label' => __( 'Normal', 'mizuki-booking' ) ) );
		$this->add_control(
			'button_colour',
			array(
				'label'     => __( 'Text', 'mizuki-booking' ),
				'type'      => \Elementor\Controls_Manager::COLOR,
				'default'   => '#ffffff',
				'selectors' => array( '{{WRAPPER}} .mizuki-book-btn' => 'color: {{VALUE}};' ),
			)
		);
		$this->add_control(
			'button_background',
			array(
				'label'     => __( 'Background', 'mizuki-booking' ),
				'type'      => \Elementor\Controls_Manager::COLOR,
				'default'   => '#008197',
				'selectors' => array( '{{WRAPPER}} .mizuki-book-btn' => 'background-color: {{VALUE}};' ),
			)
		);
		$this->end_controls_tab();

		$this->start_controls_tab( 'button_hover', array( 'label' => __( 'Hovered', 'mizuki-booking' ) ) );
		$this->add_control(
			'button_colour_hover',
			array(
				'label'     => __( 'Text', 'mizuki-booking' ),
				'type'      => \Elementor\Controls_Manager::COLOR,
				'selectors' => array( '{{WRAPPER}} .mizuki-book-btn:hover, {{WRAPPER}} .mizuki-book-btn:focus-visible' => 'color: {{VALUE}};' ),
			)
		);
		$this->add_control(
			'button_background_hover',
			array(
				'label'     => __( 'Background', 'mizuki-booking' ),
				'type'      => \Elementor\Controls_Manager::COLOR,
				'selectors' => array( '{{WRAPPER}} .mizuki-book-btn:hover, {{WRAPPER}} .mizuki-book-btn:focus-visible' => 'background-color: {{VALUE}};' ),
			)
		);
		$this->end_controls_tab();

		$this->end_controls_tabs();

		$this->add_group_control(
			\Elementor\Group_Control_Border::get_type(),
			array( 'name' => 'button_border', 'selector' => '{{WRAPPER}} .mizuki-book-btn', 'separator' => 'before' )
		);

		$this->add_responsive_control(
			'button_radius',
			array(
				'label'      => __( 'Corners', 'mizuki-booking' ),
				'type'       => \Elementor\Controls_Manager::DIMENSIONS,
				'size_units' => array( 'px', '%' ),
				'selectors'  => array( '{{WRAPPER}} .mizuki-book-btn' => 'border-radius: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};' ),
			)
		);

		$this->add_responsive_control(
			'button_padding',
			array(
				'label'      => __( 'Padding', 'mizuki-booking' ),
				'type'       => \Elementor\Controls_Manager::DIMENSIONS,
				'size_units' => array( 'px', 'em' ),
				'default'    => array( 'top' => '16', 'right' => '32', 'bottom' => '16', 'left' => '32', 'unit' => 'px' ),
				'selectors'  => array( '{{WRAPPER}} .mizuki-book-btn' => 'padding: {{TOP}}{{UNIT}} {{RIGHT}}{{UNIT}} {{BOTTOM}}{{UNIT}} {{LEFT}}{{UNIT}};' ),
			)
		);

		$this->end_controls_section();
	}

	protected function render() {
		$settings = $this->get_settings_for_display();
		$target   = sanitize_title( $settings['target'] );
		$course   = mizuki_elementor_course_value( $settings );

		printf(
			'<div class="mizuki-book-wrap" style="display:flex;flex-direction:column"><a class="mizuki-book-btn" href="#%1$s" data-mizuki-book="1" data-target="%1$s"%2$s style="display:inline-block;text-align:center;text-decoration:none;cursor:pointer">%3$s</a></div>',
			esc_attr( $target ),
			$course ? ' data-course="' . esc_attr( $course ) . '"' : '',
			esc_html( $settings['label'] )
		);
	}
}
