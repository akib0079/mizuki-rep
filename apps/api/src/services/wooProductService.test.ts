import { afterEach, describe, expect, it, vi } from 'vitest'
import { productPatchFromUrl, resolveWooProduct } from './wooProductService.js'

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
          productType: 'simple',
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

  it('uses the public AJAX action when site security blocks public REST', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'rest_api_authentication_required' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 3061,
        name: 'Workshop ticket',
        url: 'http://localhost:8080/product/workshop-ticket/',
        priceText: 'S$90.00',
        productType: 'simple',
        purchasable: true,
        inStock: true,
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const product = await productPatchFromUrl('http://localhost:8080/product/workshop-ticket/', true)
    expect(product).toMatchObject({ wooProductIds: [3061], wooPriceText: 'S$90.00' })
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/wp-admin/admin-ajax.php?action=mizuki_product')
  })

  it('rejects a variable product for direct calendar checkout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 3060,
      name: 'Autumn Ikebana Workshop',
      url: 'http://localhost:8080/product/ikebana/',
      priceText: 'S$90.00',
      productType: 'variable',
      purchasable: true,
      inStock: true,
    }), { status: 200 })))

    await expect(productPatchFromUrl('http://localhost:8080/product/ikebana/', true)).rejects.toMatchObject({
      code: 'simple_product_required',
    })
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
