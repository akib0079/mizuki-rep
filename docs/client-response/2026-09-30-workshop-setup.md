# Workshop setup for Mizuki Flora

## Current setup

Product 2170, Preserved Flower Trial Workshop, is published in WooCommerce as a Simple, Virtual product at S$100. WooCommerce product stock management and the single item purchase limit are off. The Mizuki calendar booking flag is on, so the product cannot be bought without choosing a class and participant count in the booking calendar. The Studio course uses Calendar then payment and defaults to six places per class. The Studio course remains archived until the studio confirms the first dates to sell.

Product 3082 remains the reusable seasonal product. It is saved as a WordPress draft, and the corresponding Studio course is archived. Visitors cannot book or buy it while it is inactive. Its existing variable prices and old Bouquet Series content have been preserved for editing when the next workshop is announced.

## Publish Preserved Flower dates

1. Open [Studio Calendar](https://api.mizuki.com.sg/admin/calendar) and choose **Add class**.
2. Choose **Preserved Flower Trial Workshop** and enter a confirmed date. The usual days are Tuesday, Wednesday and Thursday.
3. For an afternoon class enter **14:00** and **210 minutes**. For an evening class enter **19:00** and **150 minutes**.
4. Set **Class size** to **6**. Use a descriptive title if the session is specifically for a hairpin or boutonniere.
5. Add each date that is ready to sell. Open any class on the calendar to adjust its time or class size. Delete an empty class when it will not run. If students have already booked, cancel or reschedule the class and notify them instead of deleting their record.
6. Open [Studio Settings](https://api.mizuki.com.sg/admin/settings) and select **Restore** for Preserved Flower Trial Workshop. Check the public [booking calendar](https://mizuki.com.sg/book-a-class/) before announcing the dates.

## Reuse product 3082 for a seasonal workshop

1. In [WordPress product 3082](https://mizuki.com.sg/wp-admin/post.php?post=3082&action=edit), replace the old title, details and date options. Keep the product as a draft while preparing it.
2. For calendar checkout, use a **Simple, Virtual** product with one fixed ticket price. Turn off WooCommerce stock management and **Sold individually**, then enable **Calendar booking product**. The separate limit for each class is managed in Studio. The current Variable product configuration cannot use the calendar checkout route.
3. Publish the product when the title, price and details are ready.
4. In [Studio Courses](https://api.mizuki.com.sg/admin/courses), rename the archived Bouquet course to the current workshop name and update its description.
5. In [Studio Settings](https://api.mizuki.com.sg/admin/settings), keep the product link mapped to product 3082, select **Calendar then payment**, set the default class size, and restore the course.
6. Add the confirmed dates, times and separate capacities in Studio Calendar, then check the public calendar and complete a checkout test before promotion.

If two seasonal workshops with different prices are on sale at the same time, create separate Simple products and Studio courses. Reusing one product while both are on sale would apply the current product price to both.

## Verification and limits

On 30 September 2026, WordPress resolved product 2170 as Simple, purchasable, in stock and S$100. Its public page displayed the calendar booking link, and a direct add to cart attempt without a calendar hold left the cart empty. Product 3082 showed Draft in WordPress and returned HTTP 404 without an admin session. Studio settings showed product 2170 on Calendar then payment with a default class size of six, and product 3082 archived. No Preserved Flower date or real payment was published or placed during this check.
