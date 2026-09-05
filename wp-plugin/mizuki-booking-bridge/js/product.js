/**
 * The product page: gallery, quantity, questions, and the bar that follows you down a phone.
 *
 * All of it is an enhancement of something that already works. The gallery shows its first
 * picture as plain HTML; the quantity is a real number input; the questions are open in the
 * markup and the answers are readable with the script blocked; the buy button is a form post
 * WooCommerce already listens for. Nothing here is load-bearing.
 *
 * Everything is delegated from the document rather than bound to elements, because Elementor
 * rebuilds a widget's DOM on every keystroke in the panel and anything bound directly is lost.
 */
( function () {
	'use strict';

	/* --------------------------------------------------------------- gallery */

	function galleryImages( gallery ) {
		return Array.prototype.slice.call( gallery.querySelectorAll( '.mzk-pdp-gallery__thumb' ) );
	}

	function showImage( gallery, index ) {
		var thumbs = galleryImages( gallery );
		var stage  = gallery.querySelector( '[data-mzk-gallery-stage]' );
		if ( ! stage || ! thumbs.length ) {
			return;
		}

		var wanted = ( index + thumbs.length ) % thumbs.length;
		var picked = thumbs[ wanted ];
		var source = picked.querySelector( 'img' );

		if ( source ) {
			stage.setAttribute( 'src', source.getAttribute( 'src' ) );
		}

		for ( var i = 0; i < thumbs.length; i++ ) {
			thumbs[ i ].setAttribute( 'aria-current', i === wanted ? 'true' : 'false' );
		}

		gallery.setAttribute( 'data-active', String( wanted ) );
	}

	function activeIndex( gallery ) {
		return parseInt( gallery.getAttribute( 'data-active' ), 10 ) || 0;
	}

	/*
	 * The arrows are added here rather than rendered in PHP.
	 *
	 * They do nothing without this script — a control that cannot work should not be on the page
	 * at all, and one drawn server-side would be there for anyone with JavaScript blocked.
	 */
	function addArrows( gallery ) {
		var stage = gallery.querySelector( '.mzk-pdp-gallery__stage' );

		if ( ! stage || galleryImages( gallery ).length < 2 || stage.querySelector( '.mzk-pdp-gallery__arrow' ) ) {
			return;
		}

		[ 'prev', 'next' ].forEach( function ( way ) {
			var button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'mzk-pdp-gallery__arrow mzk-pdp-gallery__' + way;
			button.setAttribute( 'data-mzk-gallery-step', 'prev' === way ? '-1' : '1' );
			button.setAttribute( 'aria-label', 'prev' === way ? 'Previous picture' : 'Next picture' );
			button.innerHTML = 'prev' === way
				? '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>'
				: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
			stage.appendChild( button );
		} );
	}

	/* -------------------------------------------------------------- quantity */

	function stepQuantity( button ) {
		var form = button.closest( '[data-mzk-buy]' );
		if ( ! form ) {
			return;
		}

		var input = form.querySelector( '.mzk-pdp-qty__input' );
		if ( ! input ) {
			return;
		}

		var by  = parseInt( button.getAttribute( 'data-mzk-qty' ), 10 ) || 0;
		var now = parseInt( input.value, 10 );

		// A field somebody has emptied or typed letters into reads as NaN, not as zero.
		if ( isNaN( now ) ) {
			now = 1;
		}

		var min = parseInt( input.getAttribute( 'min' ), 10 );
		if ( isNaN( min ) ) {
			min = 1;
		}

		var max = parseInt( input.getAttribute( 'max' ), 10 );
		var next = Math.max( min, now + by );

		if ( ! isNaN( max ) ) {
			next = Math.min( max, next );
		}

		input.value = String( next );

		/* So anything listening to the field — WooCommerce extensions do — sees the change. */
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	}

	/* ------------------------------------------------------------------- faq */

	function toggleQuestion( button ) {
		var open = 'true' === button.getAttribute( 'aria-expanded' );
		var id     = button.getAttribute( 'aria-controls' );
		var answer = id ? document.getElementById( id ) : null;

		button.setAttribute( 'aria-expanded', open ? 'false' : 'true' );

		if ( answer ) {
			answer.setAttribute( 'data-open', open ? 'false' : 'true' );
		}
	}

	/* ---------------------------------------------------------------- sticky */

	/**
	 * Show the phone bar once the real button has gone past.
	 *
	 * An observer rather than a scroll handler: it costs nothing while the button is on screen,
	 * and a scroll handler on a page this long is work on every frame of every scroll.
	 */
	function watchBuyButton() {
		var bar = document.querySelector( '[data-mzk-sticky]' );
		var buy = document.querySelector( '[data-mzk-buy] .mzk-pdp-buy__submit' );

		if ( ! bar || ! buy ) {
			return;
		}

		if ( bar.parentNode !== document.body ) {
			/*
			 * Moved to <body>, and this is not tidiness. `position: fixed` resolves against the
			 * nearest ancestor with a transform, filter or containment — and Elementor applies
			 * all three. Left where it is rendered the bar sits inside its own section.
			 */
			document.body.appendChild( bar );
		}

		bar.hidden = false;

		if ( ! window.IntersectionObserver ) {
			return;
		}

		new window.IntersectionObserver( function ( entries ) {
			var entry = entries[ 0 ];
			// Only once it has gone up past the top; a button still below the fold is one the
			// reader is on their way to.
			var gone = ! entry.isIntersecting && entry.boundingClientRect.top < 0;

			bar.classList.toggle( 'is-shown', gone );
		}, { threshold: 0 } ).observe( buy );
	}

	/* ----------------------------------------------------------------- wiring */

	document.addEventListener( 'click', function ( event ) {
		var target = event.target;
		if ( ! target || ! target.closest ) {
			return;
		}

		var thumb = target.closest( '.mzk-pdp-gallery__thumb' );
		if ( thumb ) {
			event.preventDefault();
			showImage( thumb.closest( '[data-mzk-gallery]' ), parseInt( thumb.getAttribute( 'data-index' ), 10 ) || 0 );
			return;
		}

		var arrow = target.closest( '[data-mzk-gallery-step]' );
		if ( arrow ) {
			event.preventDefault();
			var gallery = arrow.closest( '[data-mzk-gallery]' );
			if ( gallery ) {
				showImage( gallery, activeIndex( gallery ) + ( parseInt( arrow.getAttribute( 'data-mzk-gallery-step' ), 10 ) || 0 ) );
			}
			return;
		}

		var qty = target.closest( '[data-mzk-qty]' );
		if ( qty ) {
			event.preventDefault();
			stepQuantity( qty );
			return;
		}

		var question = target.closest( '.mzk-pdp-faq__q' );
		if ( question ) {
			event.preventDefault();
			toggleQuestion( question );
			return;
		}

		var sticky = target.closest( '[data-mzk-sticky-add]' );
		if ( sticky ) {
			event.preventDefault();
			var form = document.querySelector( '[data-mzk-buy]' );
			if ( form ) {
				// The form above is the only one; the bar borrows it so the quantity on screen is
				// the quantity that gets added.
				if ( form.requestSubmit ) {
					form.requestSubmit();
				} else {
					form.submit();
				}
			}
		}
	} );

	/* Left and right move the gallery when a thumbnail has focus. */
	document.addEventListener( 'keydown', function ( event ) {
		if ( 'ArrowLeft' !== event.key && 'ArrowRight' !== event.key ) {
			return;
		}

		var thumb = event.target.closest ? event.target.closest( '.mzk-pdp-gallery__thumb' ) : null;
		if ( ! thumb ) {
			return;
		}

		var gallery = thumb.closest( '[data-mzk-gallery]' );
		if ( ! gallery ) {
			return;
		}

		event.preventDefault();

		var next = activeIndex( gallery ) + ( 'ArrowLeft' === event.key ? -1 : 1 );
		showImage( gallery, next );

		var thumbs = galleryImages( gallery );
		var landed = thumbs[ ( next + thumbs.length ) % thumbs.length ];
		if ( landed ) {
			landed.focus();
		}
	} );

	function start() {
		var galleries = document.querySelectorAll( '[data-mzk-gallery]' );
		for ( var i = 0; i < galleries.length; i++ ) {
			addArrows( galleries[ i ] );
		}

		watchBuyButton();
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', start );
	} else {
		start();
	}

	window.addEventListener( 'load', start );
	window.addEventListener( 'elementor/frontend/init', start );
} )();
