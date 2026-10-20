import mongoose from "mongoose";
import DeliveryModel from "../models/Deliverymodel.js";
import Envs from "../utils/Envs.js";
import { getActiveOtp, otpMatches } from "../helperfunctions/Otp.js";
import { updateOrderStatus } from "../grpc/Grpchelper.js";
import { notifyNewJob, notifyJobUnavailable, notifyRider } from "../socket/Socket.js";
import { previewOf } from "../htmlfiles/Preview.js";
import { resolveVendorDetails } from "../helperfunctions/VendorResolver.js";


const ACTIVE_STATUSES = ["ACCEPTED", "PICKED_UP"];
const HIDE = "-declinedBy -history -otpAttempts -otpLockedUntil";

const badId = (id) => !mongoose.isValidObjectId(id);

// ---------- open deliveries waiting for a rider ----------
const AvailableDeliveries = async (req, res) => {
    try {
        const rider = req.user;

        // Fetch latest available deliveries whether rider is online or offline
        const list = await DeliveryModel.find({ status: "PENDING", declinedBy: { $ne: rider._id } })
            .sort({ createdAt: -1 })
            .limit(20);

        for (const item of list) {
            if (!item.pickupAddress || !item.storeName) {
                const vendorInfo = await resolveVendorDetails(item.orderId, item.items);
                if (vendorInfo.pickupAddress || vendorInfo.storeName) {
                    item.pickupAddress = vendorInfo.pickupAddress || item.pickupAddress;
                    item.storeName = vendorInfo.storeName || item.storeName;
                    item.storePhone = vendorInfo.storePhone || item.storePhone;
                    await DeliveryModel.updateOne(
                        { _id: item._id },
                        { $set: { pickupAddress: item.pickupAddress, storeName: item.storeName, storePhone: item.storePhone } }
                    );
                }
            }
        }

        return res.status(200).json({
            success: true,
            isOnline: Boolean(rider.isOnline),
            count: list.length,
            data: list.map(previewOf),
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- accept ----------
const AcceptDelivery = async (req, res) => {
    const { id } = req.params;
    try {
        const rider = req.user;

        if (badId(id)) return res.status(400).json({ success: false, message: "Invalid delivery id !!!" });

        if (!rider.isOnline) {
            return res.status(400).json({
                success: false,
                isOnline: false,
                message: "Please make your status online, then accept it !!!",
            });
        }

        const activeCount = await DeliveryModel.countDocuments({ riderId: rider._id, status: { $in: ACTIVE_STATUSES } });
        if (activeCount >= Envs.MAX_ACTIVE_DELIVERIES) {
            return res.status(400).json({
                success: false,
                message: `You can hold only ${Envs.MAX_ACTIVE_DELIVERIES} active deliveries at a time !!!`,
            });
        }

        const now = new Date();

        // atomic: only one rider can win a PENDING delivery
        let delivery = await DeliveryModel.findOneAndUpdate(
            { _id: id, status: "PENDING", declinedBy: { $ne: rider._id } },
            {
                $set: { status: "ACCEPTED", riderId: rider._id, acceptedAt: now, orderSynced: true },
                $push: { history: { riderId: rider._id, action: "ACCEPTED", at: now } },
            },
            { returnDocument: "after" }
        ).select(HIDE);

        if (!delivery) {
            // Check if already accepted by this rider
            const alreadyMine = await DeliveryModel.findOne({ _id: id, riderId: rider._id, status: { $in: ACTIVE_STATUSES } }).select(HIDE);
            if (alreadyMine) {
                delivery = alreadyMine;
            } else {
                return res.status(409).json({ success: false, message: "This delivery is no longer available !!!" });
            }
        }

        // Ensure pickupAddress and store details are populated
        if (!delivery.pickupAddress || !delivery.storeName) {
            const vendorInfo = await resolveVendorDetails(delivery.orderId, delivery.items);
            if (vendorInfo.pickupAddress || vendorInfo.storeName) {
                const updated = await DeliveryModel.findByIdAndUpdate(
                    delivery._id,
                    {
                        $set: {
                            pickupAddress: vendorInfo.pickupAddress || delivery.pickupAddress,
                            storeName: vendorInfo.storeName || delivery.storeName,
                            storePhone: vendorInfo.storePhone || delivery.storePhone,
                        },
                    },
                    { returnDocument: "after" }
                ).select(HIDE);
                if (updated) {
                    delivery = updated;
                }
            }
        }

        // everybody else loses this job, the accepting rider gets the full details (all his devices)
        notifyJobUnavailable(delivery._id, "ACCEPTED_BY_OTHER", rider._id);
        notifyRider(rider._id, "delivery:assigned", { data: delivery });

        return res.status(200).json({ success: true, message: "Delivery accepted", data: delivery });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- decline (don't want it, hides it for this rider) ----------
const DeclineDelivery = async (req, res) => {
    const { id } = req.params;
    try {
        const rider = req.user;

        if (badId(id)) return res.status(400).json({ success: false, message: "Invalid delivery id !!!" });

        const delivery = await DeliveryModel.findOneAndUpdate(
            { _id: id, status: "PENDING", declinedBy: { $ne: rider._id } },
            {
                $addToSet: { declinedBy: rider._id },
                $push: { history: { riderId: rider._id, action: "DECLINED", at: new Date() } },
            },
            { returnDocument: "after" }
        );

        if (!delivery) {
            return res.status(404).json({ success: false, message: "Delivery not found or already taken !!!" });
        }

        // hide it on this rider's other devices only, other riders still see the job
        notifyRider(rider._id, "delivery:unavailable", { deliveryId: String(delivery._id), reason: "DECLINED" });

        return res.status(200).json({ success: true, message: "Delivery declined" });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- cancel after accept (before pickup) -> goes back to other riders ----------
const CancelDelivery = async (req, res) => {
    const { id } = req.params;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    try {
        const rider = req.user;

        if (badId(id)) return res.status(400).json({ success: false, message: "Invalid delivery id !!!" });

        if (reason.length < 3 || reason.length > 300) {
            return res.status(400).json({ success: false, message: "Cancel reason is required (3 to 300 characters) !!!" });
        }

        const delivery = await DeliveryModel.findOneAndUpdate(
            { _id: id, riderId: rider._id, status: "ACCEPTED" },
            {
                $set: { status: "PENDING", riderId: null, acceptedAt: null },
                $addToSet: { declinedBy: rider._id },
                $push: { history: { riderId: rider._id, action: "CANCELLED", reason, at: new Date() } },
            },
            { returnDocument: "after" }
        );

        if (!delivery) {
            const existing = await DeliveryModel.findOne({ _id: id, riderId: rider._id }).select("status");
            if (existing?.status === "PICKED_UP") {
                return res.status(400).json({ success: false, message: "Items already picked up, you cannot cancel now. Please contact support !!!" });
            }
            return res.status(404).json({ success: false, message: "Active delivery not found !!!" });
        }

        // job is PENDING again -> offer it to the other online riders (declinedBy already has this rider)
        notifyNewJob(delivery.toObject());

        return res.status(200).json({ success: true, message: "Delivery cancelled, it is open for other riders now" });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- picked up from store ("received" items) ----------
const PickupDelivery = async (req, res) => {
    const { id } = req.params;
    try {
        const rider = req.user;

        if (badId(id)) return res.status(400).json({ success: false, message: "Invalid delivery id !!!" });

        const now = new Date();

        const delivery = await DeliveryModel.findOneAndUpdate(
            { _id: id, riderId: rider._id, status: "ACCEPTED" },
            {
                $set: { status: "PICKED_UP", pickedUpAt: now },
                $push: { history: { riderId: rider._id, action: "PICKED_UP", at: now } },
            },
            { returnDocument: "after" }
        ).select(HIDE);

        if (!delivery) {
            return res.status(404).json({ success: false, message: "Accepted delivery not found !!!" });
        }

        const synced = await updateOrderStatus(delivery.orderId, "OUT_FOR_DELIVERY");
        if (!synced) await DeliveryModel.updateOne({ _id: delivery._id }, { $set: { orderSynced: false } });

        return res.status(200).json({ success: true, message: "Items picked up, go to the customer", data: delivery });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- hand over to customer with the customer's OTP ----------
const CompleteDelivery = async (req, res) => {
    const { id } = req.params;
    const otp = req.body?.otp;
    try {
        const rider = req.user;

        if (badId(id)) return res.status(400).json({ success: false, message: "Invalid delivery id !!!" });

        if (otp === undefined || !/^\d+$/.test(String(otp).trim())) {
            return res.status(400).json({ success: false, message: "Customer OTP is required !!!" });
        }

        const delivery = await DeliveryModel.findOne({ _id: id, riderId: rider._id });

        if (!delivery) {
            return res.status(404).json({ success: false, message: "Delivery not found !!!" });
        }
        if (delivery.status === "DELIVERED") {
            return res.status(400).json({ success: false, message: "Already delivered !!!" });
        }
        if (delivery.status !== "PICKED_UP") {
            return res.status(400).json({ success: false, message: "Pick up the items first !!!" });
        }

        const now = new Date();

        if (delivery.otpLockedUntil && delivery.otpLockedUntil > now) {
            const mins = Math.ceil((delivery.otpLockedUntil - now) / 60000);
            return res.status(429).json({ success: false, message: `Too many wrong OTPs. Try again in ${mins} minute(s) !!!` });
        }

        const customerOtp = await getActiveOtp(delivery.customerId);
        if (!customerOtp) {
            return res.status(500).json({ success: false, message: "Customer OTP not available !!!" });
        }

        if (!otpMatches(String(otp).trim(), customerOtp.otp)) {
            const after = await DeliveryModel.findByIdAndUpdate(
                delivery._id, { $inc: { otpAttempts: 1 } }, { returnDocument: "after" }
            );

            if (after.otpAttempts >= Envs.MAX_OTP_ATTEMPTS) {
                await DeliveryModel.updateOne(
                    { _id: delivery._id },
                    { $set: { otpAttempts: 0, otpLockedUntil: new Date(now.getTime() + Envs.OTP_LOCK_MINUTES * 60000) } }
                );
                return res.status(429).json({
                    success: false,
                    message: `Too many wrong OTPs. Locked for ${Envs.OTP_LOCK_MINUTES} minutes !!!`,
                });
            }

            return res.status(400).json({
                success: false,
                message: "Wrong OTP !!!",
                attemptsLeft: Envs.MAX_OTP_ATTEMPTS - after.otpAttempts,
            });
        }

        const done = await DeliveryModel.findOneAndUpdate(
            { _id: delivery._id, riderId: rider._id, status: "PICKED_UP" },
            {
                $set: {
                    status: "DELIVERED",
                    deliveredAt: now,
                    otpAttempts: 0,
                    otpLockedUntil: null,
                    codCollected: delivery.paymentMethod === "COD",
                },
                $push: { history: { riderId: rider._id, action: "DELIVERED", at: now } },
            },
            { returnDocument: "after" }
        ).select(HIDE);

        if (!done) {
            return res.status(409).json({ success: false, message: "Delivery status changed, refresh and try again !!!" });
        }

        const synced = await updateOrderStatus(done.orderId, "DELIVERED", now.toISOString());
        if (!synced) await DeliveryModel.updateOne({ _id: done._id }, { $set: { orderSynced: false } });

        return res.status(200).json({
            success: true,
            message: "Delivered success",
            collectCash: done.paymentMethod === "COD" ? done.amountToCollect : 0,
            data: done,
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- my current deliveries ----------
const MyActiveDeliveries = async (req, res) => {
    try {
        const list = await DeliveryModel.find({ riderId: req.user._id, status: { $in: ACTIVE_STATUSES } })
            .select(HIDE)
            .sort({ acceptedAt: 1 });

        for (const item of list) {
            if (!item.pickupAddress || !item.storeName) {
                const vendorInfo = await resolveVendorDetails(item.orderId, item.items);
                if (vendorInfo.pickupAddress || vendorInfo.storeName) {
                    item.pickupAddress = vendorInfo.pickupAddress || item.pickupAddress;
                    item.storeName = vendorInfo.storeName || item.storeName;
                    item.storePhone = vendorInfo.storePhone || item.storePhone;
                    await DeliveryModel.updateOne(
                        { _id: item._id },
                        { $set: { pickupAddress: item.pickupAddress, storeName: item.storeName, storePhone: item.storePhone } }
                    );
                }
            }
        }

        return res.status(200).json({ success: true, count: list.length, data: list });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- my past deliveries + counts ----------
const MyDeliveryHistory = async (req, res) => {
    try {
        const riderId = req.user._id;
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

        const filter = { riderId, status: "DELIVERED" };

        const [list, total, cancelledByMe, declinedByMe] = await Promise.all([
            DeliveryModel.find(filter).select(HIDE).sort({ deliveredAt: -1 }).skip((page - 1) * limit).limit(limit),
            DeliveryModel.countDocuments(filter),
            DeliveryModel.countDocuments({ history: { $elemMatch: { riderId, action: "CANCELLED" } } }),
            DeliveryModel.countDocuments({ history: { $elemMatch: { riderId, action: "DECLINED" } } }),
        ]);

        return res.status(200).json({
            success: true,
            stats: { delivered: total, cancelledByMe, declinedByMe },
            page,
            totalPages: Math.ceil(total / limit),
            data: list,
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- one delivery (only mine) ----------
const GetMyDelivery = async (req, res) => {
    const { id } = req.params;
    try {
        if (badId(id)) return res.status(400).json({ success: false, message: "Invalid delivery id !!!" });

        let delivery = await DeliveryModel.findOne({ _id: id, riderId: req.user._id }).select(HIDE);

        if (!delivery) {
            return res.status(404).json({ success: false, message: "Delivery not found !!!" });
        }

        if (!delivery.pickupAddress || !delivery.storeName) {
            const vendorInfo = await resolveVendorDetails(delivery.orderId, delivery.items);
            if (vendorInfo.pickupAddress || vendorInfo.storeName) {
                const updated = await DeliveryModel.findByIdAndUpdate(
                    delivery._id,
                    {
                        $set: {
                            pickupAddress: vendorInfo.pickupAddress || delivery.pickupAddress,
                            storeName: vendorInfo.storeName || delivery.storeName,
                            storePhone: vendorInfo.storePhone || delivery.storePhone,
                        },
                    },
                    { returnDocument: "after" }
                ).select(HIDE);
                if (updated) delivery = updated;
            }
        }

        return res.status(200).json({ success: true, data: delivery });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export {
    AvailableDeliveries, AcceptDelivery, DeclineDelivery, CancelDelivery,
    PickupDelivery, CompleteDelivery, MyActiveDeliveries, MyDeliveryHistory, GetMyDelivery,
};