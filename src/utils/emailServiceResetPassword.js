const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT || 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendResetPasswordEmail({ email, name, resetLink }) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Reset your SARA Wholesale Supplies password",
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
            We received a request to reset your account password.
          </p>

          <p style="font-size:15px;line-height:1.6;">
            Click the button below to create a new password:
          </p>

          <div style="text-align:center;margin:28px 0;">
            <a href="${resetLink}"
              style="background:#062b63;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;font-weight:bold;display:inline-block;">
              Reset Password
            </a>
          </div>

          <p style="font-size:14px;line-height:1.6;color:#555;">
            This link will expire in 30 minutes.
          </p>

          <p style="font-size:14px;line-height:1.6;color:#555;">
            If you did not request a password reset, you can safely ignore this email.
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
  sendResetPasswordEmail,
};