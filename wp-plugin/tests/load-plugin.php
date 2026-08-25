<?php
/**
 * Load the plugin the way WordPress does, in the order WordPress does it.
 *
 * The order is the point. A WordPress plugin that fatals does not lose a feature — it serves a
 * white page on every URL of the site, wp-admin included, and a file manager is the only way back
 * in. That has happened here once, and the cause was timing: the widget classes extend classes
 * that belong to Elementor, and they were being read at `plugins_loaded`, which is after
 * Elementor announces itself and before its autoloader can resolve anything.
 *
 * So this file keeps Elementor out of the room until the moment Elementor would really be there.
 * A harness that defines Elementor up front cannot see that bug at all, which is exactly what the
 * first version of this file did.
 *
 * These stubs are not a substitute for a real site; they are the cheap check that runs on every
 * build, in front of the expensive one.
 *
 *   php wp-plugin/tests/load-plugin.php
 */

require __DIR__ . '/wordpress-stubs.php';

$fail   = 0;
$plugin = dirname( __DIR__ ) . '/mizuki-booking-bridge/mizuki-booking-bridge.php';

function step( $label, callable $run ) {
	global $fail;
	try {
		$note = $run();
		echo '  ok    ' . $label . ( $note ? ' — ' . $note : '' ) . "\n";
	} catch ( \Throwable $error ) {
		$fail++;
		echo '  FAIL  ' . $label . ' -> ' . get_class( $error ) . ': ' . $error->getMessage() . "\n";
		echo '        ' . $error->getFile() . ':' . $error->getLine() . "\n";
	}
}

function manager() {
	return new class {
		public $widgets    = array();
		public $categories = array();
		public function register( $widget ) { $this->widgets[] = $widget->get_name(); }
		public function add_category( $slug, $args ) { $this->categories[] = $slug; }
	};
}

echo "WordPress starts, and Elementor is not ready yet\n";

step( 'the plugin file parses and runs', function () use ( $plugin ) { require $plugin; } );
step( 'plugins_loaded', function () { do_action( 'plugins_loaded' ); } );

/*
 * The regression guard for the outage. Nothing that mentions an Elementor class may have been
 * read yet — at this point in a real request `Elementor\Widget_Base` cannot be resolved, and a
 * class that fails to declare turns the next line that names it into a fatal.
 */
step( 'nothing that needs Elementor has been touched', function () {
	foreach ( array( 'Mizuki_Elementor_Calendar', 'Mizuki_Elementor_Account', 'Mizuki_Elementor_Book_Button', 'Mizuki_Elementor_IFDA_Page' ) as $class ) {
		if ( class_exists( $class, false ) ) {
			throw new RuntimeException( $class . ' was declared at plugins_loaded, which is too early' );
		}
	}
	if ( function_exists( 'mizuki_elementor_widget_instances' ) ) {
		throw new RuntimeException( 'includes/elementor.php was read at plugins_loaded, which is too early' );
	}
	return 'the widget file is still unread';
} );

echo "\nElementor becomes ready, and starts asking\n";
require __DIR__ . '/elementor-stubs.php';
\Elementor\Plugin::$instance = new \Elementor\Plugin();

/*
 * The junk before the real thing, and that order matters: registering successfully first sets the
 * registrar's once-only flag, and every check below it would then return before reaching the code
 * being tested. Written the other way round, this file passed with the fix taken back out.
 *
 * WordPress passes an empty string when a hook is fired with no arguments rather than passing
 * nothing, so both "too few arguments" and "call to a member function on string" are reachable.
 * The second widget hook is deprecated, and anything on the site may fire it.
 */
step( 'categories_registered, fired with nothing', function () { do_action( 'elementor/elements/categories_registered' ); } );
step( 'the deprecated widget hook, fired with nothing', function () { do_action( 'elementor/widgets/widgets_registered' ); } );
step( 'the deprecated widget hook, fired with an empty string', function () { do_action( 'elementor/widgets/widgets_registered', '' ); } );
step( 'the deprecated widget hook, fired with a number', function () { do_action( 'elementor/widgets/widgets_registered', 0 ); } );

step( 'the category is added', function () {
	$manager = manager();
	do_action( 'elementor/elements/categories_registered', $manager );
	if ( ! in_array( 'mizuki', $manager->categories, true ) ) {
		throw new RuntimeException( 'no mizuki category' );
	}
	return implode( ', ', $manager->categories );
} );

step( 'all four widgets register', function () {
	$manager = manager();
	do_action( 'elementor/widgets/register', $manager );
	if ( 4 !== count( $manager->widgets ) ) {
		throw new RuntimeException( 'registered ' . count( $manager->widgets ) . ': ' . implode( ',', $manager->widgets ) );
	}
	return implode( ', ', $manager->widgets );
} );

step( 'registering twice does not register twice', function () {
	$manager = manager();
	do_action( 'elementor/widgets/register', $manager );
	if ( 0 !== count( $manager->widgets ) ) {
		throw new RuntimeException( 'registered again: ' . implode( ',', $manager->widgets ) );
	}
	return 'the once-only flag holds';
} );

echo "\nEvery control panel builds\n";
foreach ( array( 'Mizuki_Elementor_Calendar', 'Mizuki_Elementor_Account', 'Mizuki_Elementor_Book_Button', 'Mizuki_Elementor_IFDA_Page' ) as $class ) {
	step( $class, function () use ( $class ) {
		$widget = new $class();
		$widget->run_controls();
		if ( count( $widget->controls ) < 3 ) {
			throw new RuntimeException( 'only ' . count( $widget->controls ) . ' controls' );
		}
		return count( $widget->controls ) . ' controls';
	} );
}

echo "\nDrawing, in every state that has bitten us\n";
$states = array(
	'on a page'               => array(),
	'in the Elementor editor' => array( 'editing' => true ),
	'booking system down'     => array( 'api_down' => true ),
	'no address configured'   => array( 'no_api' => true ),
	/* A page built on an older version, saved before half these controls existed. */
	'an old saved instance'   => array( 'no_settings' => true ),
);

foreach ( $states as $label => $world ) {
	step( $label, function () use ( $world ) {
		$GLOBALS['api_down'] = ! empty( $world['api_down'] );
		$GLOBALS['no_api']   = ! empty( $world['no_api'] );

		\Elementor\Plugin::$instance->editor = new class( ! empty( $world['editing'] ) ) {
			private $editing;
			public function __construct( $editing ) { $this->editing = $editing; }
			public function is_edit_mode() { return $this->editing; }
		};

		foreach ( array( 'Mizuki_Elementor_Calendar', 'Mizuki_Elementor_Account', 'Mizuki_Elementor_Book_Button', 'Mizuki_Elementor_IFDA_Page' ) as $class ) {
			$widget = new $class();
			if ( ! empty( $world['no_settings'] ) ) {
				$widget->settings = array();
			}
			ob_start();
			$widget->run_render();
			ob_get_clean();
		}
	} );
}

echo "\nThe IFDA page, with the content it ships with\n";
step( 'it draws every section', function () {
	$widget           = new Mizuki_Elementor_IFDA_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	/*
	 * Checked by what reaches the page rather than by length, because the failure that matters
	 * here is a section quietly drawing nothing — a settings key renamed, a repeater read under
	 * the wrong name. That produces a shorter page, not an error.
	 */
	$wanted = array(
		'mzk-ifda-hero'      => 'the hero',
		'mzk-ifda-about'     => 'about IFDA',
		'mzk-ifda-cert__card'=> 'the certification cards',
		'mzk-ifda-tab'       => 'the course tabs',
		'mzk-ifda-learn'     => 'what you will learn',
		'mzk-ifda-projects'  => 'the pieces',
		'mzk-ifda-callout'   => 'the note',
		'mzk-ifda-booking'   => 'the booking block',
		'mizuki-book'        => 'a button wired to the calendar',
		'data-course="ifda"'        => 'the calendar opening on IFDA rather than everything',
	);

	$missing = array();
	foreach ( $wanted as $needle => $label ) {
		if ( false === strpos( $html, $needle ) ) {
			$missing[] = $label;
		}
	}

	if ( $missing ) {
		throw new RuntimeException( 'nothing drawn for: ' . implode( ', ', $missing ) );
	}

	return strlen( $html ) . ' bytes, every section present';
} );

step( 'both courses are on the page, not just the open one', function () {
	$widget           = new Mizuki_Elementor_IFDA_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	// The closed tab is hidden, not absent — otherwise find-in-page and a reader with the script
	// blocked never see half the page.
	if ( 2 !== substr_count( $html, 'role="tabpanel"' ) ) {
		throw new RuntimeException( 'expected two panels in the markup' );
	}
	if ( false === strpos( $html, 'Beginner Course' ) || false === strpos( $html, 'Master Course' ) ) {
		throw new RuntimeException( 'a course is missing from the markup' );
	}

	return 'both panels present, one hidden';
} );

step( 'every list item survives being typed with stray blank lines', function () {
	$widget   = new Mizuki_Elementor_IFDA_Page();
	$defaults = $widget->run_defaults();

	// One course, so what is counted below can only have come from the lines under test.
	$defaults['courses'] = array( $defaults['courses'][0] );
	$defaults['courses'][0]['learn_items']    = "  One  \n\n\n  Two  \n";
	$defaults['courses'][0]['projects_items'] = "\nAlpha\n\nBeta\n\n";
	$widget->settings = $defaults;

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( 2 !== substr_count( $html, '<li><span>' ) ) {
		throw new RuntimeException( 'expected two list items, got ' . substr_count( $html, '<li><span>' ) );
	}
	if ( 2 !== substr_count( $html, 'mzk-ifda-projects__n' ) ) {
		throw new RuntimeException( 'expected two pieces, got ' . substr_count( $html, 'mzk-ifda-projects__n' ) );
	}
	// A single course is a heading, not a control, so no tab list is drawn for it.
	if ( false !== strpos( $html, 'mzk-ifda-tab' ) ) {
		throw new RuntimeException( 'a lone course still drew a tab' );
	}
	if ( false === strpos( $html, '>01<' ) || false === strpos( $html, '>02<' ) ) {
		throw new RuntimeException( 'the pieces are not numbered from one' );
	}

	return 'blank lines dropped, numbering starts at 01';
} );

echo "\n";
if ( $fail ) {
	echo $fail . " failure(s).\n";
	exit( 1 );
}
echo "The plugin loads, waits for Elementor, registers, builds its panels and draws — no fatal.\n";
