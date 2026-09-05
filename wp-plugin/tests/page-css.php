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
 *   php wp-plugin/tests/page-css.php
 */

$sheets = array(
	'ifda.css'    => file_get_contents( dirname( __DIR__ ) . '/mizuki-booking-bridge/css/ifda.css' ),
	'ikebana.css' => file_get_contents( dirname( __DIR__ ) . '/mizuki-booking-bridge/css/ikebana.css' ),
	'product.css' => file_get_contents( dirname( __DIR__ ) . '/mizuki-booking-bridge/css/product.css' ),
	'shop-page.css' => file_get_contents( dirname( __DIR__ ) . '/mizuki-booking-bridge/css/shop-page.css' ),
);
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

echo "The stylesheets cannot outrank themselves\n";

/*
 * The reset is written as `.mzk-ifda <element>` — one class and one type. Anything laying out a
 * component with a single class loses to it, which is how a centred container stopped centring.
 */
foreach ( $sheets as $name => $css ) {
check( $name . ': every component rule outranks the element reset', function () use ( $css ) {
	$weak = array();

	foreach ( rules( $css ) as $rule ) {
		list( $selector, $body ) = $rule;

		if ( 0 !== strpos( $selector, '.mzk-' ) || in_array( $selector, array( '.mzk-ifda', '.mzk-ike', '.mzk-pdp', '.mzk-pk' ), true ) ) {
			continue;
		}
		/* The lightbox lives on <body>, outside the page wrapper, so it is its own root. */
		if ( 0 === strpos( $selector, '.mzk-ike-lightbox' ) ) {
			continue;
		}
		/* Same for the phone bar, which the script moves to <body>. */
		if ( 0 === strpos( $selector, '.mzk-pdp-sticky' ) || 0 === strpos( $selector, '.mzk-pk-sticky' ) ) {
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

	return $weak ? implode( ', ', $weak ) . ' — prefix with the page class' : null;
} );
}

echo "\nBoth pages are centred, not left-aligned\n";

foreach ( array( 'ifda.css' => 'mzk-ifda', 'ikebana.css' => 'mzk-ike', 'product.css' => 'mzk-pdp', 'shop-page.css' => 'mzk-pk' ) as $name => $root ) {
check( $name . ': the container centres itself', function () use ( $sheets, $name, $root ) {
	$pattern = '/\.' . $root . '\s+\.' . $root . '__inner\s*\{([^}]*)\}/';

	if ( ! preg_match( $pattern, $sheets[ $name ], $m ) ) {
		return 'no `.' . $root . ' .' . $root . '__inner` rule at all';
	}
	foreach ( array( 'margin-left: auto', 'margin-right: auto' ) as $needed ) {
		if ( false === strpos( $m[1], $needed ) ) {
			return "missing $needed";
		}
	}
	return null;
} );
}

echo "\nThe theme cannot reach in\n";

/* The three the theme actually won last time. */
$forced = array(
	'.mzk-ifda .mzk-ifda-tab'           => array( 'background', 'font-family', 'border-radius' ),
	'.mzk-ifda .mzk-ifda-course__title' => array( 'font-family', 'font-size' ),
	'.mzk-ifda .mzk-ifda__btn'          => array( 'background', 'padding' ),
	'.mzk-ike .mzk-ike__btn'            => array( 'background', 'padding', 'border-radius' ),
	'.mzk-ike .mzk-ike-card__title'     => array( 'font-family', 'font-size' ),
	'.mzk-ike .mzk-ike-slider__dot'     => array( 'background', 'border-radius' ),
	'.mzk-ike .mzk-ike-gallery__item'   => array( 'background', 'padding' ),
	'.mzk-pdp .mzk-pdp__btn'            => array( 'background', 'padding', 'height' ),
	'.mzk-pdp .mzk-pdp-hero__title'     => array( 'font-family', 'font-size' ),
	'.mzk-pdp .mzk-pdp-faq__q'          => array( 'background', 'font-family', 'padding' ),
	'.mzk-pdp .mzk-pdp-qty__input'      => array( 'border', 'background', 'text-align' ),
	'.mzk-pk .mzk-pk__btn'              => array( 'background', 'padding', 'height' ),
	'.mzk-pk .mzk-pk-banner__title'     => array( 'font-family', 'font-size' ),
	'.mzk-pk .mzk-pk-card__title'       => array( 'font-family', 'font-size' ),
	'.mzk-pk .mzk-pk-picks__arrow'      => array( 'background', 'border', 'border-radius' ),
);

$all = implode( "\n", $sheets );

foreach ( $forced as $selector => $properties ) {
	check( $selector, function () use ( $all, $selector, $properties ) {
		$css = $all;
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


echo "\nNo component may stop its own container centring\n";

/*
 * Several elements carry a page container class and a component class at once — the container
 * centres the page's content, the component lays out what is inside it. A margin shorthand on the
 * component overwrites the container's `margin-left: auto` without looking like it does anything
 * of the sort, and the section then sits hard against the left edge on a wide screen while every
 * other section centres. Below the container's max width there is no spare room to centre into,
 * so it looks perfect on the machine it was built on.
 *
 * That has now happened twice, in two different stylesheets, so it is read out of the markup
 * rather than remembered: every class the PHP puts beside an `__inner` is checked here.
 */
check( 'no shared element sets its own horizontal margin', function () use ( $sheets ) {
	$plugin = dirname( __DIR__ ) . '/mizuki-booking-bridge/includes';

	$companions = array();
	foreach ( glob( $plugin . '/*.php' ) as $file ) {
		preg_match_all( '/class="(mzk-[a-z]+__inner)((?: [a-z0-9_-]+)+)"/', file_get_contents( $file ), $matches, PREG_SET_ORDER );
		foreach ( $matches as $match ) {
			foreach ( preg_split( '/\s+/', trim( $match[2] ) ) as $class ) {
				$companions[ $class ] = true;
			}
		}
	}

	if ( ! $companions ) {
		return 'found no shared elements to check — has the markup changed?';
	}

	$offenders = array();

	foreach ( $sheets as $name => $css ) {
		foreach ( rules( $css ) as $rule ) {
			list( $selector, $body ) = $rule;

			foreach ( array_keys( $companions ) as $class ) {
				if ( ! preg_match( '/\.' . preg_quote( $class, '/' ) . '(?![\w-])/', $selector ) ) {
					continue;
				}

				preg_match_all( '/(?:^|;)\s*(margin(?:-left|-right)?)\s*:\s*([^;!]+)/', $body, $found, PREG_SET_ORDER );

				foreach ( $found as $declaration ) {
					$property = $declaration[1];
					$value    = trim( $declaration[2] );

					if ( 'margin' === $property ) {
						$parts = preg_split( '/\s+/', $value );
						// One value sets all four sides; two set vertical then horizontal; three
						// set top, horizontal, bottom; four set each side in turn.
						$count      = count( $parts );
						$horizontal = 1 === $count ? $parts[0] : ( 4 === $count ? $parts[3] : $parts[1] );

						if ( 'auto' !== $horizontal ) {
							$offenders[] = $name . ': ' . $class . ' — ' . $property . ': ' . $value;
						}
					} elseif ( 'auto' !== $value ) {
						$offenders[] = $name . ': ' . $class . ' — ' . $property . ': ' . $value;
					}
				}
			}
		}
	}

	return $offenders ? implode( '; ', array_unique( $offenders ) ) . ' — use margin-top or margin-bottom' : null;
} );

echo "\n";
if ( $fail ) {
	echo $fail . " failure(s).\n";
	exit( 1 );
}
echo "The stylesheet beats the theme and does not beat itself.\n";
