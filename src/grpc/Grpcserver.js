import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import DeliveryModel from "../models/Deliverymodel.js";
import RiderModel from "../models/Ridermodel.js";
import { getActiveOtp } from "../helperfunctions/Otp.js";
import Envs from "../utils/Envs.js";
import { notifyNewJob, notifyJobUnavailable, notifyRider } from "../socket/Socket.js";
import { resolveVendorDetails, resolveCustomerEmail } from "../helperfunctions/VendorResolver.js";
import { getUserEmail } from "./Grpchelper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const riderProto = grpc.loadPackageDefinition(
    protoLoader.loadSync(path.join(__dirname, "./Rider.proto"), {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    })
).rider;

const isAllowed = (call) => {
    const key = call?.metadata?.get("x-internal-key")?.[0];
    const ok = Boolean(key && key === Envs.INTERNAL_GRPC_KEY);
    if (!ok) console.error("[gRPC] call refused: x-internal-key missing or different from INTERNAL_GRPC_KEY in this service's .env");
    return ok;
};

const denied = (callback) => callback({ code: grpc.status.UNAUTHENTICATED, message: "Not allowed" });

// order is confirmed -> create a delivery that riders can see (safe to call many times for the same order)
const CreateDelivery = async (call, callback) => {
    if (!isAllowed(call)) return denied(callback);

    try {
        const r = call.request;
        console.log("[gRPC CreateDelivery] received:", JSON.stringify(r));

        // every rejection is logged, so "no deliveries" can be traced in this terminal
        const fail = (message) => {
            console.error("[gRPC CreateDelivery] REJECTED:", message);
            return callback(null, { success: false, message, deliveryId: "" });
        };

        if (!r.orderId || !mongoose.isValidObjectId(r.orderId)) return fail("valid orderId is required");
        if (!mongoose.isValidObjectId(r.customerId)) return fail("valid customerId is required");

        // accept "cod", "Cash on Delivery", "online", "razorpay", "UPI" ... and store COD / ONLINE
        const rawPay = String(r.paymentMethod || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
        const paymentMethod = ["COD", "CASHONDELIVERY", "CASH"].includes(rawPay) ? "COD"
            : rawPay ? "ONLINE" : "";
        if (!paymentMethod) return fail("paymentMethod is required (COD or ONLINE)");

        const amount = Number(r.totalAmount);
        if (!Number.isFinite(amount) || amount < 0) return fail("totalAmount is invalid");

        // only city is really needed to show a job; phone falls back to the customer's phone
        const a = { ...(r.address || {}) };
        if (!a.phone) a.phone = r.customerPhone || "";
        if (!a.full_name) a.full_name = r.customerName || "";
        if (!a.city) return fail("address.city is required (send address fields as full_name, phone, building_number, street, landmark, city, state, pincode)");

        const items = (r.items || []).map((i) => ({
            name: i.name, weight: i.weight, quantity: Number(i.quantity) || 1, image: i.image,
        }));
        if (items.length === 0) return fail("at least one item is required");

        // duplicate guard: one delivery per order (orderId is also unique in the database)
        let delivery = await DeliveryModel.findOne({ orderId: r.orderId });
        let created = false;

        if (!delivery) {
            try {
                let pickupAddress = r.pickupAddress || "";
                let storeName = "";
                let storePhone = "";

                if (!pickupAddress) {
                    const resolved = await resolveVendorDetails(r.orderId, items);
                    pickupAddress = resolved.pickupAddress;
                    storeName = resolved.storeName;
                    storePhone = resolved.storePhone;
                }

                let customerEmail = r.customerEmail ? String(r.customerEmail).trim() : "";
                if (!customerEmail) {
                    try {
                        customerEmail = await getUserEmail(r.customerId);
                    } catch (e) {}
                }
                if (!customerEmail) {
                    try {
                        customerEmail = await resolveCustomerEmail(r.customerId);
                    } catch (e) {}
                }

                delivery = await DeliveryModel.create({
                    orderId: r.orderId,
                    customerId: r.customerId,
                    customerName: r.customerName,
                    customerPhone: r.customerPhone,
                    customerEmail: customerEmail || "",
                    address: a,
                    pickupAddress,
                    storeName,
                    storePhone,
                    items,
                    paymentMethod,
                    amountToCollect: paymentMethod === "COD" ? amount : 0,
                    status: "PENDING",
                    riderId: null,
                    declinedBy: [],
                    history: [],
                });
                created = true;
            } catch (error) {
                if (error.code !== 11000) throw error;
                delivery = await DeliveryModel.findOne({ orderId: r.orderId }); // lost the race, use the winner
            }
        }

        // make sure a customer OTP exists before the rider arrives
        const otpRecord = await getActiveOtp(r.customerId);
        if (otpRecord && delivery) {
            await DeliveryModel.updateOne(
                { _id: delivery._id },
                { $set: { deliveryOtp: otpRecord.otp } }
            );
        }

        // only a brand new job is pushed to riders (retries never notify twice)
        if (created) notifyNewJob(delivery.toObject());
        console.log(`[gRPC CreateDelivery] ${created ? "created" : "already existed"} delivery ${delivery._id} for order ${r.orderId}`);

        return callback(null, {
            success: true,
            message: created ? "Delivery created" : "Delivery already exists",
            deliveryId: String(delivery._id),
        });
    } catch (error) {
        console.error("[gRPC CreateDelivery] ERROR:", error.message);
        return callback({ code: grpc.status.INTERNAL, message: error.message });
    }
};

// order cancelled -> cancel the delivery (only if rider has not picked it up yet)
const CancelDelivery = async (call, callback) => {
    if (!isAllowed(call)) return denied(callback);

    try {
        const { orderId, reason } = call.request;
        const now = new Date();
        const why = reason || "Order cancelled";

        // returnDocument "before" so we still know which rider had accepted it
        const before = await DeliveryModel.findOneAndUpdate(
            { orderId, status: { $in: ["PENDING", "ACCEPTED"] } },
            {
                $set: { status: "CANCELLED", cancelledAt: now, cancelReason: why, riderId: null },
                $push: { history: { action: "SYSTEM_CANCELLED", reason: why, at: now } },
            },
            { returnDocument: "before" }
        );

        if (!before) {
            const existing = await DeliveryModel.findOne({ orderId }).select("status");
            if (!existing) return callback(null, { success: true, message: "No delivery for this order", deliveryId: "" });
            if (existing.status === "CANCELLED") {
                return callback(null, { success: true, message: "Delivery already cancelled", deliveryId: String(existing._id) });
            }
            return callback(null, { success: false, message: `Cannot cancel, delivery is ${existing.status}`, deliveryId: String(existing._id) });
        }

        // the rider who had accepted must be told, the job also disappears for everybody else
        if (before.riderId) {
            notifyRider(before.riderId, "delivery:cancelled", { deliveryId: String(before._id), orderId: before.orderId, reason: why });
        }
        notifyJobUnavailable(before._id, "CANCELLED");

        return callback(null, { success: true, message: "Delivery cancelled", deliveryId: String(before._id) });
    } catch (error) {
        return callback({ code: grpc.status.INTERNAL, message: error.message });
    }
};

// order page can show delivery status + rider details
const GetDeliveryByOrder = async (call, callback) => {
    if (!isAllowed(call)) return denied(callback);

    try {
        const delivery = await DeliveryModel.findOne({ orderId: call.request.orderId }).lean();

        if (!delivery) {
            return callback(null, { success: false, message: "Delivery not found" });
        }

        let rider = null;
        if (delivery.riderId && ["ACCEPTED", "PICKED_UP", "DELIVERED"].includes(delivery.status)) {
            rider = await RiderModel.findById(delivery.riderId).select("name phone vehicleNumber").lean();
        }

        return callback(null, {
            success: true,
            message: "Delivery found",
            status: delivery.status,
            riderName: rider?.name || "",
            riderPhone: rider?.phone || "",
            vehicleNumber: rider?.vehicleNumber || "",
        });
    } catch (error) {
        return callback({ code: grpc.status.INTERNAL, message: error.message });
    }
};

// order service can show the OTP to the customer on the order page
const GetCustomerOtp = async (call, callback) => {
    if (!isAllowed(call)) return denied(callback);

    try {
        const record = await getActiveOtp(call.request.customerId);

        if (!record) {
            return callback(null, { success: false, message: "Invalid customer" });
        }

        return callback(null, {
            success: true,
            message: "OTP found",
            otp: record.otp,
            expiresAt: record.expiresAt.toISOString(),
        });
    } catch (error) {
        return callback({ code: grpc.status.INTERNAL, message: error.message });
    }
};

const startGrpcServer = () => {
    const server = new grpc.Server();
    server.addService(riderProto.RiderService.service, {
        CreateDelivery,
        CancelDelivery,
        GetDeliveryByOrder,
        GetCustomerOtp,
    });

    server.bindAsync(`0.0.0.0:${Envs.GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (error) => {
        if (error) {
            console.error("Rider gRPC failed to start:", error.message);
            return;
        }
        console.log(`Rider gRPC server running on ${Envs.GRPC_PORT}`);
    });
};

export default startGrpcServer;
