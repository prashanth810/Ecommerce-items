import crypto from "crypto";
import mongoose from "mongoose";
import CustomerOtpModel from "../models/Customerotpmodel.js";
import Envs from "../utils/Envs.js";

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
    const a = Buffer.from(String(given));
    const b = Buffer.from(String(actual));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export { getActiveOtp, otpMatches };