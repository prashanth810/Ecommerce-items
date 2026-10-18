import { getActiveOtp } from "../helperfunctions/Otp.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// customer sees his own delivery OTP (same one for OTP_VALID_DAYS, then it changes automatically)
const GetMyDeliveryOtp = async (req, res) => {
    try {
        const record = await getActiveOtp(req.customer.id);

        if (!record) {
            return res.status(400).json({ success: false, message: "Invalid customer !!!" });
        }

        return res.status(200).json({
            success: true,
            data: {
                otp: record.otp,
                expiresAt: record.expiresAt,
                daysLeft: Math.max(Math.ceil((record.expiresAt - Date.now()) / DAY_MS), 0),
            },
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export { GetMyDeliveryOtp };