<?php
/**
 * Run inside a fully loaded WordPress with the real Elementor, by real-wordpress.sh.
 *
 * Everything here goes through Elementor's own machinery rather than ours: its widget manager,
 * its control stack, its render pipeline. That is the point — the failure this exists to catch
 * was a disagreement between what we assumed about Elementor and what Elementor does.
 */

$fail = 0;
function step( $label, callable $run ) {
	global $fail;
	try {
		$out = $run();
		echo "  ok    $label" . ( $out ? " — $out" : '' ) . "\n";
	} catch ( \Throwable $e ) {
		$fail++;
		echo '  FAIL  ' . $label . ' -> ' . get_class( $e ) . ': ' . $e->getMessage() . "\n";
		echo '        ' . $e->getFile() . ':' . $e->getLine() . "\n";
	}
}

echo "Elementor sees our widgets\n";
step( 'the widget types register', function () {
	$types = \Elementor\Plugin::$instance->widgets_manager->get_widget_types();
	$ours  = array_filter( array_keys( $types ), function ( $k ) { return 0 === strpos( $k, 'mizuki-' ); } );
	if ( 4 !== count( $ours ) ) {
		throw new RuntimeException( 'found ' . count( $ours ) . ': ' . implode( ',', $ours ) );
	}
	return implode( ', ', $ours );
} );

echo "\nEvery control panel builds, the way the editor builds them\n";
foreach ( array( 'mizuki-calendar', 'mizuki-account', 'mizuki-book-button', 'mizuki-ifda-page' ) as $name ) {
	step( $name, function () use ( $name ) {
		$widget = \Elementor\Plugin::$instance->widgets_manager->get_widget_types( $name );
		if ( ! $widget ) { throw new RuntimeException( 'not registered' ); }
		$controls = $widget->get_controls();
		return count( $controls ) . ' controls';
	} );
}

/*
 * What the editor asks for when it opens. This walks every control of every widget and is where
 * a bad control definition surfaces — a select with no options, a group control that does not
 * exist on this Elementor version.
 */
step( 'the whole editor config', function () {
	$config = \Elementor\Plugin::$instance->widgets_manager->get_widget_types_config();
	return count( $config ) . ' widgets configured';
} );

echo "\nRendering, through Elementor's own pipeline\n";
foreach ( array(
	'mizuki-calendar'   => array( 'course' => 'ifda', 'view' => 'calendar', 'anchor' => 'book', 'live_preview' => 'yes' ),
	'mizuki-account'    => array( 'course' => 'ifda', 'heading' => 'Already taking IFDA?', 'intro' => 'Sign in.', 'live_preview' => 'yes' ),
	'mizuki-book-button'=> array( 'label' => 'Book a lesson', 'target' => 'book', 'course' => 'ifda' ),
) as $name => $settings ) {
	step( "render $name", function () use ( $name, $settings ) {
		$widget = \Elementor\Plugin::$instance->elements_manager->create_element_instance(
			array( 'elType' => 'widget', 'widgetType' => $name, 'id' => 'test1', 'settings' => $settings )
		);
		if ( ! $widget ) { throw new RuntimeException( 'Elementor would not build it' ); }
		ob_start();
		$widget->render_content();
		$html = ob_get_clean();
		return strlen( $html ) . ' bytes';
	} );
}

/*
 * An instance saved before a control existed. Elementor hands back exactly what was stored, so
 * every setting a widget reads has to survive not being there — this is what happens to a page
 * built on one version of the plugin and opened on the next.
 */
echo "\nAn old saved instance, missing everything added since\n";
foreach ( array( 'mizuki-calendar', 'mizuki-account', 'mizuki-book-button', 'mizuki-ifda-page' ) as $name ) {
	step( "render $name with no settings at all", function () use ( $name ) {
		$widget = \Elementor\Plugin::$instance->elements_manager->create_element_instance(
			array( 'elType' => 'widget', 'widgetType' => $name, 'id' => 'test2', 'settings' => array() )
		);
		ob_start();
		$widget->render_content();
		$html = ob_get_clean();
		return strlen( $html ) . ' bytes';
	} );
}

/*
 * The IFDA page, drawn by Elementor from nothing but its own declared defaults — which is exactly
 * what the studio gets the moment they drop it on a page. Elementor fills in a control's default
 * itself when a saved instance has no value for it, so passing no settings is not an empty
 * widget; it is a factory-fresh one.
 */
echo "\nThe IFDA page, as Elementor builds it from its own defaults\n";
step( 'it draws every section', function () {
	$widget = \Elementor\Plugin::$instance->elements_manager->create_element_instance(
		array( 'elType' => 'widget', 'widgetType' => 'mizuki-ifda-page', 'id' => 'ifda1', 'settings' => array() )
	);
	if ( ! $widget ) { throw new RuntimeException( 'Elementor would not build it' ); }

	ob_start();
	$widget->render_content();
	$html = ob_get_clean();

	$wanted = array(
		'mzk-ifda-hero'       => 'the hero',
		'mzk-ifda-about'      => 'about IFDA',
		'mzk-ifda-cert__card' => 'the certification cards',
		'mzk-ifda-tab'        => 'the course tabs',
		'mzk-ifda-learn'      => 'what you will learn',
		'mzk-ifda-projects'   => 'the pieces',
		'mzk-ifda-callout'    => 'the note',
		'mzk-ifda-booking'    => 'the booking block',
		'mizuki-book'         => 'a button wired to the calendar',
		'data-course="ifda"'         => 'the calendar opening on IFDA rather than everything',
		'data-mizuki-booking' => 'the calendar mount itself',
	);

	$missing = array();
	foreach ( $wanted as $needle => $label ) {
		if ( false === strpos( $html, $needle ) ) { $missing[] = $label; }
	}
	if ( $missing ) { throw new RuntimeException( 'nothing drawn for: ' . implode( ', ', $missing ) ); }

	if ( 2 !== substr_count( $html, 'role="tabpanel"' ) ) {
		throw new RuntimeException( 'expected both course panels in the markup' );
	}

	return strlen( $html ) . ' bytes, every section present';
} );

step( 'its stylesheet is registered and reachable', function () {
	$widget = \Elementor\Plugin::$instance->widgets_manager->get_widget_types( 'mizuki-ifda-page' );
	$needs  = $widget->get_style_depends();

	if ( ! in_array( 'mizuki-ifda', $needs, true ) ) {
		throw new RuntimeException( 'the widget does not ask for its stylesheet' );
	}
	if ( ! wp_style_is( 'mizuki-ifda', 'registered' ) ) {
		throw new RuntimeException( 'mizuki-ifda is never registered, so Elementor cannot enqueue it' );
	}

	$file = WP_PLUGIN_DIR . '/mizuki-booking-bridge/css/ifda.css';
	if ( ! file_exists( $file ) ) {
		throw new RuntimeException( 'assets/ifda.css is not in the plugin' );
	}

	return basename( $file ) . ', ' . size_format( filesize( $file ) );
} );

echo "\n";
exit( $fail > 0 ? 1 : 0 );
