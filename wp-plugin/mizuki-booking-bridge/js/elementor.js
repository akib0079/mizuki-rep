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

		[ 'mizuki-calendar', 'mizuki-account', 'mizuki-ifda-page' ].forEach( function ( widget ) {
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

	/**
	 * The course tabs on the IFDA page.
	 *
	 * Delegated from the document rather than bound to the buttons, because Elementor rebuilds a
	 * widget's markup on every keystroke in the panel — anything bound directly is bound to
	 * elements that no longer exist a moment later.
	 *
	 * Panels are in the page before this runs and stay in it: the inactive one is `hidden`, not
	 * removed. So the content is readable with the script blocked, and findable by a browser's
	 * own find-in-page.
	 */
	document.addEventListener( 'click', function ( event ) {
		var tab = event.target.closest( '.mzk-ifda-tab' );
		if ( ! tab ) {
			return;
		}

		selectTab( tab );
	} );

	/* Left and right along the tabs, which is what a tab list is expected to do. */
	document.addEventListener( 'keydown', function ( event ) {
		var tab = event.target.closest && event.target.closest( '.mzk-ifda-tab' );
		if ( ! tab || ( event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' ) ) {
			return;
		}

		var tabs = tabsIn( tab );
		var next = tabs.indexOf( tab ) + ( event.key === 'ArrowRight' ? 1 : -1 );

		if ( tabs[ next ] ) {
			event.preventDefault();
			selectTab( tabs[ next ] );
			tabs[ next ].focus();
		}
	} );

	function tabsIn( tab ) {
		var list = tab.closest( '[data-mzk-ifda-tabs]' );
		return list ? Array.prototype.slice.call( list.querySelectorAll( '.mzk-ifda-tab' ) ) : [ tab ];
	}

	function selectTab( tab ) {
		var root = tab.closest( '.mzk-ifda' );
		if ( ! root ) {
			return;
		}

		tabsIn( tab ).forEach( function ( other ) {
			var chosen = other === tab;
			var panel  = root.querySelector( '#' + cssEscape( other.getAttribute( 'aria-controls' ) ) );

			other.setAttribute( 'aria-selected', chosen ? 'true' : 'false' );
			other.setAttribute( 'tabindex', chosen ? '0' : '-1' );

			if ( panel ) {
				panel.hidden = ! chosen;
			}
		} );

		// A calendar revealed rather than built needs telling it is on screen now.
		refresh();
	}

	/* Ids here are ours and contain nothing exotic, but querySelector is strict about it. */
	function cssEscape( value ) {
		if ( ! value ) {
			return '';
		}
		return window.CSS && window.CSS.escape ? window.CSS.escape( value ) : value;
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
