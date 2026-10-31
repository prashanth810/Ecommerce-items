const RiderVerifiedEmail = ({ name, email }) => {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Your Rider Account is Verified!</title>
</head>
<body style="
    margin: 0;
    padding: 0;
    background-color: #f4f6f8;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
">
    <div style="width: 100%; padding: 40px 0;">
        <div style="
            max-width: 520px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 16px;
            padding: 40px 35px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
            border: 1px solid #e2e8f0;
        ">
            <!-- Brand Badge -->
            <div style="margin-bottom: 24px;">
                <span style="
                    display: inline-block;
                    background: linear-gradient(135deg, #059669, #10b981);
                    color: #ffffff;
                    font-size: 13px;
                    font-weight: 700;
                    letter-spacing: 1px;
                    padding: 6px 16px;
                    border-radius: 9999px;
                    text-transform: uppercase;
                ">
                    QuickRider · Delivery
                </span>
            </div>

            <!-- Success Checkmark Icon -->
            <div style="
                width: 72px;
                height: 72px;
                background-color: #ecfdf5;
                border: 2px solid #a7f3d0;
                border-radius: 50%;
                margin: 0 auto 20px;
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <span style="font-size: 38px; line-height: 72px; color: #059669;">✓</span>
            </div>

            <h1 style="
                margin: 0 0 12px;
                color: #0f172a;
                font-size: 24px;
                font-weight: 800;
            ">
                Account Verified Successfully!
            </h1>

            <p style="
                margin: 0 0 20px;
                color: #475569;
                font-size: 15px;
                line-height: 1.6;
            ">
                Hi <strong>${name || "Rider"}</strong>,<br/>
                Great news! Our admin team has reviewed and verified all your documents and vehicle details. Your QuickRider account is now <strong>active</strong>.
            </p>

            <!-- Status Box -->
            <div style="
                background-color: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 16px 20px;
                margin-bottom: 28px;
                text-align: left;
            ">
                <div style="font-size: 13px; color: #64748b; margin-bottom: 6px;">
                    Account Email: <strong style="color: #0f172a;">${email}</strong>
                </div>
                <div style="font-size: 13px; color: #64748b; margin-bottom: 6px;">
                    Verification Status: <span style="display: inline-block; background-color: #d1fae5; color: #065f46; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">Verified</span>
                </div>
                <div style="font-size: 13px; color: #64748b;">
                    Availability: <strong style="color: #059669;">Ready to take deliveries</strong>
                </div>
            </div>

            <!-- Call to Action -->
            <div style="margin-bottom: 28px;">
                <p style="margin: 0 0 16px; color: #64748b; font-size: 14px;">
                    You can now log in to the Rider Portal with your email and password to start accepting orders:
                </p>
                <a href="http://localhost:5173/login" style="
                    display: inline-block;
                    background-color: #059669;
                    color: #ffffff;
                    text-decoration: none;
                    font-size: 15px;
                    font-weight: 600;
                    padding: 14px 32px;
                    border-radius: 8px;
                    box-shadow: 0 4px 10px rgba(5, 150, 105, 0.25);
                ">
                    Sign in to Rider Portal →
                </a>
            </div>

            <hr style="
                border: none;
                border-top: 1px solid #e2e8f0;
                margin: 28px 0 20px;
            ">

            <p style="
                margin: 0;
                color: #94a3b8;
                font-size: 12px;
                line-height: 1.5;
            ">
                Need help or have questions? Contact support at support@quickrider.com<br/>
                Safe riding! The QuickRider Team.
            </p>
        </div>
    </div>
</body>
</html>
    `;
};

export default RiderVerifiedEmail;

