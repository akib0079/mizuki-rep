<?php
/* --- Elementor, enough of it ------------------------------------------------ */
namespace Elementor;

class Controls_Manager {
	const TEXT = 'text'; const TEXTAREA = 'textarea'; const SELECT = 'select';
	const COLOR = 'color'; const SWITCHER = 'switcher'; const CHOOSE = 'choose';
	const DIMENSIONS = 'dimensions'; const RAW_HTML = 'raw_html'; const SLIDER = 'slider';
	const TAB_STYLE = 'style'; const TAB_CONTENT = 'content';
}
class Group_Control_Typography { public static function get_type() { return 'typography'; } }
class Group_Control_Border { public static function get_type() { return 'border'; } }

class Widget_Base {
	public $controls = array();
	public function __construct( $data = array(), $args = null ) {}
	public function get_name() { return ''; }
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
	public function add_control( $id, $args = array() ) { $this->controls[] = $id; }
	public function add_responsive_control( $id, $args = array() ) { $this->controls[] = $id; }
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
	public function run_render() { $this->render(); }
}

class Editor { public function is_edit_mode() { return false; } }
class Plugin { public static $instance; public $editor; public function __construct() { $this->editor = new Editor(); } }
