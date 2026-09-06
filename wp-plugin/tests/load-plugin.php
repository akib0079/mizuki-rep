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

step( 'all eight widgets register', function () {
	$manager = manager();
	do_action( 'elementor/widgets/register', $manager );
	if ( 8 !== count( $manager->widgets ) ) {
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
			'/(?<![>:$\w])\b(esc_[a-z_]+|wp_[a-z_]+|sanitize_[a-z_]+|tag_escape|absint|apply_filters|untrailingslashit|trailingslashit|selected|checked|get_post_meta|get_post_status|get_option|get_transient|set_transient|delete_transient|get_bloginfo|current_user_can|plugin_dir_path|plugin_dir_url|did_action|add_action|add_filter|add_shortcode|home_url|admin_url|get_the_terms|get_term_link|is_wp_error|_n)\s*\(/',
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


echo "\nThe product page, with no WooCommerce at all\n";

/*
 * The order here is the point. WooCommerce is not loaded yet, so this is the page a site sees for
 * the ten minutes somebody has the plugin switched off — and a widget that fatals then takes
 * every URL on the site with it, wp-admin included.
 */
step( 'it draws without WooCommerce', function () {
	if ( function_exists( 'wc_get_product' ) ) {
		throw new RuntimeException( 'WooCommerce was loaded too early for this to prove anything' );
	}

	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	// The writing is all still there; only what WooCommerce owns is missing.
	foreach ( array( 'mzk-pdp-crumbs', 'mzk-pdp-hero', 'mzk-pdp-routine', 'mzk-pdp-extract', 'mzk-pdp-ritual', 'mzk-pdp-about', 'mzk-pdp-faq' ) as $needed ) {
		if ( false === strpos( $html, $needed ) ) {
			throw new RuntimeException( $needed . ' was not drawn' );
		}
	}

	foreach ( array( 'mzk-pdp-buy', 'mzk-pdp-hero__price', 'mzk-pdp-hero__meta', 'mzk-pdp-sticky' ) as $absent ) {
		if ( false !== strpos( $html, $absent ) ) {
			throw new RuntimeException( $absent . ' was drawn with no product behind it' );
		}
	}

	return strlen( $html ) . ' bytes, and nothing that needs a shop';
} );

step( 'every section can be turned off on its own', function () {
	$sections = array(
		'crumbs_show'  => 'mzk-pdp-crumbs',
		'hero_show'    => 'mzk-pdp-hero',
		'routine_show' => 'mzk-pdp-routine',
		'extract_show' => 'mzk-pdp-extract',
		'ritual_show'  => 'mzk-pdp-ritual',
		'about_show'   => 'mzk-pdp-about',
		'faq_show'     => 'mzk-pdp-faq',
	);

	foreach ( $sections as $switch => $marker ) {
		$widget           = new Mizuki_Elementor_Product_Page();
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

step( 'all of them off draws nothing but the wrapper', function () {
	$off = array();
	foreach ( array( 'crumbs', 'hero', 'routine', 'extract', 'ritual', 'about', 'more', 'faq', 'sticky' ) as $section ) {
		$off[ $section . '_show' ] = '';
	}

	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), $off );

	ob_start();
	$widget->run_render();
	$html = trim( ob_get_clean() );

	if ( '<div class="mzk-pdp"></div>' !== $html ) {
		throw new RuntimeException( 'left something behind: ' . substr( $html, 0, 140 ) );
	}

	return 'an empty wrapper, no stray markup';
} );

echo "\nThe product page, with WooCommerce\n";

require __DIR__ . '/woocommerce-stubs.php';

$GLOBALS['mzk_products'] = array(
	13 => new WC_Product( 13, 'Naturepresso Box Set', 'S$268.00' ),
	14 => new WC_Product( 14, 'Pure Rose Water Mist', 'S$68.00' ),
	15 => new WC_Product( 15, 'Facial Collagen Serum', 'S$98.00' ),
);
$GLOBALS['mzk_terms'] = array(
	(object) array( 'name' => 'Naturepresso', 'slug' => 'naturepresso' ),
	(object) array( 'name' => 'Skin Care', 'slug' => 'skin-care' ),
);

step( 'the price, the categories and the buy form all come from the product', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	$wanted = array(
		'S$268.00'                     => 'the price',
		'name="add-to-cart" value="13"' => 'the add-to-cart field',
		'name="quantity"'              => 'the quantity field',
		'>Naturepresso<'               => 'the first category',
		'>Skin Care<'                  => 'the second category',
		'Naturepresso Box Set'         => 'the product name',
	);

	$missing = array();
	foreach ( $wanted as $needle => $label ) {
		if ( false === strpos( $html, $needle ) ) {
			$missing[] = $label;
		}
	}

	if ( $missing ) {
		throw new RuntimeException( 'not drawn: ' . implode( ', ', $missing ) );
	}

	return 'price, categories, quantity and add-to-cart';
} );

/*
 * The form posts to WooCommerce's own handler rather than doing the adding itself. Anything
 * hand-rolled skips the stock check, the validation and every hook an extension relies on.
 */
step( 'the buy form posts what WooCommerce listens for', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( ! preg_match( '/<form class="mzk-pdp-buy" method="post"/', $html ) ) {
		throw new RuntimeException( 'not a POST form' );
	}
	if ( ! preg_match( '/name="add-to-cart" value="13"/', $html ) ) {
		throw new RuntimeException( 'no add-to-cart field' );
	}

	return 'a real form post, not a hand-rolled request';
} );

step( 'a product that cannot be bought offers no button', function () {
	$GLOBALS['mzk_products'][13]->in_stock = false;

	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	$GLOBALS['mzk_products'][13]->in_stock = true;

	if ( false !== strpos( $html, 'name="add-to-cart"' ) ) {
		throw new RuntimeException( 'an out-of-stock product still offered a button' );
	}
	if ( false === strpos( $html, 'Currently unavailable' ) ) {
		throw new RuntimeException( 'it said nothing at all instead' );
	}
	if ( false !== strpos( $html, 'mzk-pdp-sticky' ) ) {
		throw new RuntimeException( 'the phone bar offered one anyway' );
	}

	return 'no button, and it says why';
} );

step( 'the breadcrumb trail ends with the product', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( ! preg_match( '/aria-current="page">Naturepresso Box Set</', $html ) ) {
		throw new RuntimeException( 'the trail did not end with the product name' );
	}

	// And a hand-written last step wins over it.
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13', 'crumbs_last_text' => 'The Box' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( ! preg_match( '/aria-current="page">The Box</', $html ) ) {
		throw new RuntimeException( 'a hand-written last step was ignored' );
	}

	return 'the product name, unless one is written';
} );

echo "\nMore products only when there are some\n";

step( 'no products chosen means no section', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false !== strpos( $html, 'mzk-pdp-more' ) ) {
		throw new RuntimeException( 'an empty section was drawn' );
	}

	return 'nothing drawn, not an empty heading';
} );

step( 'a row pointing at a product that has gone is skipped', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'product_id' => '13',
		'more_items' => array(
			array( 'product' => '14', 'label' => '', 'image' => array( 'url' => '' ) ),
			array( 'product' => '999', 'label' => '', 'image' => array( 'url' => '' ) ),
		),
	) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( 1 !== substr_count( $html, 'mzk-pdp-more__item' ) ) {
		throw new RuntimeException( 'drew ' . substr_count( $html, 'mzk-pdp-more__item' ) . ' items for one live product' );
	}
	if ( false === strpos( $html, 'Pure Rose Water Mist' ) ) {
		throw new RuntimeException( 'the live product was not drawn' );
	}

	return 'the deleted one skipped, the live one kept';
} );

step( 'every chosen row that resolves is drawn', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'product_id' => '13',
		'more_items' => array(
			array( 'product' => '14', 'label' => 'Hydrating Pre-Step', 'image' => array( 'url' => '' ) ),
			array( 'product' => '15', 'label' => '', 'image' => array( 'url' => '' ), 'show_price' => 'yes' ),
		),
	) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( 2 !== substr_count( $html, 'mzk-pdp-more__item' ) ) {
		throw new RuntimeException( 'expected two items' );
	}
	if ( false === strpos( $html, 'Hydrating Pre-Step' ) ) {
		throw new RuntimeException( 'the written label was dropped' );
	}
	// An empty label falls back to the product's first category.
	if ( false === strpos( $html, '>Naturepresso<' ) ) {
		throw new RuntimeException( 'an empty label did not fall back to the category' );
	}
	if ( false === strpos( $html, 'S$98.00' ) ) {
		throw new RuntimeException( 'the price was asked for and not drawn' );
	}

	return 'two items, labels and price as asked';
} );

step( 'the gallery falls back to the product’s own pictures', function () {
	$GLOBALS['mzk_products'][13]->image_id = 41;
	$GLOBALS['mzk_products'][13]->gallery  = array( 42, 43 );

	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13', 'hero_gallery' => array() ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	foreach ( array( 'img-41.jpg', 'img-42.jpg', 'img-43.jpg' ) as $picture ) {
		if ( false === strpos( $html, $picture ) ) {
			throw new RuntimeException( $picture . ' was not used' );
		}
	}

	return 'the main image and both gallery pictures';
} );

step( 'a gallery chosen in Elementor wins over the product’s', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false !== strpos( $html, 'img-41.jpg' ) ) {
		throw new RuntimeException( 'the product’s pictures were used instead of the chosen ones' );
	}
	if ( false === strpos( $html, 'IMG_8761' ) ) {
		throw new RuntimeException( 'the chosen pictures were not drawn' );
	}

	$GLOBALS['mzk_products'][13]->image_id = 0;
	$GLOBALS['mzk_products'][13]->gallery  = array();

	return 'what was chosen, not what the shop has';
} );


echo "\nThe Mizuki Picks page\n";

step( 'it draws every section that does not need a shop', function () {
	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	foreach ( array( 'mzk-pk-banner', 'mzk-pk-intro', 'mzk-pk-featured', 'mzk-pk-why', 'mzk-pk-faq' ) as $needed ) {
		if ( false === strpos( $html, $needed ) ) {
			throw new RuntimeException( $needed . ' was not drawn' );
		}
	}

	/* No products chosen, so no rail — not an empty heading over nothing. */
	if ( false !== strpos( $html, 'mzk-pk-picks' ) ) {
		throw new RuntimeException( 'the picks section was drawn with no products' );
	}

	return strlen( $html ) . ' bytes';
} );

step( 'every section can be turned off on its own', function () {
	$sections = array(
		'banner_show'   => 'mzk-pk-banner',
		'intro_show'    => 'mzk-pk-intro',
		'featured_show' => 'mzk-pk-featured',
		'why_show'      => 'mzk-pk-why',
		'faq_show'      => 'mzk-pk-faq',
	);

	foreach ( $sections as $switch => $marker ) {
		$widget           = new Mizuki_Elementor_Picks_Page();
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

step( 'all of them off draws nothing but the wrapper', function () {
	$off = array();
	foreach ( array( 'banner', 'intro', 'picks', 'featured', 'why', 'faq', 'sticky' ) as $section ) {
		$off[ $section . '_show' ] = '';
	}

	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = array_merge( $widget->run_defaults(), $off );

	ob_start();
	$widget->run_render();
	$html = trim( ob_get_clean() );

	if ( '<div class="mzk-pk"></div>' !== $html ) {
		throw new RuntimeException( 'left something behind: ' . substr( $html, 0, 140 ) );
	}

	return 'an empty wrapper, no stray markup';
} );

/* A link with no address is a link to nowhere, and a button with no words is a blank box. */
step( 'links with nothing behind them are left out', function () {
	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'banner_more_link' => '',
		'faq_more_link'    => '',
		'intro_more_link'  => '',
	) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false !== strpos( $html, 'href=""' ) ) {
		throw new RuntimeException( 'an empty href was drawn' );
	}
	if ( false !== strpos( $html, 'Explore the Collection' ) ) {
		throw new RuntimeException( 'a link with no address was drawn anyway' );
	}
	if ( false === strpos( $html, 'Shop The Picks' ) ) {
		throw new RuntimeException( 'the button went with it' );
	}

	return 'no empty hrefs, and the button kept';
} );

echo "\nThe picks rail, which needs the shop\n";

step( 'no products chosen means no section', function () {
	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	foreach ( array( 'mzk-pk-picks', 'mzk-pk-slider', 'mzk-pk-card' ) as $absent ) {
		if ( false !== strpos( $html, $absent ) ) {
			throw new RuntimeException( $absent . ' was drawn with nothing to put in it' );
		}
	}

	return 'nothing drawn';
} );

step( 'chosen products become cards, and a deleted one is skipped', function () {
	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'picks' => array(
			array( 'product' => '13', 'label' => 'Complete Ritual', 'text' => '', 'image' => array( 'url' => '' ), 'show_price' => 'yes', 'cta' => 'View the Box Set' ),
			array( 'product' => '14', 'label' => '', 'text' => 'A water-light rose mist.', 'image' => array( 'url' => '' ), 'cta' => 'View Product' ),
			array( 'product' => '99999', 'label' => '', 'text' => '', 'image' => array( 'url' => '' ), 'cta' => 'View Product' ),
		),
	) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( 2 !== substr_count( $html, 'mzk-pk-card__link' ) ) {
		throw new RuntimeException( 'drew ' . substr_count( $html, 'mzk-pk-card__link' ) . ' cards for two live products' );
	}
	if ( false === strpos( $html, 'Naturepresso Box Set' ) || false === strpos( $html, 'Pure Rose Water Mist' ) ) {
		throw new RuntimeException( 'a live product was missing' );
	}
	if ( false === strpos( $html, 'S$268.00' ) ) {
		throw new RuntimeException( 'the price was asked for and not drawn' );
	}
	if ( false === strpos( $html, 'Complete Ritual' ) ) {
		throw new RuntimeException( 'the written label was dropped' );
	}
	// An empty label falls back to the product's first category.
	if ( false === strpos( $html, '>Naturepresso<' ) ) {
		throw new RuntimeException( 'an empty label did not fall back to the category' );
	}

	return 'two cards, price, label and category fallback';
} );

step( 'the arrows and counter live inside the slider', function () {
	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'picks' => array(
			array( 'product' => '13', 'label' => '', 'text' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
			array( 'product' => '14', 'label' => '', 'text' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
		),
	) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	$document = new DOMDocument();
	libxml_use_internal_errors( true );
	$document->loadHTML( '<?xml encoding="UTF-8">' . $html );
	libxml_clear_errors();

	$xpath = new DOMXPath( $document );

	foreach ( array( 'mzk-pk-slider__prev', 'mzk-pk-slider__next', 'mzk-pk-slider__track' ) as $part ) {
		$nodes = $xpath->query( '//*[contains(@class, "' . $part . '")]' );
		if ( ! $nodes->length ) {
			throw new RuntimeException( $part . ' was not drawn' );
		}

		$inside = false;
		for ( $parent = $nodes->item( 0 )->parentNode; $parent instanceof DOMElement; $parent = $parent->parentNode ) {
			if ( in_array( 'mzk-pk-slider', explode( ' ', (string) $parent->getAttribute( 'class' ) ), true ) ) {
				$inside = true;
				break;
			}
		}

		if ( ! $inside ) {
			throw new RuntimeException( $part . ' is outside .mzk-pk-slider, so the script cannot reach it' );
		}
	}

	return 'arrows, counter and track all within the wrapper';
} );

step( 'one product draws no arrows to press', function () {
	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'picks' => array( array( 'product' => '13', 'label' => '', 'text' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ) ),
	) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false !== strpos( $html, 'mzk-pk-slider__prev' ) ) {
		throw new RuntimeException( 'arrows drawn for a single card' );
	}
	if ( false === strpos( $html, 'mzk-pk-card__link' ) ) {
		throw new RuntimeException( 'the one card was not drawn' );
	}

	return 'the card, and nothing to scroll it with';
} );

step( 'the phone bar needs somewhere to go', function () {
	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'sticky_button_link' => '' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false !== strpos( $html, 'mzk-pk-sticky' ) ) {
		throw new RuntimeException( 'a bar with no link was drawn' );
	}

	$widget           = new Mizuki_Elementor_Picks_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'sticky_button_link' => '/shop/' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( false === strpos( $html, 'mzk-pk-sticky' ) ) {
		throw new RuntimeException( 'a bar with a link was not drawn' );
	}

	return 'left out without one, drawn with one';
} );


echo "\nTools & Vases, which shares its bones with Mizuki Picks\n";

step( 'it draws its four sections', function () {
	$widget           = new Mizuki_Elementor_Tools_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	foreach ( array( 'mzk-pk-banner', 'mzk-pk-intro', 'mzk-pk-faq' ) as $needed ) {
		if ( false === strpos( $html, $needed ) ) {
			throw new RuntimeException( $needed . ' was not drawn' );
		}
	}

	/* This page has neither of the two sections Mizuki Picks adds. */
	foreach ( array( 'mzk-pk-featured', 'mzk-pk-why' ) as $absent ) {
		if ( false !== strpos( $html, $absent ) ) {
			throw new RuntimeException( $absent . ' belongs to the other page' );
		}
	}

	if ( false === strpos( $html, 'mzk-pk--centred' ) ) {
		throw new RuntimeException( 'the banner was not centred' );
	}
	if ( false !== strpos( $html, 'mzk-pk-picks' ) ) {
		throw new RuntimeException( 'the rail was drawn with no products' );
	}

	return strlen( $html ) . ' bytes, centred, no rail';
} );

step( 'every section can be turned off on its own', function () {
	$sections = array(
		'banner_show' => 'mzk-pk-banner',
		'intro_show'  => 'mzk-pk-intro',
		'faq_show'    => 'mzk-pk-faq',
	);

	foreach ( $sections as $switch => $marker ) {
		$widget           = new Mizuki_Elementor_Tools_Page();
		$widget->settings = array_merge( $widget->run_defaults(), array( $switch => '' ) );

		ob_start();
		$widget->run_render();
		$html = ob_get_clean();

		if ( false !== strpos( $html, $marker ) ) {
			throw new RuntimeException( $switch . ' was off and ' . $marker . ' was drawn anyway' );
		}

		foreach ( $sections as $other => $otherMarker ) {
			if ( $other !== $switch && false === strpos( $html, $otherMarker ) ) {
				throw new RuntimeException( $switch . ' was off and it took ' . $otherMarker . ' with it' );
			}
		}
	}

	return count( $sections ) . ' switches, each independent';
} );

step( 'all of them off draws nothing but the wrapper', function () {
	$off = array();
	foreach ( array( 'banner', 'intro', 'picks', 'faq', 'sticky' ) as $section ) {
		$off[ $section . '_show' ] = '';
	}

	$widget           = new Mizuki_Elementor_Tools_Page();
	$widget->settings = array_merge( $widget->run_defaults(), $off );

	ob_start();
	$widget->run_render();
	$html = trim( ob_get_clean() );

	if ( ! preg_match( '~^<div class="mzk-pk [a-z-]*"></div>$~', $html ) ) {
		throw new RuntimeException( 'left something behind: ' . substr( $html, 0, 140 ) );
	}

	return 'an empty wrapper, no stray markup';
} );

step( 'its cards carry no line of description, unlike the other page', function () {
	$picks = array(
		array( 'product' => '13', 'label' => 'Everyday Vessel', 'text' => 'A line that must not appear.', 'image' => array( 'url' => '' ), 'cta' => 'View Product' ),
	);

	$tools           = new Mizuki_Elementor_Tools_Page();
	$tools->settings = array_merge( $tools->run_defaults(), array( 'picks' => $picks ) );

	ob_start();
	$tools->run_render();
	$toolsHtml = ob_get_clean();

	if ( false !== strpos( $toolsHtml, 'mzk-pk-card__text' ) ) {
		throw new RuntimeException( 'Tools & Vases drew a description' );
	}
	if ( false === strpos( $toolsHtml, 'Everyday Vessel' ) ) {
		throw new RuntimeException( 'the label went with it' );
	}

	/* The same rows on Mizuki Picks do show it — that is the difference between the pages. */
	$picksPage           = new Mizuki_Elementor_Picks_Page();
	$picksPage->settings = array_merge( $picksPage->run_defaults(), array( 'picks' => $picks ) );

	ob_start();
	$picksPage->run_render();
	$picksHtml = ob_get_clean();

	if ( false === strpos( $picksHtml, 'A line that must not appear.' ) ) {
		throw new RuntimeException( 'Mizuki Picks stopped drawing descriptions' );
	}

	return 'no description here, kept on Mizuki Picks';
} );

step( 'the phone shows a dash per product', function () {
	$widget           = new Mizuki_Elementor_Tools_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'picks' => array(
		array( 'product' => '13', 'label' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
		array( 'product' => '14', 'label' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
		array( 'product' => '15', 'label' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
	) ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( 3 !== substr_count( $html, 'mzk-pk-picks__dash"' ) ) {
		throw new RuntimeException( 'drew ' . substr_count( $html, 'mzk-pk-picks__dash"' ) . ' dashes for three products' );
	}
	if ( 1 !== substr_count( $html, 'data-current="true"' ) ) {
		throw new RuntimeException( 'more than one dash is current' );
	}
	// The dashes are decoration; the count is still said in words for a screen reader.
	if ( false === strpos( $html, 'mzk-pk-picks__reader' ) ) {
		throw new RuntimeException( 'no readable count alongside them' );
	}

	return 'three dashes, one current, and a spoken count';
} );

step( 'the rail, the arrows and the questions still work here', function () {
	$widget           = new Mizuki_Elementor_Tools_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'picks' => array(
		array( 'product' => '13', 'label' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
		array( 'product' => '99999', 'label' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
		array( 'product' => '14', 'label' => '', 'image' => array( 'url' => '' ), 'cta' => 'View' ),
	) ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( 2 !== substr_count( $html, 'mzk-pk-card__link' ) ) {
		throw new RuntimeException( 'the deleted product was not skipped' );
	}
	foreach ( array( 'mzk-pk-slider__prev', 'mzk-pk-slider__track', 'mzk-pk-faq__q' ) as $needed ) {
		if ( false === strpos( $html, $needed ) ) {
			throw new RuntimeException( $needed . ' missing' );
		}
	}

	return 'two cards, arrows and accordion, all from the shared trait';
} );


echo "\nAdding to the bag without leaving the page\n";

/*
 * The form is a real post to WooCommerce that the script upgrades to a request staying on the
 * page. Both halves matter: the upgrade is what the studio asked for, and the post underneath is
 * what happens with the script blocked, in a new tab, or when the endpoint is unreachable.
 */
step( 'the form carries WooCommerce’s own endpoint', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( ! preg_match( '/data-mzk-ajax="([^"]+)"/', $html, $match ) ) {
		throw new RuntimeException( 'no endpoint on the form' );
	}
	if ( false === strpos( html_entity_decode( $match[1] ), 'add_to_cart' ) ) {
		throw new RuntimeException( 'that is not the add-to-cart endpoint: ' . $match[1] );
	}

	return 'the shop’s own handler, not a hand-rolled one';
} );

step( 'the ordinary form post is still underneath it', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	foreach ( array( 'method="post"', 'name="add-to-cart" value="13"', 'name="quantity"' ) as $needed ) {
		if ( false === strpos( $html, $needed ) ) {
			throw new RuntimeException( 'missing ' . $needed );
		}
	}

	return 'still a real post, so the button works without the script';
} );

/*
 * A shop set to send people to the cart after adding has been told to do that by somebody.
 * Staying on the page would quietly undo the setting, so the upgrade steps aside.
 */
step( 'a shop set to redirect after adding is left alone', function () {
	$GLOBALS['mzk_options']['woocommerce_cart_redirect_after_add'] = 'yes';

	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	unset( $GLOBALS['mzk_options']['woocommerce_cart_redirect_after_add'] );

	if ( false !== strpos( $html, 'data-mzk-ajax' ) ) {
		throw new RuntimeException( 'it took the page over anyway' );
	}
	if ( false === strpos( $html, 'name="add-to-cart"' ) ) {
		throw new RuntimeException( 'and it broke the ordinary form doing so' );
	}

	return 'no interception, ordinary form intact';
} );

step( 'there is somewhere to say it worked, announced but not shouted', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array( 'product_id' => '13' ) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	if ( ! preg_match( '/<p class="mzk-pdp-buy__said"[^>]*>/', $html, $match ) ) {
		throw new RuntimeException( 'no confirmation element' );
	}

	$tag = $match[0];

	foreach ( array( 'data-added=', 'data-cart-url=', 'aria-live="polite"', 'hidden' ) as $needed ) {
		if ( false === strpos( $tag, $needed ) ) {
			throw new RuntimeException( 'missing ' . $needed . ' on the confirmation' );
		}
	}

	return 'empty and hidden until it has something to say';
} );

step( 'the wording is the studio’s to change', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = array_merge( $widget->run_defaults(), array(
		'product_id'       => '13',
		'hero_button_busy' => 'One moment',
		'hero_added_text'  => 'In your basket.',
		'hero_cart_text'   => 'Go to basket',
	) );

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	foreach ( array( 'One moment', 'In your basket.', 'Go to basket' ) as $needed ) {
		if ( false === strpos( $html, $needed ) ) {
			throw new RuntimeException( 'missing ' . $needed );
		}
	}

	return 'button, confirmation and link all editable';
} );

step( 'no product means no form and nothing to announce', function () {
	$widget           = new Mizuki_Elementor_Product_Page();
	$widget->settings = $widget->run_defaults();

	ob_start();
	$widget->run_render();
	$html = ob_get_clean();

	foreach ( array( 'data-mzk-ajax', 'mzk-pdp-buy__said', 'add-to-cart' ) as $absent ) {
		if ( false !== strpos( $html, $absent ) ) {
			throw new RuntimeException( $absent . ' drawn with no product behind it' );
		}
	}

	return 'nothing drawn';
} );

echo "\n";
if ( $fail ) {
	echo $fail . " failure(s).\n";
	exit( 1 );
}
echo "The plugin loads, waits for Elementor, registers, builds its panels and draws — no fatal.\n";
