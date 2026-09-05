/**
 * The shop pages' slider, questions, and the bar that follows you down a phone.
 *
 * Shared by the Mizuki Picks and Tools & Vases widgets — both draw the same rail and the same
 * accordion, so both are driven from here. Nothing below knows which page it is on.
 *
 * All of it enhances something that already works. The track is a real scrollable list that takes
 * a finger, a trackpad, a keyboard and a screen reader before any script runs; the questions are
 * open in the markup and readable with the script blocked. The arrows and the counter only
 * describe and drive what the track is already doing.
 *
 * Everything is delegated from the document, because Elementor rebuilds a widget's DOM on every
 * keystroke in the panel and anything bound directly is lost on the first one.
 */
( function () {
	'use strict';

	function prefersReducedMotion() {
		return window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	}

	function track( slider ) {
		return slider.querySelector( '.mzk-pk-slider__track' );
	}

	function cards( slider ) {
		var rail = track( slider );
		return rail ? Array.prototype.slice.call( rail.querySelectorAll( '.mzk-pk-card' ) ) : [];
	}

	/**
	 * Where the track can actually stop.
	 *
	 * One position per card, dropped once they run past the end of the scroll — with three cards
	 * in view, a fourth card is not a fourth position, because the track cannot scroll far enough
	 * to put it at the left edge. The final stop is added when the last card does not already
	 * land on it, and a stop too close to the end is folded into it: two positions a thumb's
	 * width apart are two presses that appear to do nothing.
	 */
	function stops( slider ) {
		var rail = track( slider );
		var list = cards( slider );
		if ( ! rail || ! list.length ) {
			return [ 0 ];
		}

		var max  = Math.max( 0, rail.scrollWidth - rail.clientWidth );
		var edge = rail.getBoundingClientRect().left - rail.scrollLeft;
		var out  = [];

		for ( var i = 0; i < list.length; i++ ) {
			var at = Math.round( list[ i ].getBoundingClientRect().left - edge );

			if ( at > max - 2 ) {
				break;
			}
			out.push( at );
		}

		var meaningful = Math.max( 40, rail.clientWidth * 0.15 );

		while ( out.length && max - out[ out.length - 1 ] < meaningful ) {
			out.pop();
		}

		out.push( max );

		return out;
	}

	function currentStop( slider ) {
		var rail = track( slider );
		if ( ! rail ) {
			return 0;
		}

		var list    = stops( slider );
		var best    = 0;
		var closest = Infinity;

		for ( var i = 0; i < list.length; i++ ) {
			var distance = Math.abs( list[ i ] - rail.scrollLeft );
			if ( distance < closest ) {
				closest = distance;
				best = i;
			}
		}

		return best;
	}

	function pad( number ) {
		return ( number < 10 ? '0' : '' ) + number;
	}

	function scrollToStop( slider, index ) {
		var rail = track( slider );
		var list = stops( slider );
		if ( ! rail || ! list.length ) {
			return;
		}

		var from = rail.scrollLeft;
		var to   = list[ Math.max( 0, Math.min( index, list.length - 1 ) ) ];

		if ( Math.abs( to - from ) < 1 ) {
			return;
		}

		if ( prefersReducedMotion() ) {
			rail.scrollLeft = to;
			syncSlider( slider );
			return;
		}

		rail.scrollTo( { left: to, behavior: 'smooth' } );

		/*
		 * A smooth scroll on a snap container is cancelled outright under conditions that vary by
		 * browser and version, and it fails silently — leaving a button that visibly does nothing.
		 * If the track has not moved by the time the animation should be over, it is put where it
		 * belongs without one.
		 */
		window.setTimeout( function () {
			if ( Math.abs( rail.scrollLeft - from ) < 1 ) {
				rail.scrollLeft = to;
			}
			syncSlider( slider );
		}, 600 );
	}

	/** Mark the counter, and grey out an arrow that would do nothing. */
	function syncSlider( slider ) {
		var rail = track( slider );
		if ( ! rail ) {
			return;
		}

		var list  = cards( slider );
		var total = list.length;

		/*
		 * The counter names the card at the left edge, not the stop.
		 *
		 * Stops and cards are different counts: four cards three-across is two stops, and
		 * counting stops made the last one read "02 / 04" — a number that says two more cards are
		 * still to come when the track has already run out. Reading the leftmost card gives
		 * "03 / 04" there, which is what is actually on screen.
		 */
		var edge    = rail.getBoundingClientRect().left;
		var showing = 1;
		var closest = Infinity;

		for ( var c = 0; c < total; c++ ) {
			var distance = Math.abs( list[ c ].getBoundingClientRect().left - edge );
			if ( distance < closest ) {
				closest = distance;
				showing = c + 1;
			}
		}

		var atStart = rail.scrollLeft <= 1;
		var atEnd   = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 1;

		/*
		 * At the end of the track, say so. The rail shows several cards at once and the last one
		 * comes into view well before it reaches the left edge, so reading the leftmost card
		 * there gives "02 / 04" while the fourth is plainly on screen. Scrolled to the end means
		 * the end of the list, whatever is nearest the edge.
		 */
		if ( atEnd ) {
			showing = total;
		}

		var counters = slider.querySelectorAll( '[data-mzk-pk-count]' );
		for ( var i = 0; i < counters.length; i++ ) {
			counters[ i ].textContent = pad( showing ) + ' / ' + pad( total );
		}

		/* The dash row says the same thing without words, where a page uses one. */
		var dashes = slider.querySelectorAll( '.mzk-pk-picks__dash' );
		for ( var d = 0; d < dashes.length; d++ ) {
			if ( d === showing - 1 ) {
				dashes[ d ].setAttribute( 'data-current', 'true' );
			} else {
				dashes[ d ].removeAttribute( 'data-current' );
			}
		}

		var prev = slider.querySelector( '.mzk-pk-slider__prev' );
		var next = slider.querySelector( '.mzk-pk-slider__next' );
		if ( prev ) { prev.disabled = atStart; }
		if ( next ) { next.disabled = atEnd; }

		/*
		 * Controls appear only once the script is here AND there is something to scroll.
		 *
		 * Three cards that all fit is a rail that cannot move, and arrows over it are two buttons
		 * that do nothing next to a counter reading "03 / 03" before the reader has done
		 * anything. How many fit depends on the width, so this is decided here rather than in PHP
		 * — the same three cards do scroll on a phone.
		 */
		slider.classList.add( 'is-ready' );
		slider.classList.toggle( 'is-scrollable', rail.scrollWidth > rail.clientWidth + 1 );
	}

	function step( slider, direction ) {
		scrollToStop( slider, currentStop( slider ) + direction );
	}

	function syncAllSliders() {
		var sliders = document.querySelectorAll( '.mzk-pk-slider' );
		for ( var i = 0; i < sliders.length; i++ ) {
			syncSlider( sliders[ i ] );
		}
	}

	/* ------------------------------------------------------------------- faq */

	function toggleQuestion( button ) {
		var open   = 'true' === button.getAttribute( 'aria-expanded' );
		var id     = button.getAttribute( 'aria-controls' );
		var answer = id ? document.getElementById( id ) : null;

		button.setAttribute( 'aria-expanded', open ? 'false' : 'true' );

		if ( answer ) {
			answer.setAttribute( 'data-open', open ? 'false' : 'true' );
		}
	}

	/* ---------------------------------------------------------------- sticky */

	/**
	 * Show the phone bar once the picks have gone past.
	 *
	 * An observer rather than a scroll handler: it costs nothing while the section is on screen,
	 * and a scroll handler on a page this long is work on every frame of every scroll.
	 */
	function watchPicks() {
		var bar = document.querySelector( '[data-mzk-pk-sticky]' );
		if ( ! bar ) {
			return;
		}

		if ( bar.parentNode !== document.body ) {
			/*
			 * Moved to <body>: `position: fixed` resolves against the nearest ancestor with a
			 * transform, filter or containment, and Elementor applies all three. Left where it is
			 * rendered the bar sits inside its own section rather than against the window.
			 */
			document.body.appendChild( bar );
		}

		bar.hidden = false;

		/* Past the picks if there are picks; past the banner if there are not. */
		var marker = document.querySelector( '.mzk-pk-picks' ) || document.querySelector( '.mzk-pk-banner' );

		if ( ! marker || ! window.IntersectionObserver ) {
			return;
		}

		new window.IntersectionObserver( function ( entries ) {
			var entry = entries[ 0 ];
			var gone  = ! entry.isIntersecting && entry.boundingClientRect.top < 0;

			bar.classList.toggle( 'is-shown', gone );
		}, { threshold: 0 } ).observe( marker );
	}

	/* ----------------------------------------------------------------- wiring */

	document.addEventListener( 'click', function ( event ) {
		var target = event.target;
		if ( ! target || ! target.closest ) {
			return;
		}

		var arrow = target.closest( '.mzk-pk-picks__arrow' );
		if ( arrow ) {
			var slider = arrow.closest( '.mzk-pk-slider' );
			if ( slider ) {
				event.preventDefault();
				step( slider, arrow.classList.contains( 'mzk-pk-slider__prev' ) ? -1 : 1 );
			}
			return;
		}

		var question = target.closest( '.mzk-pk-faq__q' );
		if ( question ) {
			event.preventDefault();
			toggleQuestion( question );
		}
	} );

	/* Left and right move the track when it has focus, as a list of things should. */
	document.addEventListener( 'keydown', function ( event ) {
		if ( 'ArrowLeft' !== event.key && 'ArrowRight' !== event.key ) {
			return;
		}

		var rail = event.target.closest ? event.target.closest( '.mzk-pk-slider__track' ) : null;
		if ( ! rail ) {
			return;
		}

		var slider = rail.closest( '.mzk-pk-slider' );
		if ( slider ) {
			event.preventDefault();
			step( slider, 'ArrowLeft' === event.key ? -1 : 1 );
		}
	} );

	/* Passive: this only reads scroll position and never cancels the gesture. */
	document.addEventListener( 'scroll', function ( event ) {
		var rail = event.target;
		if ( rail && rail.classList && rail.classList.contains( 'mzk-pk-slider__track' ) ) {
			var slider = rail.closest( '.mzk-pk-slider' );
			if ( slider ) {
				syncSlider( slider );
			}
		}
	}, true );

	function start() {
		syncAllSliders();
		watchPicks();
	}

	/**
	 * Re-measure after a resize, not during one.
	 *
	 * How far the track can scroll changes with the width, and the page's own width is being
	 * recalculated by another handler on the same event — measure first and the counter describes
	 * the width the window used to be. Waiting also stops a drag across the screen doing this on
	 * every frame.
	 */
	var settling = null;

	function resettle() {
		window.clearTimeout( settling );
		settling = window.setTimeout( syncAllSliders, 150 );
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', start );
	} else {
		start();
	}

	window.addEventListener( 'load', start );
	window.addEventListener( 'resize', resettle );
	window.addEventListener( 'orientationchange', resettle );
	window.addEventListener( 'elementor/frontend/init', start );
} )();
