/**
 * The workshops slider and the gallery lightbox.
 *
 * Both are written so the page works without them. The slider is a scroll-snap track — a real
 * scrollable list that takes a finger, a trackpad, a keyboard and a screen reader on its own;
 * the arrows and dots only scroll it. The gallery is a grid of buttons that do nothing until
 * this runs, which is why they are buttons and not divs.
 *
 * Everything is delegated from the document rather than bound to elements, because Elementor
 * rebuilds a widget's DOM every time a control changes and anything bound directly is lost on
 * the first keystroke in the panel.
 */
( function () {
	'use strict';

	var LIGHTBOX_ID = 'mzk-ike-lightbox';

	/* --------------------------------------------------------------- slider */

	function cards( slider ) {
		var track = slider.querySelector( '.mzk-ike-slider__track' );
		return track ? Array.prototype.slice.call( track.querySelectorAll( '.mzk-ike-card' ) ) : [];
	}

	function prefersReducedMotion() {
		return window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	}

	function track( slider ) {
		return slider.querySelector( '.mzk-ike-slider__track' );
	}

	/**
	 * Where the track can actually stop.
	 *
	 * One position per card, dropped once they run past the end of the scroll — with three cards
	 * in view, a fourth card is not a fourth position, because the track cannot scroll far enough
	 * to put it at the left edge. The final stop is added when the last card does not already
	 * land on it, so the last page always shows the end of the list rather than nearly the end.
	 *
	 * This is what the dots are built from. Drawing one per card gave four dots for two positions
	 * and two of them did nothing.
	 */
	function stops( slider ) {
		var scroller = track( slider );
		var list     = cards( slider );
		if ( ! scroller || ! list.length ) {
			return [ 0 ];
		}

		var max  = Math.max( 0, scroller.scrollWidth - scroller.clientWidth );
		var edge = scroller.getBoundingClientRect().left - scroller.scrollLeft;
		var out  = [];

		for ( var i = 0; i < list.length; i++ ) {
			var at = Math.round( list[ i ].getBoundingClientRect().left - edge );

			if ( at > max - 2 ) {
				break;
			}
			out.push( at );
		}

		/*
		 * Drop the last card-start when it sits almost on the end.
		 *
		 * At some widths the final card begins a few pixels before the track runs out, which
		 * gives two stops a thumb's width apart — two dots where pressing either barely moves
		 * anything, and one of them looks broken. A stop has to be worth pressing.
		 */
		var meaningful = Math.max( 40, scroller.clientWidth * 0.15 );

		while ( out.length && max - out[ out.length - 1 ] < meaningful ) {
			out.pop();
		}

		out.push( max );

		return out;
	}

	/** Which stop the track has settled on. */
	function currentStop( slider ) {
		var scroller = track( slider );
		if ( ! scroller ) {
			return 0;
		}

		var list    = stops( slider );
		var best    = 0;
		var closest = Infinity;

		for ( var i = 0; i < list.length; i++ ) {
			var distance = Math.abs( list[ i ] - scroller.scrollLeft );
			if ( distance < closest ) {
				closest = distance;
				best = i;
			}
		}

		return best;
	}

	/**
	 * Draw one dot per stop, and only when the script is there to drive them.
	 *
	 * Rebuilt on resize because the number of stops changes with the width: one card in view on a
	 * phone is four pages, three in view is two.
	 */
	function buildDots( slider ) {
		var holder = slider.querySelector( '.mzk-ike-slider__dots' );
		if ( ! holder ) {
			return;
		}

		var wanted = stops( slider ).length;

		if ( wanted < 2 ) {
			holder.innerHTML = '';
			return;
		}

		if ( holder.children.length !== wanted ) {
			holder.innerHTML = '';

			for ( var i = 0; i < wanted; i++ ) {
				var dot = document.createElement( 'button' );
				dot.type = 'button';
				dot.className = 'mzk-ike-slider__dot';
				dot.setAttribute( 'data-index', String( i ) );
				dot.setAttribute( 'role', 'tab' );
				dot.setAttribute( 'aria-label', 'Page ' + ( i + 1 ) + ' of ' + wanted );
				holder.appendChild( dot );
			}
		}
	}

	function scrollToStop( slider, index ) {
		var scroller = track( slider );
		var list     = stops( slider );
		if ( ! scroller || ! list.length ) {
			return;
		}

		var from = scroller.scrollLeft;
		var to   = list[ Math.max( 0, Math.min( index, list.length - 1 ) ) ];

		if ( Math.abs( to - from ) < 1 ) {
			return;
		}

		if ( prefersReducedMotion() ) {
			scroller.scrollLeft = to;
			syncSlider( slider );
			return;
		}

		scroller.scrollTo( { left: to, behavior: 'smooth' } );

		/*
		 * A smooth scroll on a snap container is cancelled outright under conditions that vary by
		 * browser and version, and it fails silently — leaving a button that visibly does nothing.
		 * If the track has not moved by the time the animation should be over, it is put where it
		 * belongs without one.
		 */
		window.setTimeout( function () {
			if ( Math.abs( scroller.scrollLeft - from ) < 1 ) {
				scroller.scrollLeft = to;
			}
			syncSlider( slider );
		}, 600 );
	}

	/**
	 * Mark the current dot and grey out an arrow that would do nothing.
	 *
	 * The end test allows a pixel of slack: a track scrolled fully right often lands a fraction
	 * short of its own maximum, and an arrow that stays lit but cannot move is worse than none.
	 */
	function syncSlider( slider ) {
		var scroller = track( slider );
		if ( ! scroller ) {
			return;
		}

		buildDots( slider );

		var index = currentStop( slider );
		var dots  = slider.querySelectorAll( '.mzk-ike-slider__dot' );

		for ( var i = 0; i < dots.length; i++ ) {
			dots[ i ].setAttribute( 'aria-current', i === index ? 'true' : 'false' );
			dots[ i ].setAttribute( 'aria-selected', i === index ? 'true' : 'false' );
		}

		var atStart = scroller.scrollLeft <= 1;
		var atEnd   = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;

		var prev = slider.querySelector( '.mzk-ike-slider__prev' );
		var next = slider.querySelector( '.mzk-ike-slider__next' );
		if ( prev ) { prev.disabled = atStart; }
		if ( next ) { next.disabled = atEnd; }

		// Controls appear only once something can drive them.
		slider.classList.add( 'is-ready' );
	}

	function step( slider, direction ) {
		scrollToStop( slider, currentStop( slider ) + direction );
	}

	document.addEventListener( 'click', function ( event ) {
		var arrow = event.target.closest ? event.target.closest( '.mzk-ike-slider__arrow' ) : null;
		if ( arrow ) {
			var slider = arrow.closest( '.mzk-ike-slider' );
			if ( slider ) {
				event.preventDefault();
				step( slider, arrow.classList.contains( 'mzk-ike-slider__prev' ) ? -1 : 1 );
			}
			return;
		}

		var dot = event.target.closest ? event.target.closest( '.mzk-ike-slider__dot' ) : null;
		if ( dot ) {
			var owner = dot.closest( '.mzk-ike-slider' );
			if ( owner ) {
				event.preventDefault();
				scrollToStop( owner, parseInt( dot.getAttribute( 'data-index' ), 10 ) || 0 );
			}
		}
	} );

	/* Left and right move the track when it has focus, as a list of things should. */
	document.addEventListener( 'keydown', function ( event ) {
		if ( 'ArrowLeft' !== event.key && 'ArrowRight' !== event.key ) {
			return;
		}

		var scroller = event.target.closest ? event.target.closest( '.mzk-ike-slider__track' ) : null;
		if ( ! scroller ) {
			return;
		}

		var slider = scroller.closest( '.mzk-ike-slider' );
		if ( slider ) {
			event.preventDefault();
			step( slider, 'ArrowLeft' === event.key ? -1 : 1 );
		}
	} );

	/* Passive: this only reads scroll position and never cancels the gesture. */
	document.addEventListener( 'scroll', function ( event ) {
		var scroller = event.target;
		if ( scroller && scroller.classList && scroller.classList.contains( 'mzk-ike-slider__track' ) ) {
			var slider = scroller.closest( '.mzk-ike-slider' );
			if ( slider ) {
				syncSlider( slider );
			}
		}
	}, true );

	function syncAllSliders() {
		var sliders = document.querySelectorAll( '.mzk-ike-slider' );
		for ( var i = 0; i < sliders.length; i++ ) {
			syncSlider( sliders[ i ] );
		}
	}

	/* --------------------------------------------------------------- lightbox */

	var gallery = [];
	var position = 0;
	var lastFocused = null;

	function lightbox() {
		var element = document.getElementById( LIGHTBOX_ID );
		if ( ! element ) {
			return null;
		}

		/*
		 * Moved to <body> once, and this is not tidiness. `position: fixed` is resolved against
		 * the nearest ancestor with a transform, filter or containment — and Elementor applies
		 * all three for animations and sticky sections. Left where it is rendered, the overlay
		 * covers its own section instead of the window.
		 */
		if ( element.parentNode !== document.body ) {
			document.body.appendChild( element );
		}
		return element;
	}

	function show( index ) {
		var box = lightbox();
		if ( ! box || ! gallery.length ) {
			return;
		}

		position = ( index + gallery.length ) % gallery.length;

		var item = gallery[ position ];
		var img  = box.querySelector( '.mzk-ike-lightbox__img' );
		var cap  = box.querySelector( '.mzk-ike-lightbox__caption' );
		var num  = box.querySelector( '.mzk-ike-lightbox__count' );

		if ( img ) {
			img.setAttribute( 'src', item.full );
			img.setAttribute( 'alt', item.alt );
		}
		if ( cap ) {
			cap.textContent = item.caption;
			cap.hidden = '' === item.caption;
		}
		if ( num ) {
			num.textContent = ( position + 1 ) + ' / ' + gallery.length;
		}

		box.classList.toggle( 'mzk-ike-lightbox--single', gallery.length < 2 );
	}

	function open( grid, index ) {
		var box = lightbox();
		if ( ! box ) {
			return;
		}

		gallery = Array.prototype.slice.call( grid.querySelectorAll( '.mzk-ike-gallery__item' ) ).map( function ( button ) {
			var picture = button.querySelector( 'img' );
			return {
				full: button.getAttribute( 'data-full' ) || ( picture ? picture.getAttribute( 'src' ) : '' ),
				alt: picture ? ( picture.getAttribute( 'alt' ) || '' ) : '',
				caption: button.getAttribute( 'data-caption' ) || ''
			};
		} );

		lastFocused = document.activeElement;
		box.hidden = false;
		/* The page behind must not scroll while a full-screen overlay is up. */
		document.body.style.overflow = 'hidden';

		show( index );

		var close = box.querySelector( '.mzk-ike-lightbox__close' );
		if ( close ) {
			close.focus();
		}
	}

	function close() {
		var box = lightbox();
		if ( ! box || box.hidden ) {
			return;
		}

		box.hidden = true;
		document.body.style.overflow = '';

		var img = box.querySelector( '.mzk-ike-lightbox__img' );
		if ( img ) {
			// Drop the source, or the browser keeps a full-size image decoded for a closed dialog.
			img.removeAttribute( 'src' );
		}

		if ( lastFocused && lastFocused.focus ) {
			lastFocused.focus();
		}
		lastFocused = null;
	}

	document.addEventListener( 'click', function ( event ) {
		var item = event.target.closest ? event.target.closest( '.mzk-ike-gallery__item' ) : null;
		if ( item ) {
			var grid = item.closest( '.mzk-ike-gallery__grid' );
			if ( grid ) {
				event.preventDefault();
				var all = Array.prototype.slice.call( grid.querySelectorAll( '.mzk-ike-gallery__item' ) );
				open( grid, all.indexOf( item ) );
			}
			return;
		}

		var box = event.target.closest ? event.target.closest( '.mzk-ike-lightbox' ) : null;
		if ( ! box ) {
			return;
		}

		if ( event.target.closest( '.mzk-ike-lightbox__close' ) ) {
			close();
		} else if ( event.target.closest( '.mzk-ike-lightbox__prev' ) ) {
			show( position - 1 );
		} else if ( event.target.closest( '.mzk-ike-lightbox__next' ) ) {
			show( position + 1 );
		} else if ( ! event.target.closest( '.mzk-ike-lightbox__figure' ) ) {
			// A click on the backdrop itself closes; one on the picture does not.
			close();
		}
	} );

	document.addEventListener( 'keydown', function ( event ) {
		var box = document.getElementById( LIGHTBOX_ID );
		if ( ! box || box.hidden ) {
			return;
		}

		if ( 'Escape' === event.key ) {
			close();
		} else if ( 'ArrowLeft' === event.key ) {
			show( position - 1 );
		} else if ( 'ArrowRight' === event.key ) {
			show( position + 1 );
		} else if ( 'Tab' === event.key ) {
			/*
			 * Hold the focus inside the overlay. Without this, Tab walks off into the page behind
			 * it, which for somebody using a keyboard means the dialog is still up and their
			 * focus is somewhere they cannot see.
			 */
			var focusable = box.querySelectorAll( 'button:not([disabled])' );
			if ( ! focusable.length ) {
				return;
			}

			var first = focusable[ 0 ];
			var last  = focusable[ focusable.length - 1 ];

			if ( event.shiftKey && document.activeElement === first ) {
				event.preventDefault();
				last.focus();
			} else if ( ! event.shiftKey && document.activeElement === last ) {
				event.preventDefault();
				first.focus();
			}
		}
	} );

	/* --------------------------------------------------------------- start */

	function start() {
		lightbox();
		syncAllSliders();
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', start );
	} else {
		start();
	}

	/**
	 * Re-measure after a resize, not during one.
	 *
	 * How many pages there are depends on how many cards fit, so it changes with the width — and
	 * measuring on the resize event itself reads the old layout. The page's own width is being
	 * recalculated by another handler on the same event, and whichever runs first wins; run first
	 * and the dots describe the width the window used to be. Waiting for it to settle also stops
	 * a drag across the screen rebuilding them on every frame.
	 */
	var settling = null;

	function resettle() {
		window.clearTimeout( settling );
		settling = window.setTimeout( syncAllSliders, 150 );
	}

	window.addEventListener( 'load', start );
	window.addEventListener( 'resize', resettle );
	window.addEventListener( 'orientationchange', resettle );
	window.addEventListener( 'elementor/frontend/init', start );
} )();
