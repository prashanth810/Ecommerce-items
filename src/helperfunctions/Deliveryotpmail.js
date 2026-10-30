const esc = (v) => String(v ?? "").replace(/[&<>"\x27]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "\x27": "&#39;" }[c]));

const DeliveryOtpMail = ({ otp, name, orderId }) => {
    const orderNo = String(orderId || "").slice(-6).toUpperCase();

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Delivery OTP</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
    <div style="width:100%;padding:40px 0;">
        <div style="max-width:500px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:35px;text-align:center;box-shadow:0 4px 15px rgba(0,0,0,0.08);">

            <h2 style="margin:0 0 15px;color:#222222;font-size:26px;">Your order is on the way</h2>

            <p style="margin:0 0 25px;color:#666666;font-size:15px;line-height:1.6;">
                Hi ${esc(name) || "there"}, the rider has picked up your order${orderNo ? ` <strong>#${orderNo}</strong>` : ""}.
                Share the OTP below with the rider <strong>only when you receive your items</strong>.
            </p>

            <div style="display:inline-block;padding:15px 30px;background-color:#f1f3f5;border-radius:8px;margin-bottom:25px;">
                <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#222222;">${esc(otp)}</span>
            </div>

            <p style="margin:0;color:#999999;font-size:13px;">
                Do not share this OTP with anyone else. It stops working once your delivery is completed.
            </p>

            <hr style="border:none;border-top:1px solid #eeeeee;margin:30px 0 20px;">

            <p style="margin:0;color:#aaaaaa;font-size:12px;">This is an automated email. Please do not reply.</p>
        </div>
    </div>
</body>
</html>`;
};

export default DeliveryOtpMail;