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

step( 'all five widgets register', function () {
	$manager = manager();
	do_action( 'elementor/widgets/register', $manager );
	if ( 5 !== count( $manager->widgets ) ) {
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
		'data-bare="1"'             => 'the booking block dropping its own heading',
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

	// Two pieces is an even count, so nothing takes a whole row.
	if ( false !== strpos( $html, 'mzk-ifda-projects__item--wide' ) ) {
		throw new RuntimeException( 'an even list still widened its last item' );
	}
	if ( false === strpos( $html, '>01<' ) || false === strpos( $html, '>02<' ) ) {
		throw new RuntimeException( 'the pieces are not numbered from one' );
	}

	return 'blank lines dropped, numbering starts at 01';
} );

step( 'both course lists are drawn the same way', function () {
	$widget           = new Mizuki_Elementor_IFDA_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	/*
	 * The seven pieces and the thirteen used to be two different designs — cards for the short
	 * list, rows for the long one — which made the two tabs look like two pages.
	 */
	if ( 2 !== substr_count( $html, 'class="mzk-ifda-projects__list"' ) ) {
		throw new RuntimeException( 'the two lists are not built from the same markup' );
	}

	// Seven and thirteen are both odd, so each list ends with one across the full row.
	if ( 2 !== substr_count( $html, 'mzk-ifda-projects__item--wide' ) ) {
		throw new RuntimeException( 'an odd list did not widen its last item' );
	}

	return 'one list style, both tabs';
} );


echo "\nThe Ikebana page, with the content it ships with\n";

step( 'it draws every section', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	$wanted = array(
		'mzk-ike-hero'            => 'the hero',
		'mzk-ike-intro'           => 'the introduction',
		'mzk-ike-intro__accent'   => 'the italic second line',
		'mzk-ike-workshops'       => 'the workshops',
		'mzk-ike-slider__track'   => 'the slider',
		'mzk-ike-card'            => 'the workshop cards',
		'mzk-ike-slider__dot'     => 'the slider dots',
		'mzk-ike-slider__prev'    => 'the slider arrows',
		'mzk-ike-featured'        => 'the featured course',
		'mzk-ike-facts'           => 'the course details',
		'mzk-ike-benefits'        => 'what is included',
		'mzk-ike-gallery__grid'   => 'the gallery',
		'mzk-ike-gallery__item'   => 'the gallery pictures',
		'mzk-ike-lightbox'        => 'the lightbox',
		'id="workshops"'          => 'the anchor the hero button scrolls to',
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

/*
 * The switches are the point of this widget, so each one is exercised on its own. Turning a
 * section off must remove that section and leave the other five alone — an off switch that also
 * silences its neighbour is worse than no switch.
 */
step( 'every section can be turned off on its own', function () {
	$sections = array(
		'hero_show'      => 'mzk-ike-hero',
		'intro_show'     => 'mzk-ike-intro',
		'workshops_show' => 'mzk-ike-workshops',
		'featured_show'  => 'mzk-ike-featured',
		'benefits_show'  => 'mzk-ike-benefits',
		'gallery_show'   => 'mzk-ike-gallery',
	);

	foreach ( $sections as $switch => $marker ) {
		Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$widget           = new Mizuki_Elementor_Ikebana_Page();
		$widget->settings = array_merge( $widget->run_defaults(), array( $switch => '' ) );

		ob_start();
		$widget->run_render();
		$html = ob_get_clean();

		if ( false !== strpos( $html, $marker ) ) {
			throw new RuntimeException( $switch . ' was off and ' . $marker . ' was drawn anyway' );
		}

		foreach ( $sections as $other => $otherMarker ) {
			if ( $other === $switch ) {
				continue;
			}
			if ( false === strpos( $html, $otherMarker ) ) {
				throw new RuntimeException( $switch . ' was off and it took ' . $otherMarker . ' with it' );
			}
		}
	}

	return count( $sections ) . ' switches, each independent';
} );

step( 'all six off draws nothing but the wrapper', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'hero_show' => '', 'intro_show' => '', 'workshops_show' => '',
		'featured_show' => '', 'benefits_show' => '', 'gallery_show' => '',
	) );

	ob_start();
	$widget->run_render();
	$html = trim( ob_get_clean() );

	if ( '<div class="mzk-ike"></div>' !== $html ) {
		throw new RuntimeException( 'left something behind: ' . substr( $html, 0, 120 ) );
	}

	return 'an empty wrapper, no stray markup';
} );

step( 'the lightbox can be turned off without losing the pictures', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'gallery_lightbox' => '' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false !== strpos( $html, 'mzk-ike-lightbox' ) ) {
		throw new RuntimeException( 'the lightbox was drawn anyway' );
	}
	if ( false === strpos( $html, 'mzk-ike-gallery__item' ) ) {
		throw new RuntimeException( 'the pictures went with it' );
	}
	/* No button, because nothing happens when it is pressed. */
	if ( false !== strpos( $html, '<button type="button" class="mzk-ike-gallery__item' ) ) {
		throw new RuntimeException( 'a picture that opens nothing is still a button' );
	}

	return 'pictures kept, lightbox gone';
} );

step( 'one workshop draws no slider controls', function () {
	$defaults = ( new Mizuki_Elementor_Ikebana_Page() )->run_defaults();

	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = array_merge( $defaults, array( 'workshops' => array_slice( $defaults['workshops'], 0, 1 ) ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	// Arrows and dots for a list of one are controls that do nothing.
	foreach ( array( 'mzk-ike-slider__dot', 'mzk-ike-slider__prev' ) as $needle ) {
		if ( false !== strpos( $html, $needle ) ) {
			throw new RuntimeException( $needle . ' drawn for a single workshop' );
		}
	}
	if ( false === strpos( $html, 'mzk-ike-card' ) ) {
		throw new RuntimeException( 'the one workshop was not drawn' );
	}

	return 'the card, and nothing to scroll it with';
} );

step( 'each detail row carries its own icon', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$defaults = ( new Mizuki_Elementor_Ikebana_Page() )->run_defaults();

	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = $defaults;

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	/*
	 * The first card ships three rows with three different icons. One icon repeated down the card
	 * is what this replaced, so the test is that they differ, not merely that they exist.
	 */
	if ( ! preg_match( '/<ul class="mzk-ike-card__facts">(.*?)<\/ul>/s', $html, $match ) ) {
		throw new RuntimeException( 'no detail list drawn' );
	}

	preg_match_all( '/class="[^"]*(fa-[a-z-]+)[^"]*"/', $match[1], $icons );
	$found = array_values( array_unique( array_filter( $icons[1], function ( $name ) {
		return 'fa-regular' !== $name && 'fa-solid' !== $name;
	} ) ) );

	if ( count( $found ) < 3 ) {
		throw new RuntimeException( 'the rows share icons: ' . implode( ', ', $found ) );
	}

	return implode( ', ', $found );
} );

/*
 * The words already typed into the widget as it first shipped must survive the panel changing
 * shape. Elementor keeps the settings of controls that no longer exist, so the only way to lose
 * them is to stop reading them.
 */
step( 'a card written before the per-row icons still draws', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$defaults = ( new Mizuki_Elementor_Ikebana_Page() )->run_defaults();
	$cards    = $defaults['workshops'];

	// As the old panel saved it: one icon, and the rows as text — typed with stray blank lines.
	foreach ( array( 1, 2, 3, 4, 5 ) as $row ) {
		unset( $cards[0][ 'detail_' . $row . '_text' ], $cards[0][ 'detail_' . $row . '_icon' ] );
	}
	$cards[0]['facts'] = "  2.5 Hours  \n\n\n  Small Group  \n";
	$cards[0]['icon']  = array( 'value' => 'fas fa-leaf', 'library' => 'fa-solid' );

	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = array_merge( $defaults, array( 'workshops' => $cards ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false === strpos( $html, '>2.5 Hours<' ) || false === strpos( $html, '>Small Group<' ) ) {
		throw new RuntimeException( 'the old rows were dropped' );
	}
	if ( false !== strpos( $html, '<span></span>' ) ) {
		throw new RuntimeException( 'a blank line became an empty row' );
	}

	return 'old rows kept, blank lines dropped, spacing trimmed';
} );

step( 'the lightbox is drawn once even with two galleries', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$first            = new Mizuki_Elementor_Ikebana_Page();
	$first->settings  = $first->run_defaults();
	$second           = new Mizuki_Elementor_Ikebana_Page();
	$second->settings = $second->run_defaults();

	ob_start();
	$first->run_render();
	$second->run_render();
	$html = ob_get_clean();

	$count = substr_count( $html, 'id="mzk-ike-lightbox"' );
	if ( 1 !== $count ) {
		throw new RuntimeException( 'drew it ' . $count . ' times — duplicate ids' );
	}

	return 'one dialog, one id';
} );


/*
 * The gap that let the above through.
 *
 * A WordPress function the plugin calls and this harness does not define is not an error here:
 * the widget catches it, logs it, and draws nothing, which is exactly what containment is for
 * and exactly what makes it invisible. Checked in the source instead.
 */
step( 'the harness defines every WordPress function the plugin calls', function () {
	$plugin = dirname( __DIR__ ) . '/mizuki-booking-bridge';
	$files  = array_merge(
		glob( $plugin . '/*.php' ),
		glob( $plugin . '/includes/*.php' )
	);

	$called = array();
	foreach ( $files as $file ) {
		/* (?<![>:$\w]) keeps method calls out: $this->add_control() and $order->get_total() are
		   not WordPress functions and stubbing them would be nonsense. */
		preg_match_all(
			'/(?<![>:$\w])\b(esc_[a-z_]+|wp_[a-z_]+|sanitize_[a-z_]+|tag_escape|absint|apply_filters|untrailingslashit|trailingslashit|selected|checked|get_post_meta|get_option|get_bloginfo|get_transient|set_transient|current_user_can|plugin_dir_path|plugin_dir_url|did_action|add_action|add_filter|add_shortcode|home_url|admin_url)\s*\(/',
			file_get_contents( $file ),
			$matches
		);
		foreach ( $matches[1] as $name ) {
			$called[ $name ] = true;
		}
	}

	$missing = array();
	foreach ( array_keys( $called ) as $name ) {
		if ( ! function_exists( $name ) ) {
			$missing[] = $name;
		}
	}

	sort( $missing );

	if ( $missing ) {
		throw new RuntimeException( 'not stubbed: ' . implode( ', ', $missing ) );
	}

	return count( $called ) . ' functions, all present';
} );


/*
 * The slider's controls must sit inside the slider.
 *
 * The script finds which slider to scroll by walking up from whatever was clicked. The arrows
 * shipped rendered outside the wrapper, one level up in the section heading, so every press did
 * nothing at all — no error, no console warning, just a dead button. Nothing that reads the HTML
 * as text catches that, so this walks the tree.
 */
step( 'the slider controls are inside the slider', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	$document = new DOMDocument();
	libxml_use_internal_errors( true );
	$document->loadHTML( '<?xml encoding="UTF-8">' . $html );
	libxml_clear_errors();

	$xpath = new DOMXPath( $document );

	foreach ( array( 'mzk-ike-slider__prev', 'mzk-ike-slider__next', 'mzk-ike-slider__dot', 'mzk-ike-slider__track' ) as $part ) {
		$nodes = $xpath->query( '//*[contains(@class, "' . $part . '")]' );
		if ( ! $nodes->length ) {
			throw new RuntimeException( $part . ' was not drawn at all' );
		}

		$node   = $nodes->item( 0 );
		$inside = false;

		for ( $parent = $node->parentNode; $parent instanceof DOMElement; $parent = $parent->parentNode ) {
			$classes = explode( ' ', (string) $parent->getAttribute( 'class' ) );
			if ( in_array( 'mzk-ike-slider', $classes, true ) ) {
				$inside = true;
				break;
			}
		}

		if ( ! $inside ) {
			throw new RuntimeException( $part . ' is outside .mzk-ike-slider, so the script cannot reach it' );
		}
	}

	return 'arrows, dots and track all within the wrapper';
} );

/* Same walk for the gallery: a picture the script cannot find its grid from opens nothing. */
step( 'every gallery picture is inside its grid', function () {
	Mizuki_Elementor_Ikebana_Page::$lightbox_drawn = false;
	$widget           = new Mizuki_Elementor_Ikebana_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	$document = new DOMDocument();
	libxml_use_internal_errors( true );
	$document->loadHTML( '<?xml encoding="UTF-8">' . $html );
	libxml_clear_errors();

	$xpath = new DOMXPath( $document );
	$items = $xpath->query( '//*[contains(@class, "mzk-ike-gallery__item")]' );

	if ( ! $items->length ) {
		throw new RuntimeException( 'no pictures drawn' );
	}

	foreach ( $items as $item ) {
		$inside = false;
		for ( $parent = $item->parentNode; $parent instanceof DOMElement; $parent = $parent->parentNode ) {
			if ( false !== strpos( (string) $parent->getAttribute( 'class' ), 'mzk-ike-gallery__grid' ) ) {
				$inside = true;
				break;
			}
		}
		if ( ! $inside ) {
			throw new RuntimeException( 'a picture is outside the grid' );
		}
	}

	return $items->length . ' pictures, all inside the grid';
} );

echo "\n";
if ( $fail ) {
	echo $fail . " failure(s).\n";
	exit( 1 );
}
echo "The plugin loads, waits for Elementor, registers, builds its panels and draws — no fatal.\n";
