import mongoose from "mongoose";

const itemSchema = new mongoose.Schema({
    name: {
        type: String
    },
    weight: {
        type: String
    },
    quantity: {
        type: Number, required: true
    },
    image: {
        type: String
    },
}, { _id: false });

// every accept / decline / cancel / pickup / deliver is stored here
const eventSchema = new mongoose.Schema({
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Rider" },
    action: {
        type: String,
        enum: ["ACCEPTED", "DECLINED", "CANCELLED", "PICKED_UP", "DELIVERED", "SYSTEM_CANCELLED"],
        required: true,
    },
    reason: { type: String, trim: true, maxlength: 300 },
    at: { type: Date, default: Date.now },
}, { _id: false });

const DeliverySchema = new mongoose.Schema({
    // ---- copied from the order service when the order is ready ----
    orderId: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    customerName: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    address: { type: Object, required: true },        // drop address snapshot
    pickupAddress: { type: String, default: "" },     // store / vendor address
    storeName: { type: String, default: "" },         // store / vendor name
    storePhone: { type: String, default: "" },        // store / vendor contact phone
    items: [itemSchema],
    paymentMethod: { type: String, enum: ["COD", "ONLINE"], required: true },
    amountToCollect: { type: Number, default: 0 },    // order total for COD, 0 for ONLINE

    // ---- ride state ----
    status: {
        type: String,
        enum: ["PENDING", "ACCEPTED", "PICKED_UP", "DELIVERED", "CANCELLED"],
        default: "PENDING",
    },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Rider", default: null, index: true },
    declinedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "Rider" }],

    acceptedAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },       // only when the whole delivery is cancelled (order cancelled)
    cancelReason: { type: String, trim: true, maxlength: 300 },

    // ---- otp check at the door ----
    otpAttempts: { type: Number, default: 0 },
    otpLockedUntil: { type: Date, default: null },
    codCollected: { type: Boolean, default: false },

    orderSynced: { type: Boolean, default: true },    // false = order service was not told about the last status change
    history: [eventSchema],
}, { timestamps: true, minimize: false });

DeliverySchema.index({ status: 1, createdAt: 1 });

const DeliveryModel = mongoose.model("Delivery", DeliverySchema);

export default DeliveryModel;