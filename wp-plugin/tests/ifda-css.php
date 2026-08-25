<?php
/**
 * The IFDA stylesheet has to beat the theme, and it has to not beat itself.
 *
 * Both failures have happened. The page shipped once with the theme winning — headings in the
 * wrong face, the tab strip drawn as two solid buttons — and once with the stylesheet's own
 * blanket reset outranking its centring container, which left every section hard against the
 * left edge with the dead space on the right.
 *
 * That second one is the reason this file exists. It was invisible at the width it was tested
 * at: with no spare width there is nothing to centre into, so a container that cannot centre
 * looks identical to one that can. It only appeared on a wider screen, which is to say on the
 * studio's.
 *
 *   php wp-plugin/tests/ifda-css.php
 */

$css  = file_get_contents( dirname( __DIR__ ) . '/mizuki-booking-bridge/css/ifda.css' );
$fail = 0;

function check( $label, callable $run ) {
	global $fail;
	$problem = $run();
	if ( null === $problem ) {
		echo "  ok    $label\n";
		return;
	}
	$fail++;
	echo "  FAIL  $label -> $problem\n";
}

/** Everything outside comments, as (selector, declarations) pairs. */
function rules( $css ) {
	$css = preg_replace( '#/\*.*?\*/#s', '', $css );
	preg_match_all( '/([^{}]+)\{([^}]*)\}/', $css, $matches, PREG_SET_ORDER );

	$rules = array();
	foreach ( $matches as $match ) {
		$selectors = trim( $match[1] );
		if ( '' === $selectors || 0 === strpos( $selectors, '@' ) ) {
			continue;
		}
		foreach ( array_map( 'trim', explode( ',', $selectors ) ) as $selector ) {
			$rules[] = array( $selector, $match[2] );
		}
	}
	return $rules;
}

echo "The stylesheet cannot outrank itself\n";

/*
 * The reset is written as `.mzk-ifda <element>` — one class and one type. Anything laying out a
 * component with a single class loses to it, which is how a centred container stopped centring.
 */
check( 'every component rule outranks the element reset', function () use ( $css ) {
	$weak = array();

	foreach ( rules( $css ) as $rule ) {
		list( $selector, $body ) = $rule;

		if ( 0 !== strpos( $selector, '.mzk-ifda' ) || '.mzk-ifda' === $selector ) {
			continue;
		}
		// The universal selector carries box-sizing only, and competes with nothing.
		if ( false !== strpos( $selector, '*' ) ) {
			continue;
		}
		// Only rules that set a box property can be beaten by the box reset.
		if ( ! preg_match( '/(^|[;{\s])(margin|padding)/', $body ) ) {
			continue;
		}

		$classes = preg_match_all( '/\.[A-Za-z_-][\w-]*/', $selector );
		$types   = preg_match_all( '/(?:^|[\s>])([a-z]+[0-9]?)(?![\w-])/', $selector );

		if ( $classes < 2 && 0 === $types ) {
			$weak[] = $selector;
		}
	}

	return $weak ? implode( ', ', $weak ) . ' — prefix with `.mzk-ifda `' : null;
} );

echo "\nThe page is centred, not left-aligned\n";

check( 'the container centres itself', function () use ( $css ) {
	if ( ! preg_match( '/\.mzk-ifda\s+\.mzk-ifda__inner\s*\{([^}]*)\}/', $css, $m ) ) {
		return 'no `.mzk-ifda .mzk-ifda__inner` rule at all';
	}
	foreach ( array( 'margin-left: auto', 'margin-right: auto' ) as $needed ) {
		if ( false === strpos( $m[1], $needed ) ) {
			return "missing $needed";
		}
	}
	return null;
} );

echo "\nThe theme cannot reach in\n";

/* The three the theme actually won last time. */
$forced = array(
	'.mzk-ifda .mzk-ifda-tab'           => array( 'background', 'font-family', 'border-radius' ),
	'.mzk-ifda .mzk-ifda-course__title' => array( 'font-family', 'font-size' ),
	'.mzk-ifda .mzk-ifda__btn'          => array( 'background', 'padding' ),
);

foreach ( $forced as $selector => $properties ) {
	check( $selector, function () use ( $css, $selector, $properties ) {
		$quoted = preg_quote( $selector, '/' );
		if ( ! preg_match( '/' . $quoted . '\s*[,{]/', $css ) ) {
			return 'no such rule';
		}
		preg_match_all( '/' . $quoted . '[^{]*\{([^}]*)\}/', $css, $matches );
		$body = implode( ' ', $matches[1] );

		foreach ( $properties as $property ) {
			if ( ! preg_match( '/' . preg_quote( $property, '/' ) . '\s*:[^;]*!important/', $body ) ) {
				return "$property is not forced";
			}
		}
		return null;
	} );
}

echo "\n";
if ( $fail ) {
	echo $fail . " failure(s).\n";
	exit( 1 );
}
echo "The stylesheet beats the theme and does not beat itself.\n";
