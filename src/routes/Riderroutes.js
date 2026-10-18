import express from "express";
import multer from "multer";
import { upload } from "../config/Cloudinary.js";
import Authmiddleware from "../middlewares/Authmiddleware.js";
import Rideronboardauth from "../middlewares/Rideronboardauth.js";
import Ratelimit from "../middlewares/Ratelimit.js";
import {
    RiderRegister, RiderLogin, OnboardingStatus, SavePersonal, SaveVehicle, SaveDocuments, SubmitOnboarding,
} from "../controllers/Riderauthcontroller.js";
import {
    RiderLogout, MyProfile, UpdateProfile, GetAvailability, SetAvailability, DeleteAccount,
} from "../controllers/Ridercontroller.js";

const Riderroute = express.Router();

const limit = (max) => Ratelimit(60 * 1000, max, 5 * 60 * 1000);

// memory upload with limits: 5MB per file, max 6 files; upload errors become a clean 400
const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 6 } });

const files = (fields) => (req, res, next) => {
    uploader.fields(fields)(req, res, (err) => {
        if (!err) return next();
        const message = err.code === "LIMIT_FILE_SIZE"
            ? "Each image must be less than 5MB !!!"
            : `Upload error: ${err.message}`;
        return res.status(400).json({ success: false, message });
    });
};

// ---- register (name, email, password) and login (only riders who finished every step) ----
Riderroute.post("/rider/register", limit(5), RiderRegister);
Riderroute.post("/rider/login", limit(5), RiderLogin);

// ---- remaining steps, needs the onboarding token that register / login returns ----
Riderroute.get("/rider/onboarding/status", limit(30), Rideronboardauth, OnboardingStatus);

Riderroute.put("/rider/onboarding/personal", limit(15), Rideronboardauth,
    files([{ name: "profile_pic", maxCount: 1 }]), SavePersonal);

Riderroute.put("/rider/onboarding/vehicle", limit(15), Rideronboardauth,
    files([{ name: "vehicle_images", maxCount: 4 }]), SaveVehicle);

Riderroute.put("/rider/onboarding/documents", limit(15), Rideronboardauth,
    files([{ name: "license_image", maxCount: 1 }, { name: "aadhaar_image", maxCount: 1 }, { name: "pan_image", maxCount: 1 }]),
    SaveDocuments);

Riderroute.post("/rider/onboarding/submit", limit(10), Rideronboardauth, SubmitOnboarding);

// ---- logged-in rider ----
Riderroute.post("/rider/logout", Authmiddleware, RiderLogout);

Riderroute.get("/rider/me", limit(20), Authmiddleware, MyProfile);
Riderroute.put("/rider/me", limit(15), Authmiddleware, upload.single("profile_pic"), UpdateProfile);
Riderroute.get("/rider/availability", limit(30), Authmiddleware, GetAvailability);
Riderroute.get("/rider/availability/online", limit(30), Authmiddleware, (req, res) => {
    req.body = { isOnline: true };
    return SetAvailability(req, res);
});
Riderroute.get("/rider/availability/offline", limit(30), Authmiddleware, (req, res) => {
    req.body = { isOnline: false };
    return SetAvailability(req, res);
});
Riderroute.patch("/rider/availability", limit(20), Authmiddleware, SetAvailability);
Riderroute.post("/rider/availability", limit(20), Authmiddleware, SetAvailability);
Riderroute.put("/rider/availability", limit(20), Authmiddleware, SetAvailability);
Riderroute.delete("/rider/account", limit(2), Authmiddleware, DeleteAccount);

export default Riderroute;