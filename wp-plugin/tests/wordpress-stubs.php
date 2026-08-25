<?php
/* Just enough WordPress and Elementor to load the plugin and watch it fall over. */
define( 'ABSPATH', '/tmp/fake-wp/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );

$GLOBALS['hooks'] = array();
$GLOBALS['did']   = array( 'elementor/loaded' => 1 );

function add_action( $hook, $cb, $prio = 10, $args = 1 ) { $GLOBALS['hooks'][ $hook ][] = $cb; }
function add_filter( $hook, $cb, $prio = 10, $args = 1 ) { $GLOBALS['hooks'][ $hook ][] = $cb; }
function do_action( $hook, ...$a ) { foreach ( $GLOBALS['hooks'][ $hook ] ?? array() as $cb ) { $cb( ...$a ); } }
function did_action( $hook ) { return $GLOBALS['did'][ $hook ] ?? 0; }
function add_shortcode( $tag, $cb ) {}
function shortcode_atts( $pairs, $atts, $tag = '' ) { return array_merge( $pairs, (array) $atts ); }
function register_activation_hook( $f, $cb ) {}
function register_deactivation_hook( $f, $cb ) {}
function plugin_dir_path( $f ) { return dirname( $f ) . '/'; }
function plugin_dir_url( $f ) { return 'https://example.test/wp-content/plugins/' . basename( dirname( $f ) ) . '/'; }
function get_option( $k, $d = false ) { return empty( $GLOBALS['no_api'] ) ? array( 'api_base' => 'https://api.mizuki.com.sg', 'webhook_secret' => 'x' ) : array(); }
function update_option( $k, $v ) {}
function get_transient( $k ) { return false; }
function set_transient( $k, $v, $t ) {}
function delete_transient( $k ) {}
function wp_remote_get( $u, $a = array() ) { if ( ! empty( $GLOBALS['api_down'] ) ) { return new \WP_Error(); } return array( 'response' => array( 'code' => 200 ), 'body' => '{"courses":[{"slug":"ifda","name":"IFDA"}]}' ); }
function wp_remote_retrieve_response_code( $r ) { return $r['response']['code']; }
function wp_remote_retrieve_body( $r ) { return $r['body']; }
class WP_Error {}
function is_wp_error( $t ) { return $t instanceof WP_Error; }
function wp_register_script( ...$a ) {}
function wp_enqueue_script( ...$a ) {}
function wp_json_encode( $v ) { return json_encode( $v ); }
function esc_attr( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function esc_html( $v ) { return htmlspecialchars( (string) $v, ENT_QUOTES ); }
function esc_url_raw( $v ) { return $v; }
function esc_url( $v ) { return $v; }
function esc_html__( $t, $d = '' ) { return $t; }
function esc_html_e( $t, $d = '' ) { echo $t; }
function __( $t, $d = '' ) { return $t; }
function _e( $t, $d = '' ) { echo $t; }
function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_textarea_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_title( $v ) { return strtolower( preg_replace( '/[^A-Za-z0-9_-]/', '', (string) $v ) ); }
function sanitize_key( $v ) { return strtolower( (string) $v ); }
function current_user_can( $c ) { return true; }
function settings_fields( $g ) {}
function do_settings_sections( $g ) {}
function submit_button( ...$a ) {}
function register_setting( ...$a ) {}
function add_settings_field( ...$a ) {}
function add_settings_section( ...$a ) {}
function add_options_page( ...$a ) {}
function add_menu_page( ...$a ) {}
function admin_url( $p = '' ) { return 'https://example.test/wp-admin/' . $p; }
function wp_unslash( $v ) { return $v; }
function wp_nonce_field( ...$a ) {}
function selected( $a, $b, $e = true ) {}
function checked( $a, $b, $e = true ) {}
function get_bloginfo( $s ) { return 'Test'; }
function home_url( $p = '' ) { return 'https://example.test' . $p; }
function wc_get_order( $id ) { return null; }
function is_admin() { return true; }
function wp_kses_post( $v ) { return $v; }
function tag_escape( $v ) { return strtolower( preg_replace( '/[^a-zA-Z0-9_:]/', '', (string) $v ) ); }
function absint( $v ) { return abs( (int) $v ); }
function filemtime_safe( $p ) { return 0; }
function trailingslashit( $p ) { return rtrim( $p, '/' ) . '/'; }
function apply_filters( $h, $v, ...$a ) { return $v; }
function wp_die( $m = '' ) { throw new RuntimeException( 'wp_die: ' . $m ); }

function untrailingslashit( $p ) { return rtrim( (string) $p, '/\\' ); }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function wp_http_validate_url( $u ) { return $u; }
function get_bloginfo_rss( $s ) { return ''; }
function wp_strip_all_tags( $v ) { return strip_tags( (string) $v ); }
function maybe_unserialize( $v ) { return $v; }

/*
 * Five that the plugin reaches for and this file did not have.
 *
 * Their absence never showed as a missing-function error, because the widgets catch a Throwable
 * while drawing and log it — containment doing its job, and hiding the gap while it did. The
 * section simply did not appear. So the harness now covers every WordPress function the plugin
 * calls, and there is a test below that keeps it that way.
 */
function esc_attr__( $t, $d = null ) { return htmlspecialchars( (string) $t, ENT_QUOTES ); }
function get_post_meta( $id, $key = '', $single = false ) { return $single ? '' : array(); }
function wp_date( $format, $timestamp = null, $tz = null ) { return gmdate( $format, $timestamp ?: time() ); }
function wp_register_style( $h, $s = '', $d = array(), $v = false, $m = 'all' ) { return true; }
function wp_remote_post( $url, $args = array() ) { return array( 'response' => array( 'code' => 200 ), 'body' => '{}' ); }
