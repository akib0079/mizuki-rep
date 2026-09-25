# Booking system update for Mizuki

Hi Mizuki,

Thank you for explaining the issues so clearly. I have updated the booking system to support the two booking journeys you need.

## Course bookings

Course students can continue choosing their lesson dates without paying through the calendar.

To correct a course name, open the studio console, choose **Courses**, select the course, edit **Course or workshop name**, then save. Normal future calendar entries using the old course name are updated automatically. Any class with a special custom title keeps its own title.

To connect a new workshop to the shop, open its public WooCommerce product page and copy the page link. In the studio console, open **Settings**, then **Courses**, and paste the link under **Shop product link**. The booking system automatically finds the internal product code, product name, and current WooCommerce price. It clearly shows **Not on sale yet** until a valid product link is connected.

Booking alerts now go to every active studio administrator and any additional alert address configured in the console. The **Alerts to you** section shows the recipients, the latest successful booking alert, queued messages, and whether scheduled work is running.

Students receive an email as soon as their place is confirmed. When a booking needs manual payment approval, they first receive a message explaining that their place is reserved, followed by the confirmation after approval. The email settings screen now checks the sending domain and displays recent delivery failures so an email configuration problem is visible immediately.

## Workshop bookings

Workshop customers can now choose an available date and time in the calendar, see the current WooCommerce price, select the number of participants, reserve those places, continue directly to WooCommerce checkout, and receive an automatic confirmation after payment.

An email address is still required so the customer can receive the payment receipt, booking confirmation, and reminder. Workshop customers do not have to choose a password or sign in.

Each workshop session has its own participant limit. This means a Saturday session can have eight places while a Sunday session has five. One customer can select up to the available number of participants and pay for the group in one order. Every selected place is temporarily reserved during checkout and released automatically when checkout is abandoned. The system checks the full group against the remaining capacity so a session cannot become overbooked.

To create a workshop, open **Calendar**, choose the required date, then select **Add a class**. Choose the workshop, set its title, time, duration, and class size. Repeat this for each seasonal or regular date. You can open any existing session from the calendar to change its participant limit.

To add a new workshop type, open **Settings**, choose **Add a course**, select **In the shop**, then enter the workshop name, WooCommerce product page link, normal duration, and default class size. The default size is used for new sessions and can still be changed for each individual date.

Students receive an automatic reminder two calendar days before the workshop. Workshop booking and reminder messages include the following policy:

> No refunds are available within 48 hours of the workshop. If you need to reschedule or have a question, please contact us on WhatsApp at +65 8821 9386.

The same policy is shown before the customer continues to payment. Refund and rescheduling requests remain manual through WhatsApp, as requested.

Thank you again for the detailed feedback. These controls are designed so regular and seasonal workshops can be maintained from the studio console without changing the website code.
