import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveWooProduct } from './wooProductService.js'

afterEach(() => vi.unstubAllGlobals())

describe('WooCommerce product links', () => {
  it('resolves the internal product id and current price from WordPress', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 421,
          name: 'Seasonal Bouquet Workshop',
          url: 'http://localhost:8080/product/seasonal-bouquet/',
          priceText: 'S$128.00',
          purchasable: true,
          inStock: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const product = await resolveWooProduct('http://localhost:8080/product/seasonal-bouquet/')

    expect(product).toMatchObject({ id: 421, priceText: 'S$128.00' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/wp-json/mizuki/v1/product')
  })

  it('refuses links from another website before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveWooProduct('https://example.com/product/not-mizuki/')).rejects.toMatchObject({
      code: 'invalid_product_link',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
