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

async function sendVerificationCode(email, code) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Verify your SARA Wholesale Supplies account",
    html: `
      <h2>SARA Wholesale Supplies</h2>
      <p>Your verification code is:</p>
      <h1>${code}</h1>
      <p>This code will expire in 10 minutes.</p>
    `,
  });
}

async function sendRegistrationSuccess(email, name) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Registration successful - SARA Wholesale Supplies",
    html: `
      <h2>Welcome ${name}</h2>
      <p>Your account has been verified successfully.</p>
      <p>You can now login and place orders.</p>
    `,
  });
}

module.exports = {
  sendVerificationCode,
  sendRegistrationSuccess,
};