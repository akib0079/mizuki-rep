/**
 * Two small jobs the booking bundle cannot do for itself.
 *
 * One: Elementor re-renders a widget every time a control changes, and on the front end it builds
 * some sections after the page has loaded. The bundle mounts what it finds at load, so anything
 * Elementor produced afterwards needs telling.
 *
 * Two: a button anywhere on the page can open the calendar at a particular course. The button is
 * a real link to a real anchor, so it already scrolls without any of this; what is added here is
 * setting the calendar to the right course first, and a smooth scroll for people who want one.
 */
( function () {
	'use strict';

	function refresh() {
		if ( window.MizukiBooking && typeof window.MizukiBooking.refresh === 'function' ) {
			window.MizukiBooking.refresh();
		}
	}

	/*
	 * Elementor's own lifecycle. `element_ready` fires for each widget as it is built, in the
	 * editor and on the front end both, which covers a section that only appears once it is
	 * scrolled to.
	 */
	window.addEventListener( 'elementor/frontend/init', function () {
		if ( ! window.elementorFrontend || ! window.elementorFrontend.hooks ) {
			return;
		}

		[ 'mizuki-calendar', 'mizuki-account' ].forEach( function ( widget ) {
			window.elementorFrontend.hooks.addAction(
				'frontend/element_ready/' + widget + '.default',
				refresh
			);
		} );
	} );

	/**
	 * Any element carrying `data-mizuki-book` or the class `mizuki-book` becomes a booking button.
	 *
	 * The class is there deliberately: it means Elementor's own Button widget works as one too,
	 * by adding `mizuki-book` under Advanced → CSS Classes. The studio should not have to swap a
	 * button they have already styled just to make it open the calendar.
	 */
	document.addEventListener( 'click', function ( event ) {
		var trigger = event.target.closest( '[data-mizuki-book], .mizuki-book' );
		if ( ! trigger ) {
			return;
		}

		var targetId = trigger.getAttribute( 'data-target' ) || anchorFromHref( trigger ) || 'book';
		var section  = document.getElementById( targetId );

		// Fall back to the only calendar on the page, so a button pointing at an anchor somebody
		// has since renamed still lands somewhere useful rather than doing nothing at all.
		var mount = section
			? section.querySelector( '[data-mizuki-booking]' )
			: document.querySelector( '[data-mizuki-booking]' );

		if ( ! mount ) {
			// No calendar here. Leave the link alone — it may point at another page.
			return;
		}

		event.preventDefault();

		var course = trigger.getAttribute( 'data-course' );
		if ( course && mount.getAttribute( 'data-course' ) !== course ) {
			mount.setAttribute( 'data-course', course );
			refresh();
		}

		scrollTo( section || mount );
	} );

	/** A plain `href="#book"` is enough to say where it goes; no second attribute needed. */
	function anchorFromHref( element ) {
		var href = element.getAttribute( 'href' ) || '';
		return href.charAt( 0 ) === '#' ? href.slice( 1 ) : '';
	}

	function scrollTo( element ) {
		var reduced = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

		element.scrollIntoView( {
			behavior: reduced ? 'auto' : 'smooth',
			block: 'start',
		} );

		/*
		 * Give it focus as well as scrolling to it. Someone using a keyboard would otherwise be
		 * moved down the page visually while their place in it stayed on the button, so the next
		 * Tab would take them back to where they started.
		 */
		if ( ! element.hasAttribute( 'tabindex' ) ) {
			element.setAttribute( 'tabindex', '-1' );
		}
		element.focus( { preventScroll: true } );
	}
} )();
