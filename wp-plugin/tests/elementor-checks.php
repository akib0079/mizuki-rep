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
	if ( 3 !== count( $ours ) ) {
		throw new RuntimeException( 'found ' . count( $ours ) . ': ' . implode( ',', $ours ) );
	}
	return implode( ', ', $ours );
} );

echo "\nEvery control panel builds, the way the editor builds them\n";
foreach ( array( 'mizuki-calendar', 'mizuki-account', 'mizuki-book-button' ) as $name ) {
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
foreach ( array( 'mizuki-calendar', 'mizuki-account', 'mizuki-book-button' ) as $name ) {
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

echo "\n";
exit( $fail > 0 ? 1 : 0 );
