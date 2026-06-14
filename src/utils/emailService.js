const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: Number(process.env.EMAIL_PORT || 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendVerificationCode(email, code) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Verify your SARA Wholesale Supplies account",
    html: `
      <div style="font-family:Arial,sans-serif;background:#f6f6f6;padding:24px;color:#111;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #ddd;">
          <h2 style="margin:0 0 8px;color:#062b63;">SARA Wholesale Supplies</h2>

          <p style="font-size:15px;line-height:1.6;margin:18px 0;">
            Thank you for registering with SARA Wholesale Supplies.
          </p>

          <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">
            Please use the verification code below to complete your account registration:
          </p>

          <div style="font-size:30px;font-weight:bold;letter-spacing:4px;color:#062b63;background:#f3f6fb;padding:14px;text-align:center;margin:20px 0;">
            ${code}
          </div>

          <p style="font-size:14px;color:#555;line-height:1.6;">
            This code will expire in 10 minutes. If you did not request this, please ignore this email.
          </p>

          <p style="font-size:14px;line-height:1.6;margin-top:24px;">
            Kind regards,<br>
            <strong>SARA Wholesale Supplies Team</strong>
          </p>
        </div>
      </div>
    `,
  });
}

async function sendRegistrationSuccess(email, name) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Your SARA Wholesale Supplies account is verified",
    html: `
      <div style="font-family:Arial,sans-serif;background:#f6f6f6;padding:24px;color:#111;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #ddd;">
          <h2 style="margin:0 0 8px;color:#062b63;">SARA Wholesale Supplies</h2>

          <p style="font-size:15px;line-height:1.6;margin:18px 0;">
            Dear ${name || "Customer"},
          </p>

          <p style="font-size:15px;line-height:1.6;">
            Your account has been successfully verified.
          </p>

          <p style="font-size:15px;line-height:1.6;">
            You can now log in to your account, browse products, and submit order requests.
          </p>

          <p style="font-size:14px;line-height:1.6;margin-top:24px;">
            Kind regards,<br>
            <strong>SARA Wholesale Supplies Team</strong>
          </p>
        </div>
      </div>
    `,
  });
}

async function sendOrderRequestEmail({
  email,
  customerName,
  customerPhone,
  orderRequestNumber,
  subtotal,
  items,
}) {
  const itemHtml = items
    .map((item) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.unit_price || 0);

      return `
        <tr>
          <td style="padding:12px;border:1px solid #d9d9d9;">
            ${item.product_name}
          </td>
          <td style="padding:12px;border:1px solid #d9d9d9;text-align:center;">
            ${item.sku || "-"}
          </td>
          <td style="padding:12px;border:1px solid #d9d9d9;text-align:center;">
            ${qty}
          </td>
          <td style="padding:12px;border:1px solid #d9d9d9;text-align:right;">
            £${price.toFixed(2)}
          </td>
          <td style="padding:12px;border:1px solid #d9d9d9;text-align:right;">
            £${(qty * price).toFixed(2)}
          </td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <div style="background:#f6f6f6;padding:24px;font-family:Arial,sans-serif;color:#111;">
      <div style="max-width:720px;margin:0 auto;background:#fff;padding:32px;border:1px solid #ddd;">

        <div style="border-bottom:4px solid #062b63;padding-bottom:18px;margin-bottom:30px;">
          <h1 style="margin:0;color:#062b63;font-size:34px;">SARA</h1>
          <p style="margin:4px 0 0;font-size:15px;font-weight:bold;color:#333;">
            WHOLESALE SUPPLIES
          </p>
          <p style="margin:8px 0 0;font-size:13px;color:#555;">
            Wholesale Packaging & Business Supplies
          </p>
        </div>

        <h2 style="margin:0 0 16px;font-size:24px;color:#111;">
          Order Request Received
        </h2>

        <p style="margin:0 0 18px;color:#15803d;font-size:16px;font-weight:bold;">
          Your request has been received and is currently being reviewed.
        </p>

        <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">
          Dear ${customerName || "Customer"},
          <br><br>
          Thank you for your order request. We will review your request and contact you if additional information is required.
        </p>

        <hr style="border:none;border-top:1px solid #ddd;margin:28px 0;">

        <h3 style="font-size:18px;margin:0 0 16px;">Order Information</h3>

        <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:28px;">
          <tr>
            <td style="padding:7px 0;font-weight:bold;width:220px;">Order Request No:</td>
            <td>${orderRequestNumber}</td>
          </tr>
          <tr>
            <td style="padding:7px 0;font-weight:bold;">Date:</td>
            <td>${new Date().toLocaleDateString("en-GB")}</td>
          </tr>
          <tr>
            <td style="padding:7px 0;font-weight:bold;">Status:</td>
            <td style="color:#15803d;font-weight:bold;">Request Submitted</td>
          </tr>
        </table>

        <hr style="border:none;border-top:1px solid #ddd;margin:28px 0;">

        <h3 style="font-size:18px;margin:0 0 16px;">Customer Details</h3>

        <table style="width:100%;border-collapse:collapse;font-size:15px;margin-bottom:28px;">
          <tr>
            <td style="padding:7px 0;font-weight:bold;width:220px;">Customer:</td>
            <td>${customerName || "-"}</td>
          </tr>
          <tr>
            <td style="padding:7px 0;font-weight:bold;">Email:</td>
            <td>${email || "-"}</td>
          </tr>
          <tr>
            <td style="padding:7px 0;font-weight:bold;">Phone:</td>
            <td>${customerPhone || "-"}</td>
          </tr>
        </table>

        <hr style="border:none;border-top:1px solid #ddd;margin:28px 0;">

        <h3 style="font-size:18px;margin:0 0 16px;">Order Summary</h3>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
          <thead>
            <tr style="background:#f3f3f3;">
              <th style="padding:12px;border:1px solid #d9d9d9;text-align:left;">Product</th>
              <th style="padding:12px;border:1px solid #d9d9d9;text-align:center;">SKU</th>
              <th style="padding:12px;border:1px solid #d9d9d9;text-align:center;">Qty</th>
              <th style="padding:12px;border:1px solid #d9d9d9;text-align:right;">Unit Price</th>
              <th style="padding:12px;border:1px solid #d9d9d9;text-align:right;">Total</th>
            </tr>
          </thead>

          <tbody>
            ${itemHtml}

            <tr>
              <td colspan="4" style="padding:12px;border:1px solid #d9d9d9;text-align:right;font-weight:bold;">
                Subtotal
              </td>
              <td style="padding:12px;border:1px solid #d9d9d9;text-align:right;font-weight:bold;">
                £${Number(subtotal || 0).toFixed(2)}
              </td>
            </tr>

            <tr>
              <td colspan="4" style="padding:12px;border:1px solid #d9d9d9;text-align:right;color:#555;">
                VAT
              </td>
              <td style="padding:12px;border:1px solid #d9d9d9;text-align:right;color:#555;">
                Calculated at invoice stage
              </td>
            </tr>
          </tbody>
        </table>

        <p style="font-size:14px;line-height:1.6;margin:24px 0;">
          Our team will review your request and contact you once your order has been approved.
          <br><br>
          Thank you for your business.
          <br>
          <strong>SARA Wholesale Supplies Team</strong>
        </p>

        <hr style="border:none;border-top:1px solid #ddd;margin:30px 0;">

        <table style="width:100%;font-size:13px;color:#333;">
          <tr>
            <td>
              <strong>SARA Wholesale Supplies</strong><br>
              A Trading Name of SAARAH ENTERPRISES LTD<br>
              Company Number: 15920690
            </td>
            <td style="text-align:right;">
              www.sarawholesale.co.uk<br>
              sales@sarawholesale.co.uk
            </td>
          </tr>
        </table>

        <p style="text-align:center;margin:28px 0 0;font-size:12px;color:#777;">
          This is an automated email. Please do not reply to this email.
        </p>

      </div>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `Order Request Confirmation - ${orderRequestNumber}`,
    html,
  });
}

async function sendContactFormEmail({
  name,
  email,
  phone,
  subject,
  message,
}) {
  const toEmail = process.env.HOST_EMAIL || process.env.EMAIL_USER;

  await transporter.sendMail({
    from:
      process.env.EMAIL_FROM ||
      `"SARA Wholesale Supplies" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    replyTo: email,
    subject: `Website Enquiry: ${subject}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#333;">
        <div style="background:#062b63;padding:20px;text-align:center;">
          <h1 style="color:#fff;margin:0;">SARA Wholesale Supplies</h1>
          <p style="color:#dbeafe;margin:8px 0 0;">New Website Contact Enquiry</p>
        </div>

        <div style="padding:25px;border:1px solid #e5e7eb;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px;font-weight:bold;width:140px;">Name</td>
              <td style="padding:10px;">${name}</td>
            </tr>

            <tr style="background:#f9fafb;">
              <td style="padding:10px;font-weight:bold;">Email</td>
              <td style="padding:10px;">${email}</td>
            </tr>

            <tr>
              <td style="padding:10px;font-weight:bold;">Phone</td>
              <td style="padding:10px;">${phone || "Not provided"}</td>
            </tr>

            <tr style="background:#f9fafb;">
              <td style="padding:10px;font-weight:bold;">Subject</td>
              <td style="padding:10px;">${subject}</td>
            </tr>
          </table>

          <div style="margin-top:25px;">
            <h3 style="color:#062b63;margin-bottom:10px;">Customer Message</h3>

            <div style="background:#f8fafc;border-left:4px solid #16a34a;padding:15px;line-height:1.7;">
              ${message.replace(/\n/g, "<br>")}
            </div>
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e5e7eb;padding:15px;text-align:center;font-size:13px;color:#6b7280;">
          <strong>SARA Wholesale Supplies</strong><br>
          sales@sarawholesale.co.uk<br>
          07424 715150<br>
          www.sarawholesale.co.uk
        </div>
      </div>
    `,
  });
}

async function sendContactAcknowledgementEmail({
  name,
  email,
  subject,
}) {
  await transporter.sendMail({
    from:
      process.env.EMAIL_FROM ||
      `"SARA Wholesale Supplies" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "We've Received Your Enquiry - SARA Wholesale Supplies",
    html: `
      <div style="font-family:Arial,sans-serif;background:#f6f6f6;padding:24px;color:#111;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px;border:1px solid #ddd;">
          <h2 style="margin:0 0 8px;color:#062b63;">
            SARA Wholesale Supplies
          </h2>

          <p style="font-size:15px;line-height:1.6;margin:18px 0;">
            Dear ${name || "Customer"},
          </p>

          <p style="font-size:15px;line-height:1.6;">
            Thank you for contacting <strong>SARA Wholesale Supplies</strong>.
          </p>

          <p style="font-size:15px;line-height:1.6;">
            We have received your enquiry regarding <strong>${subject}</strong>.
          </p>

          <p style="font-size:15px;line-height:1.6;">
            A member of our team will review your message and respond as soon as possible.
          </p>

          <div style="background:#f8fafc;padding:14px;margin:20px 0;border-left:4px solid #16a34a;font-size:14px;line-height:1.6;">
            <strong>Contact Details</strong><br>
            Email: sales@sarawholesale.co.uk<br>
            Phone: 07424 715150
          </div>

          <p style="font-size:15px;line-height:1.6;">
            Thank you for your interest in our products and services.
          </p>

          <p style="font-size:14px;line-height:1.6;margin-top:24px;">
            Kind regards,<br>
            <strong>SARA Wholesale Supplies Team</strong>
          </p>
        </div>
      </div>
    `,
  });
}

module.exports = {
  sendVerificationCode,
  sendRegistrationSuccess,
  sendOrderRequestEmail,
  sendContactFormEmail,
  sendContactAcknowledgementEmail,
};