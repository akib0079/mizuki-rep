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

	/** Which card is nearest the left edge of the track — the one the snap has settled on. */
	function currentIndex( slider ) {
		var track = slider.querySelector( '.mzk-ike-slider__track' );
		var list  = cards( slider );
		if ( ! track || ! list.length ) {
			return 0;
		}

		var best = 0;
		var closest = Infinity;

		var edge = track.getBoundingClientRect().left;

		for ( var i = 0; i < list.length; i++ ) {
			var distance = Math.abs( list[ i ].getBoundingClientRect().left - edge );
			if ( distance < closest ) {
				closest = distance;
				best = i;
			}
		}
		return best;
	}

	/**
	 * Move the track to a card.
	 *
	 * scrollIntoView rather than scrollTo, because it is the API that understands snapping, and
	 * `inline: 'start'` says which edge to line up. `block: 'nearest'` keeps it to the horizontal
	 * axis — without it the browser also scrolls the page down to bring the card into view, so
	 * pressing an arrow moves the reader away from the section they are looking at.
	 *
	 * The check afterwards is a real safety net rather than belt and braces. A smooth scroll on a
	 * snap container is cancelled outright under conditions that vary by browser and version —
	 * strict snapping is one, and a tab that is not being painted is another — and it fails
	 * silently, leaving a button that visibly does nothing. If the track has not moved by the
	 * time the animation should be over, it is put where it belongs without one.
	 */
	function scrollToCard( slider, index ) {
		var track = slider.querySelector( '.mzk-ike-slider__track' );
		var list  = cards( slider );
		if ( ! track || ! list.length ) {
			return;
		}

		var target = list[ Math.max( 0, Math.min( index, list.length - 1 ) ) ];
		var from   = track.scrollLeft;

		/* Where it should end up, clamped to what the track can actually reach. */
		var wanted = Math.max( 0, Math.min(
			from + ( target.getBoundingClientRect().left - track.getBoundingClientRect().left ),
			track.scrollWidth - track.clientWidth
		) );

		if ( Math.abs( wanted - from ) < 1 ) {
			return;
		}

		if ( prefersReducedMotion() ) {
			track.scrollLeft = wanted;
			syncSlider( slider );
			return;
		}

		target.scrollIntoView( { inline: 'start', block: 'nearest', behavior: 'smooth' } );

		window.setTimeout( function () {
			if ( Math.abs( track.scrollLeft - from ) < 1 ) {
				track.scrollLeft = wanted;
			}
			syncSlider( slider );
		}, 600 );
	}

	function prefersReducedMotion() {
		return window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
	}

	/**
	 * Mark the current dot and grey out an arrow that would do nothing.
	 *
	 * The end test allows a pixel of slack: a track scrolled fully right often lands a fraction
	 * short of its own maximum, and an arrow that stays lit but cannot move is worse than none.
	 */
	function syncSlider( slider ) {
		var track = slider.querySelector( '.mzk-ike-slider__track' );
		if ( ! track ) {
			return;
		}

		var index = currentIndex( slider );

		var dots = slider.querySelectorAll( '.mzk-ike-slider__dot' );
		for ( var i = 0; i < dots.length; i++ ) {
			dots[ i ].setAttribute( 'aria-current', i === index ? 'true' : 'false' );
		}

		var atStart = track.scrollLeft <= 1;
		var atEnd   = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;

		var prev = slider.querySelector( '.mzk-ike-slider__prev' );
		var next = slider.querySelector( '.mzk-ike-slider__next' );
		if ( prev ) { prev.disabled = atStart; }
		if ( next ) { next.disabled = atEnd; }
	}

	function step( slider, direction ) {
		var list = cards( slider );
		if ( ! list.length ) {
			return;
		}

		/*
		 * Move by whole cards from wherever the track has settled, rather than by a measured
		 * card-plus-gap. Reading the gap out of the stylesheet was the version that broke: it is
		 * a different number at three breakpoints, and drifted a few pixels per press until the
		 * track no longer lined up with anything.
		 */
		scrollToCard( slider, currentIndex( slider ) + direction );
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
				scrollToCard( owner, parseInt( dot.getAttribute( 'data-index' ), 10 ) || 0 );
			}
		}
	} );

	/* Passive: this only reads scroll position and never cancels the gesture. */
	document.addEventListener( 'scroll', function ( event ) {
		var track = event.target;
		if ( track && track.classList && track.classList.contains( 'mzk-ike-slider__track' ) ) {
			var slider = track.closest( '.mzk-ike-slider' );
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

	window.addEventListener( 'load', start );
	window.addEventListener( 'resize', syncAllSliders );
	window.addEventListener( 'elementor/frontend/init', start );
} )();
