import { AppError } from '../errors.js'
import { config } from '../config.js'
import { CourseTypeModel, type CourseTypeDoc } from '../models/index.js'
import { logger } from '../logger.js'

export interface WooProductDetails {
  id: number
  name: string
  url: string
  priceText: string
  productType: string
  purchasable: boolean
  inStock: boolean
}

async function fetchProductDetails(site: URL, key: 'url' | 'id', value: string): Promise<WooProductDetails> {
  const rest = new URL('/wp-json/mizuki/v1/product', site)
  rest.searchParams.set(key, value)
  const ajax = new URL('/wp-admin/admin-ajax.php', site)
  ajax.searchParams.set('action', 'mizuki_product')
  ajax.searchParams.set(key, value)

  let response: Response | undefined
  for (const endpoint of [rest, ajax]) {
    try {
      response = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      })
    } catch {
      response = undefined
    }
    // A site security rule may block every public REST request before the plugin sees it.
    if (endpoint === rest && (!response || [401, 403, 404].includes(response.status))) continue
    break
  }

  if (!response) {
    throw new AppError(502, 'shop_unreachable', 'The shop could not be reached. Check that the latest Mizuki Booking plugin is active, then try again.')
  }
  const body = (await response.json().catch(() => null)) as Partial<WooProductDetails> | null
  if (!response.ok || !body || !Number.isInteger(body.id) || !body.url) {
    throw new AppError(422, 'product_not_found', 'That link did not resolve to a WooCommerce product. Open the product in WordPress and copy its public page link.')
  }
  if (!body.purchasable || !body.inStock) {
    throw new AppError(422, 'product_not_purchasable', 'That WooCommerce product is not currently available for purchase.')
  }
  return {
    id: Number(body.id),
    name: body.name ?? '',
    url: body.url,
    priceText: body.priceText ?? '',
    productType: body.productType ?? '',
    purchasable: Boolean(body.purchasable),
    inStock: Boolean(body.inStock),
  }
}

/**
 * Ask the WordPress bridge to resolve a product page.
 *
 * WooCommerce product ids remain the reliable order identifier, but the studio never has to
 * find or type one. The pasted product page is restricted to the configured WordPress origin so
 * this API cannot be used to fetch arbitrary internet addresses.
 */
export async function resolveWooProduct(productUrl: string): Promise<WooProductDetails> {
  let supplied: URL
  let site: URL
  try {
    supplied = new URL(productUrl)
    site = new URL(config.PUBLIC_SITE_URL)
  } catch {
    throw new AppError(422, 'invalid_product_link', 'Enter the full WooCommerce product link.')
  }

  if (supplied.origin !== site.origin) {
    throw new AppError(422, 'invalid_product_link', `Use a product link from ${site.hostname}.`)
  }

  return fetchProductDetails(site, 'url', supplied.toString())
}

async function resolveWooProductId(productId: number): Promise<WooProductDetails> {
  const site = new URL(config.PUBLIC_SITE_URL)
  return fetchProductDetails(site, 'id', String(productId))
}

export async function productPatchFromUrl(productUrl: string, requireSimple = false) {
  const trimmed = productUrl.trim()
  if (!trimmed) {
    return { wooProductUrl: '', wooProductIds: [], wooProductName: '', wooPriceText: '' }
  }

  const product = await resolveWooProduct(trimmed)
  if (requireSimple && product.productType !== 'simple') {
    throw new AppError(422, 'simple_product_required', 'Use a simple WooCommerce product for calendar workshops. The date, time and number of places are selected in the booking calendar.')
  }
  return {
    wooProductUrl: product.url,
    wooProductIds: [product.id],
    wooProductName: product.name,
    wooPriceText: product.priceText,
  }
}

const productCache = new Map<string, { expiresAt: number; product: WooProductDetails }>()

async function cachedWooProduct(key: string, load: () => Promise<WooProductDetails>): Promise<WooProductDetails> {
  const cached = productCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.product

  const product = await load()
  productCache.set(key, { expiresAt: Date.now() + 5 * 60_000, product })
  return product
}

/**
 * Refresh public price snapshots from WordPress without making the calendar depend on the shop.
 * A shop outage leaves the last known price visible; a working shop is checked at most once every
 * five minutes per product page.
 */
export async function refreshWooProductSnapshots<T extends Pick<CourseTypeDoc, '_id' | 'bookingMode' | 'wooProductUrl' | 'wooProductIds' | 'wooProductName' | 'wooPriceText'>>(
  courses: T[],
): Promise<void> {
  if (config.isTest) return
  await Promise.all(
    courses.map(async (course) => {
      if (course.bookingMode !== 'paid' || (!course.wooProductUrl && !course.wooProductIds[0])) return
      try {
        const product = course.wooProductUrl
          ? await cachedWooProduct(course.wooProductUrl, () => resolveWooProduct(course.wooProductUrl))
          : await cachedWooProduct(`id:${course.wooProductIds[0]}`, () => resolveWooProductId(course.wooProductIds[0]!))
        course.wooProductIds = [product.id] as T['wooProductIds']
        course.wooProductUrl = product.url as T['wooProductUrl']
        course.wooProductName = product.name as T['wooProductName']
        course.wooPriceText = product.priceText as T['wooPriceText']
        await CourseTypeModel.updateOne(
          { _id: course._id },
          {
            $set: {
              wooProductIds: [product.id],
              wooProductUrl: product.url,
              wooProductName: product.name,
              wooPriceText: product.priceText,
            },
          },
        )
      } catch (err) {
        logger.warn({ err, courseId: String(course._id) }, 'Could not refresh WooCommerce product details')
      }
    }),
  )
}
