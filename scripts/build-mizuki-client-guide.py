from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak,
    Table, TableStyle, KeepTogether, HRFlowable
)
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / 'docs/client-response'
OUT = ROOT / 'output/pdf/mizuki-booking-system-client-guide.pdf'
PAGE_W, PAGE_H = A4

INK = colors.HexColor('#17242A')
MUTED = colors.HexColor('#64717A')
TEAL = colors.HexColor('#07859A')
TEAL_DARK = colors.HexColor('#075463')
PALE = colors.HexColor('#EAF7F8')
SOFT = colors.HexColor('#F5F7F8')
LINE = colors.HexColor('#DCE4E7')
WHITE = colors.white
GREEN = colors.HexColor('#1A8D70')

regular = '/System/Library/Fonts/Supplemental/Arial.ttf'
bold = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
pdfmetrics.registerFont(TTFont('MizukiRegular', regular))
pdfmetrics.registerFont(TTFont('MizukiBold', bold))

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='KickerM', fontName='MizukiBold', fontSize=8, leading=10,
                          textColor=TEAL, tracking=1.3, spaceAfter=7))
styles.add(ParagraphStyle(name='TitleM', fontName='MizukiBold', fontSize=30, leading=34,
                          textColor=INK, spaceAfter=12))
styles.add(ParagraphStyle(name='SubtitleM', fontName='MizukiRegular', fontSize=12, leading=18,
                          textColor=MUTED, spaceAfter=18))
styles.add(ParagraphStyle(name='H1M', fontName='MizukiBold', fontSize=21, leading=25,
                          textColor=INK, spaceAfter=9))
styles.add(ParagraphStyle(name='H2M', fontName='MizukiBold', fontSize=12.5, leading=16,
                          textColor=INK, spaceBefore=5, spaceAfter=5))
styles.add(ParagraphStyle(name='BodyM', fontName='MizukiRegular', fontSize=9.5, leading=14.5,
                          textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name='SmallM', fontName='MizukiRegular', fontSize=8.2, leading=11.5,
                          textColor=MUTED, spaceAfter=4))
styles.add(ParagraphStyle(name='BulletM', fontName='MizukiRegular', fontSize=9.2, leading=13.5,
                          textColor=INK, leftIndent=13, firstLineIndent=-9, bulletIndent=0, spaceAfter=4))
styles.add(ParagraphStyle(name='AnswerM', fontName='MizukiRegular', fontSize=9.2, leading=13.5,
                          textColor=INK, spaceAfter=0))
styles.add(ParagraphStyle(name='CardTitleM', fontName='MizukiBold', fontSize=10.2, leading=13,
                          textColor=TEAL_DARK, spaceAfter=3))
styles.add(ParagraphStyle(name='PolicyM', fontName='MizukiBold', fontSize=10.2, leading=15,
                          textColor=TEAL_DARK, alignment=TA_LEFT))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(18*mm, 14*mm, PAGE_W - 18*mm, 14*mm)
    canvas.setFont('MizukiRegular', 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18*mm, 9*mm, 'Mizuki booking system update  |  Prepared by Avix Digital')
    canvas.drawRightString(PAGE_W - 18*mm, 9*mm, str(doc.page))
    canvas.restoreState()


def shot(filename, max_w=174*mm, max_h=112*mm):
    path = MEDIA / filename
    with PILImage.open(path) as im:
        w, h = im.size
    scale = min(max_w / w, max_h / h)
    img = Image(str(path), width=w*scale, height=h*scale)
    img.hAlign = 'CENTER'
    frame = Table([[img]], colWidths=[w*scale + 6*mm])
    frame.hAlign = 'CENTER'
    frame.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WHITE),
        ('BOX', (0,0), (-1,-1), 0.65, LINE),
        ('LEFTPADDING', (0,0), (-1,-1), 3*mm),
        ('RIGHTPADDING', (0,0), (-1,-1), 3*mm),
        ('TOPPADDING', (0,0), (-1,-1), 3*mm),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3*mm),
    ]))
    return frame


def callout(title, body, color=PALE):
    cell = [Paragraph(title, styles['CardTitleM']), Paragraph(body, styles['AnswerM'])]
    table = Table([[cell]], colWidths=[170*mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), color),
        ('BOX', (0,0), (-1,-1), 0.6, LINE),
        ('LEFTPADDING', (0,0), (-1,-1), 6*mm),
        ('RIGHTPADDING', (0,0), (-1,-1), 6*mm),
        ('TOPPADDING', (0,0), (-1,-1), 5*mm),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5*mm),
    ]))
    return table


def bullets(items):
    return [Paragraph(f'{i + 1}. {text}', styles['BulletM']) for i, text in enumerate(items)]


def section_title(number, title, intro=None):
    parts = [Paragraph(f'{number:02d}  {title}', styles['H1M'])]
    if intro:
        parts.append(Paragraph(intro, styles['SubtitleM']))
    return parts


doc = SimpleDocTemplate(
    str(OUT), pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm, topMargin=18*mm, bottomMargin=20*mm,
    title='Mizuki Booking System Client Guide',
    subject='Course and workshop booking system update',
    author='Avix Digital',
)

story = []

# Cover
story += [
    Spacer(1, 12*mm),
    Paragraph('MIZUKI FLORA  /  CLIENT GUIDE', styles['KickerM']),
    Paragraph('Booking system update', styles['TitleM']),
    Paragraph('Course bookings remain simple for enrolled students. Workshop customers can now choose a session, see the live WooCommerce price, select several participants, and continue directly to payment.', styles['SubtitleM']),
    HRFlowable(width='100%', thickness=1, color=LINE, spaceBefore=2*mm, spaceAfter=8*mm),
    callout('Course booking', 'Students with a course package continue booking lesson dates through the calendar. Individual lesson payment is not required.'),
    Spacer(1, 4*mm),
    callout('Workshop booking', 'Guests enter an email for the confirmation and reminder, but they do not create a password. One customer can reserve and pay for several participants.'),
    Spacer(1, 8*mm),
    Paragraph('The client questions answered', styles['H2M']),
]
story += bullets([
    '<b>Email:</b> Required for the booking confirmation, payment receipt, and reminder. No workshop password is required.',
    '<b>Price:</b> Imported from the connected WooCommerce product and shown automatically in the calendar and booking form.',
    '<b>Several participants:</b> One customer can choose the group size. The system reserves that exact number of places.',
    '<b>Payment:</b> Continue to payment now opens the connected product and proceeds through WooCommerce checkout.',
])
story += [
    Spacer(1, 8*mm),
    Paragraph('Updated 25 September 2026', styles['SmallM']),
    PageBreak(),
]

# Names and product link
story += section_title(1, 'Course names and WooCommerce connection', 'The studio controls course names and product connections from the console.')
story += [
    Paragraph('<b>Change a name</b> from Courses. Select the course, edit Course or workshop name, then select Save changes. Future classes using the original name update automatically. A class with a custom title keeps that title.', styles['BodyM']),
    shot('guide-01-change-course-name.jpg', max_h=65*mm),
    Spacer(1, 5*mm),
    Paragraph('<b>Connect a workshop product</b> from Settings. Paste the public WooCommerce product page into Shop product link. The system finds the internal product code, product name, and current price automatically.', styles['BodyM']),
    shot('guide-02-shop-product-link.jpg', max_h=88*mm),
    PageBreak(),
]

# Alerts
story += section_title(2, 'Booking alert recipients', 'Every active administrator receives alerts. Extra addresses can receive alerts without console access.')
story += [
    Paragraph('Open Team and look under Where booking alerts go. Use Edit extra addresses to add a recipient. Use Remove beside an extra address when it should stop receiving alerts.', styles['BodyM']),
    Paragraph('This routing applies to IFDA, Ikebana, Fresh Flower, Preserved Flower, Bouquet, and every new course or workshop added later.', styles['BodyM']),
    shot('guide-03-booking-alerts.jpg', max_h=132*mm),
    PageBreak(),
]

# Emails
story += section_title(3, 'Confirmation and reminder emails', 'The message follows the type and status of the booking.')
story += bullets([
    'A course student receives confirmation when the course booking is completed.',
    'A workshop place is held during WooCommerce checkout. Confirmation is sent only after payment is accepted.',
    'A reminder is sent automatically two days before the class.',
    'The confirmation includes a calendar invitation.',
    'Workshop messages include the participant count and workshop policy.',
])
email_imgs = Table([
    [shot('06-student-confirmation.jpg', max_w=82*mm, max_h=88*mm), shot('07-two-day-reminder.jpg', max_w=82*mm, max_h=88*mm)],
    [Paragraph('Booking confirmation', styles['SmallM']), Paragraph('Automatic two day reminder', styles['SmallM'])]
], colWidths=[86*mm,86*mm])
email_imgs.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(0,0),(-1,-1),'CENTER')]))
story += [email_imgs, Spacer(1, 4*mm), callout('Email health check', 'Open Settings, then Connected services. The status shows whether sending is ready. Test email key confirms delivery before accepting live bookings.', SOFT), PageBreak()]

# Workshop creation
story += section_title(4, 'Create regular and seasonal workshops', 'Create the workshop once, then add each available session to the calendar.')
story += [
    Paragraph('In Settings, add the workshop as Shop payment and paste its WooCommerce product page link. In Courses, add the description and student information.', styles['BodyM']),
    Paragraph('For every available time, open Calendar and select Add class. Choose the workshop, then set the date, start time, duration, participant limit, and title.', styles['BodyM']),
    shot('guide-04-create-workshop-session.jpg', max_h=135*mm),
    PageBreak(),
]

# Capacity
story += section_title(5, 'Set capacity for each session', 'Each workshop session has its own participant limit.')
story += [
    Paragraph('Open the session from the calendar and use Class size. A morning session can have eight places while an afternoon session has twelve.', styles['BodyM']),
    Paragraph('Held back reserves places for WhatsApp or manual bookings. Those places are not offered online.', styles['BodyM']),
    Paragraph('When a customer chooses three participants, three places are reserved together. The complete group is checked against the remaining capacity before checkout starts.', styles['BodyM']),
    shot('guide-05-session-capacity.jpg', max_h=130*mm),
    PageBreak(),
]

# Customer flow
story += section_title(6, 'Workshop customer experience', 'The booking form now contains every detail needed before payment.')
story += bullets([
    'Choose an available date and time.',
    'See the current WooCommerce price and remaining availability.',
    'Choose the number of participants and optionally add their names.',
    'Enter contact details with no password or sign in step.',
    'Continue directly to WooCommerce checkout.',
    'Receive confirmation after payment and a reminder two days before the workshop.',
])
story += [
    shot('guide-06-workshop-booking.jpg', max_h=119*mm),
    PageBreak(),
]

# Policy and delivery
story += section_title(7, 'Workshop policy and payment protection', 'The requested policy appears before payment and in the confirmation and reminder emails.')
policy = Table([[Paragraph('No refunds are available within 48 hours of the workshop. If you need to reschedule or have a question, please contact us on WhatsApp at +65 8821 9386.', styles['PolicyM'])]], colWidths=[168*mm])
policy.setStyle(TableStyle([
    ('BACKGROUND',(0,0),(-1,-1),PALE),('BOX',(0,0),(-1,-1),0.8,TEAL),
    ('LEFTPADDING',(0,0),(-1,-1),8*mm),('RIGHTPADDING',(0,0),(-1,-1),8*mm),
    ('TOPPADDING',(0,0),(-1,-1),8*mm),('BOTTOMPADDING',(0,0),(-1,-1),8*mm),
]))
story += [
    policy,
    Spacer(1, 8*mm),
    Paragraph('Payment protection', styles['H2M']),
    Paragraph('The booking system holds the selected places while the customer pays. The actual WooCommerce product link is used, the correct quantity is placed in the cart, and the customer proceeds to checkout. If payment is abandoned, the held places return to availability automatically.', styles['BodyM']),
    Spacer(1, 4*mm),
    Paragraph('What the studio needs to do', styles['H2M']),
]
story += bullets([
    'Install Mizuki Booking Bridge version 1.18.0 in WordPress.',
    'Open Settings in the Mizuki Studio console.',
    'Paste each workshop product page into Shop product link.',
    'Confirm the price shown beside the product name.',
    'Run one live low value or test mode WooCommerce order before public launch.',
])
story += [
    Spacer(1, 8*mm),
    callout('Ready for use', 'The course journey, workshop journey, participant capacity, payment handoff, confirmation, reminder, alert routing, and workshop policy are included in the latest system and WordPress plugin package.', SOFT),
]

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
