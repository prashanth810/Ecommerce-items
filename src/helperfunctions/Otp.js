import crypto from "crypto";
import mongoose from "mongoose";
import CustomerOtpModel from "../models/Customerotpmodel.js";
import DeliveryModel from "../models/Deliverymodel.js";
import Envs from "../utils/Envs.js";
import { resolveCustomerEmail } from "./VendorResolver.js";
import { getUserEmail } from "../grpc/Grpchelper.js";
import DeliveryOtpMail from "./Deliveryotpmail.js";
import sendMail from "../models/Mailer.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const generateOtp = () => {
    const len = Envs.OTP_LENGTH;
    return String(crypto.randomInt(10 ** (len - 1), 10 ** len)); // no leading zero
};

const newOtpFields = () => {
    const now = new Date();
    return {
        otp: generateOtp(),
        rotatedAt: now,
        expiresAt: new Date(now.getTime() + Envs.OTP_VALID_DAYS * DAY_MS),
    };
};

// Returns the customer's current delivery OTP.
// First call creates it. It stays the same for OTP_VALID_DAYS, then the next call changes it automatically.
const getActiveOtp = async (customerId) => {
    if (!mongoose.isValidObjectId(customerId)) return null;

    const now = new Date();
    const existing = await CustomerOtpModel.findOne({ customerId });

    if (existing && existing.expiresAt > now) return existing;

    if (existing) {
        // only one request can win this update, the others just read the new value
        const rotated = await CustomerOtpModel.findOneAndUpdate(
            { customerId, expiresAt: { $lte: now } },
            { $set: newOtpFields() },
            { returnDocument: "after" }
        );
        return rotated || (await CustomerOtpModel.findOne({ customerId }));
    }

    try {
        return await CustomerOtpModel.create({ customerId, ...newOtpFields() });
    } catch (error) {
        if (error.code === 11000) return CustomerOtpModel.findOne({ customerId });
        throw error;
    }
};

const otpMatches = (given, actual) => {
    const a = Buffer.from(String(given || ""));
    const b = Buffer.from(String(actual || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Rider picked the items -> mail the SAME otp (stored in db) to the customer.
// Never throws: a mail problem must not break the pickup flow.
const sendDeliveryOtpEmail = async ({ customerId, customerName, customerEmail, orderId, deliveryId }) => {
    try {
        const record = await getActiveOtp(customerId);
        if (!record) return { sent: false, reason: "Customer OTP not available" };

        // Keep OTP in sync on the delivery record as well
        if (deliveryId && mongoose.isValidObjectId(deliveryId)) {
            await DeliveryModel.updateOne(
                { _id: deliveryId },
                { $set: { deliveryOtp: record.otp } }
            );
        }

        let email = customerEmail ? String(customerEmail).trim() : "";

        // Fallback: check delivery record in db
        if (!email && deliveryId && mongoose.isValidObjectId(deliveryId)) {
            const d = await DeliveryModel.findById(deliveryId).select("customerEmail");
            if (d?.customerEmail) email = String(d.customerEmail).trim();
        }

        // Fallback 1: ask the user service via gRPC
        if (!email) {
            try {
                email = await getUserEmail(customerId);
            } catch (err) {
                console.error("[DeliveryOtp] gRPC getUserEmail error:", err.message);
            }
        }

        // Fallback 2: read user collection directly
        if (!email) {
            try {
                email = await resolveCustomerEmail(customerId);
            } catch (err) {
                console.error("[DeliveryOtp] DB resolveCustomerEmail error:", err.message);
            }
        }

        if (!email) {
            console.error(`[DeliveryOtp] customer email not found for customerId ${customerId}`);
            return { sent: false, reason: "Customer email not found" };
        }

        // Cache resolved email on delivery record for future use
        if (deliveryId && mongoose.isValidObjectId(deliveryId)) {
            await DeliveryModel.updateOne(
                { _id: deliveryId, customerEmail: { $in: ["", null] } },
                { $set: { customerEmail: email } }
            );
        }

        await sendMail({
            to: email,
            subject: `Your delivery OTP for order #${String(orderId).slice(-6).toUpperCase()}`,
            html: DeliveryOtpMail({ otp: record.otp, name: customerName, orderId }),
        });

        console.log(`[DeliveryOtp] OTP mail sent successfully to ${email} for order ${orderId}`);
        return { sent: true, email };
    } catch (error) {
        console.error("[DeliveryOtp] email failed:", error.message);
        return { sent: false, reason: error.message };
    }
};

// Delivery confirmed -> remove the otp from db.
// Customer OTP is shared by all of his orders, so it is kept while another of his
// deliveries is still on the way (otherwise that rider could never finish).
const clearCustomerOtp = async (customerId, finishedDeliveryId) => {
    try {
        // Clear OTP on this specific delivery
        if (finishedDeliveryId && mongoose.isValidObjectId(finishedDeliveryId)) {
            await DeliveryModel.updateOne(
                { _id: finishedDeliveryId },
                { $set: { deliveryOtp: null } }
            );
        }

        const stillOnWay = await DeliveryModel.exists({
            customerId,
            _id: { $ne: finishedDeliveryId },
            status: "PICKED_UP",
        });
        if (stillOnWay) {
            console.log(`[DeliveryOtp] Another delivery is still in transit for customer ${customerId}, retaining active OTP`);
            return false;
        }

        // No more deliveries on the way -> remove OTP from db
        await CustomerOtpModel.deleteMany({ customerId });
        console.log(`[DeliveryOtp] Customer OTP cleared from DB for customer ${customerId}`);
        return true;
    } catch (error) {
        console.error("[DeliveryOtp] clear failed:", error.message);
        return false;
    }
};

export { getActiveOtp, otpMatches, sendDeliveryOtpEmail, clearCustomerOtp };
