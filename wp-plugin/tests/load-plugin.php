<?php
/**
 * Load the plugin the way WordPress would, and see whether it falls over.
 *
 * There is no way to run WordPress here, so `wordpress-stubs.php` and `elementor-stubs.php` are
 * just enough of each to get the plugin's own code executing. That is not a substitute for trying
 * it on a real site — but a plugin that fatals takes down every page including wp-admin, so the
 * cheap check that would have caught it is worth having in front of the expensive one.
 *
 * Run it directly, or let `npm run build` run it while packaging:
 *
 *   php wp-plugin/tests/load-plugin.php
 */

require __DIR__ . '/wordpress-stubs.php';
require __DIR__ . '/elementor-stubs.php';

\Elementor\Plugin::$instance = new \Elementor\Plugin();

$plugin   = dirname( __DIR__ ) . '/mizuki-booking-bridge/mizuki-booking-bridge.php';
$failures = array();

function check( $label, callable $run ) {
	global $failures;
	try {
		$run();
		echo "  ok    $label\n";
	} catch ( \Throwable $error ) {
		$failures[] = $label;
		echo '  FAIL  ' . $label . ' -> ' . get_class( $error ) . ': ' . $error->getMessage() . "\n";
		echo '        ' . str_replace( "\n", "\n        ", $error->getTraceAsString() ) . "\n";
	}
}

echo "Loading the plugin\n";
check( 'the plugin file parses and runs', function () use ( $plugin ) { require $plugin; } );
check( 'plugins_loaded, with Elementor present', function () { do_action( 'plugins_loaded' ); } );

check( 'the widget classes exist', function () {
	foreach ( array( 'Mizuki_Elementor_Calendar', 'Mizuki_Elementor_Account', 'Mizuki_Elementor_Book_Button' ) as $class ) {
		if ( ! class_exists( $class ) ) {
			throw new RuntimeException( $class . ' was never declared' );
		}
	}
} );

echo "\nRegistering\n";
/*
 * The junk first, and that order is the whole point.
 *
 * These are hooked to a deprecated Elementor hook that anything on the site may fire, and
 * WordPress passes an empty string when a hook is fired with no arguments rather than passing
 * nothing — so both "too few arguments" and "call to a member function on string" are reachable.
 * Registering successfully first would set the registrar's own once-only flag and make every one
 * of these return before reaching the code being tested. Written the other way round, this file
 * passed with the fix taken back out.
 */
check( 'the deprecated hook, fired with nothing', function () { do_action( 'elementor/widgets/widgets_registered' ); } );
check( 'the deprecated hook, fired with an empty string', function () { do_action( 'elementor/widgets/widgets_registered', '' ); } );
check( 'the deprecated hook, fired with a number', function () { do_action( 'elementor/widgets/widgets_registered', 0 ); } );

check( 'a modern widgets manager', function () {
	$manager = new class { public $seen = array(); public function register( $w ) { $this->seen[] = get_class( $w ); } };
	do_action( 'elementor/widgets/register', $manager );
	if ( 3 !== count( $manager->seen ) ) {
		throw new RuntimeException( 'expected three widgets, registered ' . count( $manager->seen ) );
	}
} );

echo "\nBuilding every control panel\n";
foreach ( array( 'Mizuki_Elementor_Calendar', 'Mizuki_Elementor_Account', 'Mizuki_Elementor_Book_Button' ) as $class ) {
	check( $class, function () use ( $class ) {
		$widget = new $class();
		$widget->run_controls();
		if ( count( $widget->controls ) < 3 ) {
			throw new RuntimeException( 'only ' . count( $widget->controls ) . ' controls' );
		}
	} );
}

echo "\nDrawing, in every state that has bitten us\n";
$states = array(
	'on a page'              => array(),
	'in the Elementor editor' => array( 'editing' => true ),
	'booking system down'     => array( 'api_down' => true ),
	'no address configured'   => array( 'no_api' => true ),
);

foreach ( $states as $label => $world ) {
	check( $label, function () use ( $world ) {
		$GLOBALS['api_down'] = ! empty( $world['api_down'] );
		$GLOBALS['no_api']   = ! empty( $world['no_api'] );
		\Elementor\Plugin::$instance->editor = new class( ! empty( $world['editing'] ) ) {
			private $editing;
			public function __construct( $editing ) { $this->editing = $editing; }
			public function is_edit_mode() { return $this->editing; }
		};

		foreach ( array( 'Mizuki_Elementor_Calendar', 'Mizuki_Elementor_Account', 'Mizuki_Elementor_Book_Button' ) as $class ) {
			$widget = new $class();
			ob_start();
			$widget->run_render();
			ob_get_clean();
		}
	} );
}

echo "\n";
if ( $failures ) {
	echo count( $failures ) . " failure(s): " . implode( '; ', $failures ) . "\n";
	exit( 1 );
}
echo "The plugin loads, registers, builds its panels and draws without fataling.\n";
