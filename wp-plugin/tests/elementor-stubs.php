<?php
/* --- Elementor, enough of it ------------------------------------------------ */
namespace Elementor;

class Controls_Manager {
	const TEXT = 'text'; const TEXTAREA = 'textarea'; const SELECT = 'select';
	const COLOR = 'color'; const SWITCHER = 'switcher'; const CHOOSE = 'choose';
	const DIMENSIONS = 'dimensions'; const RAW_HTML = 'raw_html'; const SLIDER = 'slider';
	const TAB_STYLE = 'style'; const TAB_CONTENT = 'content';
	const MEDIA = 'media'; const WYSIWYG = 'wysiwyg'; const REPEATER = 'repeater'; const ICONS = 'icons';
}

/* Collects its fields and hands them back, which is all a widget asks of it. */
class Repeater {
	public $fields = array();
	public function add_control( $id, $args = array() ) { $this->fields[ $id ] = $args; }
	public function get_controls() { return $this->fields; }
}

class Icons_Manager {
	public static function render_icon( $icon, $attributes = array() ) {
		echo '<i class="' . htmlspecialchars( isset( $icon['value'] ) ? $icon['value'] : '' ) . '"></i>';
	}
}

class Utils {
	public static function get_placeholder_image_src() { return 'https://example.test/placeholder.png'; }
}
class Group_Control_Typography { public static function get_type() { return 'typography'; } }
class Group_Control_Border { public static function get_type() { return 'border'; } }

class Widget_Base {
	public $controls = array();
	/** What each control declared, so a test can render a widget with its own shipped defaults. */
	public $declared = array();
	public function __construct( $data = array(), $args = null ) {}
	public function get_name() { return ''; }
	/* Elementor gives every element on a page a short unique id; ours only needs to be stable. */
	public function get_id() { return 'e1a2b3c'; }
	public function get_title() { return ''; }
	public function get_icon() { return ''; }
	public function get_categories() { return array(); }
	public function get_keywords() { return array(); }
	public function get_script_depends() { return array(); }
	public function get_style_depends() { return array(); }
	protected function register_controls() {}
	protected function render() {}
	public function start_controls_section( $id, $args = array() ) {}
	public function end_controls_section() {}
	public function add_control( $id, $args = array() ) { $this->controls[] = $id; $this->declared[ $id ] = $args; }
	public function add_responsive_control( $id, $args = array() ) { $this->controls[] = $id; $this->declared[ $id ] = $args; }
	public function add_group_control( $type, $args = array() ) {}
	public function start_controls_tabs( $id ) {}
	public function end_controls_tabs() {}
	public function start_controls_tab( $id, $args = array() ) {}
	public function end_controls_tab() {}
	/* Overwritten with array() to stand in for a widget saved before a control existed. */
	public $settings = array( 'course' => 'ifda', 'course_custom' => '', 'view' => 'calendar', 'anchor' => 'book',
		'live_preview' => 'yes', 'heading' => 'Hi', 'intro' => 'There', 'label' => 'Book', 'target' => 'book' );
	public function get_settings_for_display( $key = null ) { return $this->settings; }
	public function run_controls() { $this->register_controls(); }

	/** The settings a freshly dropped widget would have: every control at its declared default. */
	public function run_defaults() {
		$this->register_controls();
		$defaults = array();
		foreach ( $this->declared as $id => $args ) {
			if ( array_key_exists( 'default', $args ) ) {
				$defaults[ $id ] = $args['default'];
			}
		}
		return $defaults;
	}
	public function run_render() { $this->render(); }
}

class Editor { public function is_edit_mode() { return false; } }
class Plugin { public static $instance; public $editor; public function __construct() { $this->editor = new Editor(); } }
