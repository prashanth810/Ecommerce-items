import RiderModel from "../models/Ridermodel.js";
import sendMail from "../models/Mailer.js";
import RiderVerifiedEmail from "../htmlfiles/RiderVerifiedEmail.js";

// ─── List riders pending admin verification ──────────────────────────────────
export const getPendingRiders = async (req, res) => {
    try {
        const riders = await RiderModel.find({
            $or: [
                { is_verified: false },
                { verification_status: "pending" },
            ],
        })
            .select("-password")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            total: riders.length,
            message: "Pending riders fetched successfully",
            data: riders,
        });
    } catch (error) {
        console.error("getPendingRiders error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch pending riders: " + error.message,
        });
    }
};

// ─── Verify / Approve / Reject a rider account ──────────────────────────────
export const verifyRider = async (req, res) => {
    const { id } = req.params;
    const { action = "approve", reason = "" } = req.body || {};

    try {
        const rider = await RiderModel.findById(id);

        if (!rider) {
            return res.status(404).json({
                success: false,
                message: "Rider account not found with ID: " + id,
            });
        }

        if (action === "reject") {
            rider.is_verified = false;
            rider.is_active = false;
            rider.verification_status = "rejected";
            rider.verification_notes = reason || "Application rejected by admin";
            await rider.save();

            // Send rejection notice email
            try {
                await sendMail({
                    to: rider.email,
                    subject: "Update on your QuickRider account application",
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <h2 style="color: #e11d48;">Rider Application Status</h2>
                            <p>Hello <strong>${rider.name}</strong>,</p>
                            <p>Thank you for applying to be a rider. After reviewing your submission, we regret to inform you that your application could not be approved at this time.</p>
                            <p><strong>Reason:</strong> ${rider.verification_notes}</p>
                            <p>Please contact our support team at support@quickrider.com if you have any questions or wish to re-submit corrected documents.</p>
                        </div>
                    `,
                });
            } catch (mailError) {
                console.error("Rejection email sending failed:", mailError.message);
            }

            return res.status(200).json({
                success: true,
                message: "Rider application has been rejected.",
                data: rider,
            });
        }

        // Default: approve / verify rider
        rider.is_verified = true;
        rider.is_active = true;
        rider.verification_status = "verified";
        rider.verification_notes = "Verified by admin";
        rider.verifiedAt = new Date();
        await rider.save();

        // ─── Send automated verification email ────────────────────────────────
        let emailSent = false;
        try {
            await sendMail({
                to: rider.email,
                subject: "Your QuickRider Account is Verified! Start Delivering Now",
                html: RiderVerifiedEmail({ name: rider.name, email: rider.email }),
            });
            emailSent = true;
            console.log(`Verification email sent to rider ${rider.email}`);
        } catch (mailError) {
            console.error("Verification email sending failed:", mailError.message);
        }

        return res.status(200).json({
            success: true,
            message: `Rider account verified successfully! ${emailSent ? "Confirmation email sent to rider." : "Note: Email could not be sent (check SMTP settings)." }`,
            emailSent,
            data: rider,
        });
    } catch (error) {
        console.error("verifyRider error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to verify rider: " + error.message,
        });
    }
};

// ─── Get all riders with optional status filtering ──────────────────────────
export const getAllRiders = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = {};

        if (status) {
            filter.verification_status = status;
        }

        const riders = await RiderModel.find(filter)
            .select("-password")
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            total: riders.length,
            data: riders,
        });
    } catch (error) {
        console.error("getAllRiders error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch riders: " + error.message,
        });
    }
};

// ─── Get single rider by ID ──────────────────────────────────────────────────
export const getRiderById = async (req, res) => {
    const { id } = req.params;
    try {
        const rider = await RiderModel.findById(id).select("-password");

        if (!rider) {
            return res.status(404).json({
                success: false,
                message: "Rider not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: rider,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

