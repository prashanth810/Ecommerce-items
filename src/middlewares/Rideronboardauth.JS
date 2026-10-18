import jwt from "jsonwebtoken";
import Envs from "../utils/Envs.js";
import RiderApplicationModel from "../models/RiderApplicationModel.js";

// Only for the rider "fill your details" APIs.
// The onboarding token has role "rider_onboarding", so it can NOT be used on any delivery / order API.
const Rideronboardauth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res.status(401).json({ success: false, message: "Unauthorized - No token provided" });
        }

        const decode = jwt.verify(token, Envs.JWT_SECRET);

        if (decode.role !== "rider_onboarding") {
            return res.status(403).json({ success: false, message: "Invalid token for this API !!!" });
        }

        const application = await RiderApplicationModel.findById(decode.id).select("-password");

        // a COMPLETED application is also "not found": after submit the rider must login and use the normal token
        if (!application || application.status !== "ONBOARDING") {
            return res.status(404).json({ success: false, message: "Rider registration not found or already completed, please login !!!" });
        }

        req.application = application;
        next();
    }
    catch (error) {
        return res.status(401).json({ success: false, message: "Invalid or expired token !!!" });
    }
};

export default Rideronboardauth;