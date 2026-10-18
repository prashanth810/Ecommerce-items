import validator from "validator";
import RiderModel from "../models/Ridermodel.js";
import DeliveryModel from "../models/Deliverymodel.js";
import RiderApplicationModel from "../models/RiderApplicationModel.js";
import BlacklistTokenModel from "../models/Blacklisttokenmodel.js";
import { uploadToCloudinary, deleteFromCloudinaryByUrl, deletePrivateFromCloudinary } from "../config/Cloudinary.js";
import { notifyRider } from "../socket/Socket.js";

const ACTIVE_STATUSES = ["ACCEPTED", "PICKED_UP"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE = 5 * 1024 * 1024;

const checkImage = (file) => {
    if (!IMAGE_TYPES.includes(file.mimetype)) return "Only jpg, jpeg, png, webp, gif formats are allowed !!!";
    if (file.size > MAX_IMAGE) return "Profile picture must be less than 5MB !!!";
    return null;
};

const hasActiveDelivery = (riderId) =>
    DeliveryModel.exists({ riderId, status: { $in: ACTIVE_STATUSES } });

// ---------- logout ----------
const RiderLogout = async (req, res) => {
    try {
        await BlacklistTokenModel.create({ token: req.token });
        return res.status(200).json({ success: true, message: "Logged out success !!!" });
    }
    catch (error) {
        // token already blacklisted (logout pressed twice) is still a successful logout
        if (error?.code === 11000) {
            return res.status(200).json({ success: true, message: "Logged out success !!!" });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- my profile ----------
const MyProfile = async (req, res) => {
    return res.status(200).json({ success: true, data: req.user });
};

// ---------- update profile ----------
const UpdateProfile = async (req, res) => {
    const { name, phone } = req.body || {};
    try {
        const rider = req.user;
        const update = {};

        if (name !== undefined) {
            if (typeof name !== "string" || name.trim().length < 2) {
                return res.status(400).json({ success: false, message: "Name cannot be empty !!!" });
            }
            update.name = name.trim();
        }

        if (phone !== undefined) {
            if (!validator.isMobilePhone(String(phone), "en-IN")) {
                return res.status(400).json({ success: false, message: "Provide valid phone number !!!" });
            }
            const digits = String(phone).replace(/[\s-]/g, "").slice(-10); // same format the auth service stores
            const taken = await RiderModel.findOne({ phone: digits, _id: { $ne: rider._id } });
            if (taken) return res.status(400).json({ success: false, message: "Phone number already used !!!" });
            update.phone = digits;
        }

        if (req.file) {
            const imageError = checkImage(req.file);
            if (imageError) return res.status(400).json({ success: false, message: imageError });

            update.profile_pic = await uploadToCloudinary(req.file.buffer, "riders/profile_pic");
        }

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ success: false, message: "Nothing to update (name, phone or profile_pic) !!!" });
        }

        const updated = await RiderModel.findByIdAndUpdate(
            rider._id, { $set: update }, { returnDocument: "after", runValidators: true }
        ).select("-password -documents");

        // old photo is deleted only after the new one is saved
        if (update.profile_pic && rider.profile_pic) await deleteFromCloudinaryByUrl(rider.profile_pic);

        return res.status(200).json({ success: true, message: "Profile updated successfully!", data: updated });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- get current online status (or set via query ?isOnline=true) ----------
const GetAvailability = async (req, res) => {
    if (req.query?.isOnline !== undefined || req.query?.online !== undefined || req.query?.status !== undefined) {
        return SetAvailability(req, res);
    }
    return res.status(200).json({
        success: true,
        isOnline: Boolean(req.user.isOnline),
        message: req.user.isOnline ? "You are online now" : "You are offline now",
        data: req.user,
    });
};

// ---------- go online / offline ----------
const SetAvailability = async (req, res) => {
    let isOnline = req.body?.isOnline;
    if (isOnline === undefined && req.query?.isOnline !== undefined) {
        isOnline = req.query.isOnline;
    }
    if (isOnline === undefined && req.query?.online !== undefined) {
        isOnline = req.query.online;
    }
    if (isOnline === undefined && req.query?.status !== undefined) {
        isOnline = req.query.status;
    }

    // Default to true if not specified so calling this endpoint easily sets online
    if (isOnline === undefined) {
        isOnline = true;
    } else if (typeof isOnline === "string") {
        const lower = isOnline.trim().toLowerCase();
        if (lower === "true" || lower === "1" || lower === "yes" || lower === "online") isOnline = true;
        else if (lower === "false" || lower === "0" || lower === "no" || lower === "offline") isOnline = false;
    }

    try {
        if (typeof isOnline !== "boolean") {
            return res.status(400).json({ success: false, message: "isOnline must be true or false !!!" });
        }

        if (!isOnline && (await hasActiveDelivery(req.user._id))) {
            return res.status(400).json({ success: false, message: "Finish your active deliveries before going offline !!!" });
        }

        const rider = await RiderModel.findByIdAndUpdate(
            req.user._id, { $set: { isOnline } }, { returnDocument: "after" }
        ).select("-password -documents");

        // went online -> app reloads GET /deliveries/available (jobs created while offline)
        if (isOnline) notifyRider(req.user._id, "delivery:sync", { reason: "online" });

        return res.status(200).json({
            success: true,
            message: isOnline ? "You are online now" : "You are offline now",
            data: rider,
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ---------- delete account ----------
const DeleteAccount = async (req, res) => {
    try {
        const rider = req.user;

        if (await hasActiveDelivery(rider._id)) {
            return res.status(400).json({ success: false, message: "Finish your active deliveries before deleting account !!!" });
        }

        // req.user has no documents (hidden on purpose), read the stored image ids here (lean = no hiding transform)
        const stored = await RiderModel.findById(rider._id).select("profile_pic vehicleImages documents").lean();

        await RiderModel.findByIdAndDelete(rider._id);

        // the old onboarding record would keep the email taken, so a new registration could never use it
        await RiderApplicationModel.deleteMany({ email: rider.email });

        await BlacklistTokenModel.updateOne({ token: req.token }, { $setOnInsert: { token: req.token } }, { upsert: true });

        // images are removed only after the account is gone; a failed clean-up is only logged
        if (stored?.profile_pic) await deleteFromCloudinaryByUrl(stored.profile_pic);
        for (const url of stored?.vehicleImages || []) await deleteFromCloudinaryByUrl(url);
        for (const id of [stored?.documents?.licenseImage, stored?.documents?.aadhaarImage, stored?.documents?.panImage]) {
            await deletePrivateFromCloudinary(id);
        }

        return res.status(200).json({ success: true, message: "Account deleted success !!!" });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

export { RiderLogout, MyProfile, UpdateProfile, GetAvailability, SetAvailability, DeleteAccount };