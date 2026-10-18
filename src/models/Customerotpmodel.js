import mongoose from "mongoose";

// One delivery OTP per customer. Same value until expiresAt, then it is changed automatically.
const CustomerOtpSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId, required: true, unique: true
    },
    otp: {
        type: String, required: true
    },
    rotatedAt: {
        type: Date, required: true
    },
    expiresAt: {
        type: Date, required: true
    },
}, { timestamps: true });

const CustomerOtpModel = mongoose.model("CustomerOtp", CustomerOtpSchema);

export default CustomerOtpModel;