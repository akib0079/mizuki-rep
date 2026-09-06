<?php
/**
 * What the shop pages have in common.
 *
 * Mizuki Picks and Tools & Vases are one design system with different sections: the same product
 * rail, the same accordion, the same banner and phone bar, the same palette and faces. Rather
 * than two copies drifting apart a fix at a time, both widgets use this and differ only in which
 * sections they register, what those sections say, and three small choices below.
 *
 * Everything that touches WooCommerce is behind a check, because a page builder widget that
 * fatals when a plugin is deactivated takes the whole site with it.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

trait Mizuki_Elementor_Shop_Page {

	/* Where a list of products comes from, and the WooCommerce access that needs. */
	use Mizuki_Elementor_Product_Source;

	public function get_style_depends() {
		return array( 'mizuki-shop-page' );
	}

	public function get_script_depends() {
		return array( 'mizuki-elementor', 'mizuki-shop-page' );
	}

	/**
	 * The three ways the two pages differ, and the only ones.
	 *
	 * Picks sets its banner to the left on a desktop and gives each card a line of description;
	 * Tools & Vases centres the banner and lets the picture and the name carry the card. Anything
	 * beyond these belongs in the widget rather than here.
	 */
	protected function page_modifier() {
		return '';
	}

	protected function cards_show_text() {
		return true;
	}

	protected function mobile_pagination() {
		return 'text';
	}

	/**
	 * -------------------------------------------------------------------------
	 * WooCommerce, at arm's length
	 * -------------------------------------------------------------------------
	 *
	 * The list behind the pickers is shared with the product page widget — same transient, same
	 * two-minute cache for an empty answer, same invalidation when the shop changes.
	 */

	/** The switch every section starts with, first in its panel and on by default. */
	private function add_section_switch( $key, $label ) {
		$this->add_control(
			$key,
			array(
				'label'        => $label,
				'type'         => \Elementor\Controls_Manager::SWITCHER,
				'label_on'     => __( 'Shown', 'mizuki-booking' ),
				'label_off'    => __( 'Hidden', 'mizuki-booking' ),
				'return_value' => 'yes',
				'default'      => 'yes',
				'separator'    => 'after',
			)
		);
	}

	private function add_link_controls( $prefix, $label, $text, $link = '' ) {
		$this->add_control( $prefix . '_text', array(
			'label'   => $label,
			'type'    => \Elementor\Controls_Manager::TEXT,
			'default' => $text,
		) );

		$this->add_control( $prefix . '_link', array(
			'label'       => $label . ' ' . __( 'link', 'mizuki-booking' ),
			'type'        => \Elementor\Controls_Manager::TEXT,
			'default'     => $link,
			'description' => __( 'Left out when empty.', 'mizuki-booking' ),
		) );
	}

	/**
	 * -------------------------------------------------------------------------
	 * Drawing
	 * -------------------------------------------------------------------------
	 */

	private function get( $s, $key, $fallback = '' ) {
		return isset( $s[ $key ] ) && '' !== $s[ $key ] ? $s[ $key ] : $fallback;
	}

	private function rows( $s, $key ) {
		return isset( $s[ $key ] ) && is_array( $s[ $key ] ) ? $s[ $key ] : array();
	}

	private function image_url( $s, $key ) {
		return isset( $s[ $key ]['url'] ) ? $s[ $key ]['url'] : '';
	}

	/** A section shows unless its switch says otherwise; an absent switch is an older instance. */
	private function showing( $s, $key ) {
		return ! isset( $s[ $key ] ) || 'yes' === $s[ $key ];
	}

	private function line( $tag, $class, $text ) {
		if ( ! is_string( $text ) || '' === trim( $text ) ) {
			return;
		}

		printf(
			'<%1$s%2$s>%3$s</%1$s>',
			tag_escape( $tag ),
			$class ? ' class="' . esc_attr( $class ) . '"' : '',
			esc_html( $text )
		);
	}

	private function rich( $html, $class ) {
		if ( ! is_string( $html ) || '' === trim( wp_strip_all_tags( $html ) ) ) {
			return;
		}

		printf( '<div class="%s">%s</div>', esc_attr( $class ), wp_kses_post( $html ) );
	}

	private function icon( $row, $class ) {
		if ( empty( $row['icon']['value'] ) || ! class_exists( '\Elementor\Icons_Manager' ) ) {
			return;
		}

		printf( '<span class="%s">', esc_attr( $class ) );
		\Elementor\Icons_Manager::render_icon( $row['icon'], array( 'aria-hidden' => 'true' ) );
		echo '</span>';
	}

	private function arrow() {
		return '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
	}

	private function chevron( $way ) {
		return 'left' === $way
			? '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>'
			: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
	}

	/** A text link, drawn only when it has both words and somewhere to go. */
	private function text_link( $s, $prefix, $class = 'mzk-pk__link' ) {
		$text = $this->get( $s, $prefix . '_text' );
		$link = $this->get( $s, $prefix . '_link' );

		if ( '' === trim( $text ) || '' === trim( $link ) ) {
			return;
		}

		printf(
			'<a class="%s" href="%s"><span>%s</span>%s</a>',
			esc_attr( $class ),
			esc_url( $link ),
			esc_html( $text ),
			$this->arrow() // phpcs:ignore WordPress.Security.EscapeOutput -- a fixed SVG.
		);
	}

	private function button( $s, $prefix, $class = 'mzk-pk__btn' ) {
		$text = $this->get( $s, $prefix . '_text' );
		$link = $this->get( $s, $prefix . '_link' );

		if ( '' === trim( $text ) ) {
			return;
		}

		if ( '' === trim( $link ) ) {
			// A button that goes nowhere is a button, not a link to nothing.
			printf( '<button type="button" class="%s">%s</button>', esc_attr( $class ), esc_html( $text ) );
			return;
		}

		printf( '<a class="%s" href="%s">%s</a>', esc_attr( $class ), esc_url( $link ), esc_html( $text ) );
	}

	private function render_banner( $s ) {
		$image = $this->image_url( $s, 'banner_image' );

		echo '<section class="mzk-pk-banner">';

		if ( $image ) {
			printf(
				'<div class="mzk-pk-banner__bg"><img src="%s" alt="" fetchpriority="high" /></div>',
				esc_url( $image )
			);
		}

		echo '<div class="mzk-pk-banner__content"><div class="mzk-pk-banner__box">';
		$this->line( 'span', 'mzk-pk__eyebrow mzk-pk-banner__eyebrow', $this->get( $s, 'banner_eyebrow' ) );
		$this->line( 'h1', 'mzk-pk-banner__title', $this->get( $s, 'banner_title' ) );
		$this->line( 'p', 'mzk-pk-banner__lede', $this->get( $s, 'banner_lede' ) );
		$this->line( 'p', 'mzk-pk-banner__text', $this->get( $s, 'banner_text' ) );

		$hasButton = '' !== trim( $this->get( $s, 'banner_button_text' ) );
		$hasLink   = '' !== trim( $this->get( $s, 'banner_more_text' ) ) && '' !== trim( $this->get( $s, 'banner_more_link' ) );

		if ( $hasButton || $hasLink ) {
			echo '<div class="mzk-pk-banner__actions">';
			$this->button( $s, 'banner_button' );
			$this->text_link( $s, 'banner_more', 'mzk-pk__link mzk-pk__link--light' );
			echo '</div>';
		}

		echo '</div></div></section>';
	}

	private function render_intro( $s ) {
		echo '<section class="mzk-pk-intro"><div class="mzk-pk__inner mzk-pk-intro__inner">';

		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'intro_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2 mzk-pk-intro__title', $this->get( $s, 'intro_title' ) );
		$this->rich( $this->get( $s, 'intro_body' ), 'mzk-pk__body mzk-pk-intro__body' );

		if ( '' !== trim( $this->get( $s, 'intro_more_text' ) ) && '' !== trim( $this->get( $s, 'intro_more_link' ) ) ) {
			echo '<div class="mzk-pk-intro__foot">';
			$this->text_link( $s, 'intro_more' );
			echo '</div>';
		}

		echo '</div></section>';
	}

	/**
	 * The picks.
	 *
	 * Every card is a real product, so the name, the price, the picture and the link stay right
	 * when the shop changes. A row pointing at a product that has since been deleted is skipped
	 * rather than drawn as an empty card, and the whole section is left out when none resolve.
	 */
	private function render_picks( $s ) {
		$cards = $this->resolve_product_rows( $s, 'picks' );

		if ( ! $cards ) {
			return;
		}

		$total = count( $cards );

		echo '<section class="mzk-pk-picks" id="mizuki-picks">';
		echo '<div class="mzk-pk-slider">';

		echo '<div class="mzk-pk__inner mzk-pk-picks__head">';

		echo '<div class="mzk-pk-picks__blurb">';
		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'picks_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2 mzk-pk-picks__title', $this->get( $s, 'picks_title' ) );
		$this->line( 'p', 'mzk-pk-picks__intro', $this->get( $s, 'picks_intro' ) );
		echo '</div>';

		/*
		 * The controls live inside .mzk-pk-slider with the track. The script finds which slider to
		 * scroll by walking up from what was clicked, so an arrow rendered outside the wrapper is
		 * an arrow that silently does nothing.
		 */
		echo '<div class="mzk-pk-picks__nav">';
		$this->text_link( $s, 'picks_all' );

		if ( $total > 1 ) {
			printf(
				'<div class="mzk-pk-picks__arrows">
					<span class="mzk-pk-picks__count" data-mzk-pk-count>%1$s</span>
					<button type="button" class="mzk-pk-picks__arrow mzk-pk-slider__prev" aria-label="%2$s">%3$s</button>
					<button type="button" class="mzk-pk-picks__arrow mzk-pk-slider__next" aria-label="%4$s">%5$s</button>
				</div>',
				esc_html( sprintf( '%02d / %02d', 1, $total ) ),
				esc_attr__( 'Previous pick', 'mizuki-booking' ),
				$this->chevron( 'left' ),  // phpcs:ignore WordPress.Security.EscapeOutput
				esc_attr__( 'Next pick', 'mizuki-booking' ),
				$this->chevron( 'right' )  // phpcs:ignore WordPress.Security.EscapeOutput
			);
		}
		echo '</div>';

		echo '</div>';

		echo '<div class="mzk-pk-slider__rail">';
		printf(
			'<ul class="mzk-pk-slider__track" tabindex="0" role="list" aria-label="%s">',
			esc_attr( $this->get( $s, 'picks_title', __( 'Products', 'mizuki-booking' ) ) )
		);

		foreach ( $cards as $card ) {
			$this->render_pick( $card['row'], $card['product'], $s );
		}

		echo '</ul>';

		$this->render_mobile_pagination( $s, $total );

		echo '</div>';

		echo '</div>';

		if ( '' !== trim( $this->get( $s, 'picks_button_text' ) ) ) {
			echo '<div class="mzk-pk__inner mzk-pk-picks__foot">';
			$this->button( $s, 'picks_button' );
			echo '</div>';
		}

		echo '</section>';
	}

	/**
	 * Where you are, on a phone.
	 *
	 * Two shapes for the same fact. Mizuki Picks writes it — "Swipe to explore, 01 / 05" — where
	 * the cards carry a description and the rail is long. Tools & Vases draws a dash per product,
	 * which reads at a glance on a short list of four and needs no counting.
	 */
	private function render_mobile_pagination( $s, $total ) {
		$swipe = $this->get( $s, 'picks_swipe' );

		if ( 'dashes' === $this->mobile_pagination() ) {
			echo '<div class="mzk-pk-picks__swipe mzk-pk-picks__swipe--dashes">';
			echo '<div class="mzk-pk-picks__dashes" data-mzk-pk-dashes aria-hidden="true">';

			for ( $i = 0; $i < $total; $i++ ) {
				printf(
					'<span class="mzk-pk-picks__dash" data-index="%d"%s></span>',
					(int) $i,
					0 === $i ? ' data-current="true"' : ''
				);
			}

			echo '</div>';

			if ( '' !== trim( $swipe ) ) {
				printf( '<span>%s</span>', esc_html( $swipe ) );
			}

			// Read out for anything that cannot see the dashes.
			printf(
				'<span class="mzk-pk-picks__reader" data-mzk-pk-count>%s</span>',
				esc_html( sprintf( '%02d / %02d', 1, $total ) )
			);

			echo '</div>';
			return;
		}

		if ( '' !== trim( $swipe ) ) {
			printf(
				'<div class="mzk-pk-picks__swipe"><span>%s</span><span data-mzk-pk-count>%s</span></div>',
				esc_html( $swipe ),
				esc_html( sprintf( '%02d / %02d', 1, $total ) )
			);
		}
	}

	private function render_pick( $row, $product, $s ) {
		$image = ! empty( $row['image']['url'] ) ? $row['image']['url'] : '';
		if ( ! $image ) {
			$image = wp_get_attachment_image_url( (int) $product->get_image_id(), 'large' );
		}

		$label = isset( $row['label'] ) ? trim( (string) $row['label'] ) : '';
		if ( '' === $label ) {
			$terms = get_the_terms( $product->get_id(), 'product_cat' );
			if ( $terms && ! is_wp_error( $terms ) ) {
				$first = reset( $terms );
				$label = $first->name;
			}
		}

		$text = '';

		if ( $this->cards_show_text() ) {
			$text = isset( $row['text'] ) ? trim( (string) $row['text'] ) : '';

			if ( '' === $text ) {
				// The short description is the shop's own one-liner, which is what this card wants.
				$text = trim( wp_strip_all_tags( (string) $product->get_short_description() ) );
			}
		}

		echo '<li class="mzk-pk-card">';
		printf( '<a class="mzk-pk-card__link" href="%s">', esc_url( $product->get_permalink() ) );

		if ( $image ) {
			printf(
				'<span class="mzk-pk-card__media"><img src="%s" alt="%s" loading="lazy" /></span>',
				esc_url( $image ),
				esc_attr( $product->get_name() )
			);
		}

		echo '<span class="mzk-pk-card__body">';

		if ( '' !== $label ) {
			printf( '<span class="mzk-pk__eyebrow mzk-pk-card__label">%s</span>', esc_html( $label ) );
		}

		printf( '<span class="mzk-pk-card__title">%s</span>', esc_html( $product->get_name() ) );

		if ( '' !== $text ) {
			printf( '<span class="mzk-pk-card__text">%s</span>', esc_html( $text ) );
		}

		if ( $this->shows_price( $s, 'picks', $row ) ) {
			$price = $product->get_price_html();
			if ( $price ) {
				// get_price_html() returns markup — del/ins for a sale — so it is filtered rather
				// than escaped, or a sale price arrives as visible tags.
				printf( '<span class="mzk-pk-card__price">%s</span>', wp_kses_post( $price ) );
			}
		}

		$cta = isset( $row['cta'] ) ? trim( (string) $row['cta'] ) : '';
		if ( '' !== $cta ) {
			printf(
				'<span class="mzk-pk__link mzk-pk-card__cta"><span>%s</span>%s</span>',
				esc_html( $cta ),
				$this->arrow() // phpcs:ignore WordPress.Security.EscapeOutput -- a fixed SVG.
			);
		}

		echo '</span></a></li>';
	}

	private function render_faq( $s ) {
		$faqs = $this->rows( $s, 'faqs' );

		echo '<section class="mzk-pk-faq"><div class="mzk-pk__inner mzk-pk-faq__inner">';

		echo '<div class="mzk-pk-faq__head">';
		$this->line( 'span', 'mzk-pk__eyebrow', $this->get( $s, 'faq_eyebrow' ) );
		$this->line( 'h2', 'mzk-pk__h2', $this->get( $s, 'faq_title' ) );
		$this->line( 'p', 'mzk-pk__body', $this->get( $s, 'faq_intro' ) );
		echo '</div>';

		if ( $faqs ) {
			echo '<div class="mzk-pk-faq__list">';

			$group = 'mzk-pk-faq-' . $this->get_id();

			foreach ( $faqs as $index => $faq ) {
				$question = isset( $faq['q'] ) ? trim( (string) $faq['q'] ) : '';
				$answer   = isset( $faq['a'] ) ? trim( (string) $faq['a'] ) : '';

				if ( '' === $question ) {
					continue;
				}

				// The first answer is open, so the section does not read as a wall of shut doors.
				$open = 0 === $index;
				$id   = $group . '-' . (int) $index;

				echo '<div class="mzk-pk-faq__item">';
				printf(
					'<button type="button" class="mzk-pk-faq__q" aria-expanded="%1$s" aria-controls="%2$s">
						<span>%3$s</span>
						<span class="mzk-pk-faq__mark">
							<span class="mzk-pk-faq__plus"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
							<span class="mzk-pk-faq__minus"><svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg></span>
						</span>
					</button>',
					$open ? 'true' : 'false',
					esc_attr( $id ),
					esc_html( $question )
				);

				printf(
					'<div class="mzk-pk-faq__a" id="%1$s" data-open="%2$s"><div><p>%3$s</p></div></div>',
					esc_attr( $id ),
					$open ? 'true' : 'false',
					esc_html( $answer )
				);

				echo '</div>';
			}

			echo '</div>';
		}

		if ( '' !== trim( $this->get( $s, 'faq_more_text' ) ) && '' !== trim( $this->get( $s, 'faq_more_link' ) ) ) {
			echo '<div class="mzk-pk-faq__foot">';
			$this->text_link( $s, 'faq_more' );
			echo '</div>';
		}

		echo '</div></section>';
	}

	/** The bar that follows you down a phone. Needs somewhere to go, or it is a dead button. */
	private function render_sticky( $s ) {
		$text = $this->get( $s, 'sticky_button_text' );
		$link = $this->get( $s, 'sticky_button_link' );

		if ( '' === trim( $text ) || '' === trim( $link ) ) {
			return;
		}

		printf(
			'<div class="mzk-pk-sticky" data-mzk-pk-sticky hidden><a class="mzk-pk-sticky__btn" href="%s">%s</a></div>',
			esc_url( $link ),
			esc_html( $text )
		);
	}
}
