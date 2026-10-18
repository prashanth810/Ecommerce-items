import jwt from "jsonwebtoken";
import Envs from "../utils/Envs.js";
import RiderModel from "../models/Ridermodel.js";
import BlacklistTokenModel from "../models/Blacklisttokenmodel.js";

// ---- rider must be logged in (role delivery) ----
const Authmiddleware = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res.status(401).json({ success: false, message: "Unauthorized - No token provided" });
        }

        const isBlacklisted = await BlacklistTokenModel.findOne({ token });
        if (isBlacklisted) {
            return res.status(401).json({ success: false, message: "Session expired or logged out. Please log in again." });
        }

        const decode = jwt.verify(token, Envs.JWT_SECRET);

        if (decode.role !== "delivery") {
            return res.status(403).json({ success: false, message: "Only riders can use this API !!!" });
        }

        const rider = await RiderModel.findById(decode.id).select("-password -documents");

        if (!rider) {
            return res.status(404).json({ success: false, message: "Rider not found !!!" });
        }

        if (!rider.is_active) {
            return res.status(403).json({ success: false, message: "Your rider account is disabled !!!" });
        }

        req.user = rider;
        req.token = token;
        next();
    }
    catch (error) {
        return res.status(401).json({ success: false, message: "Invalid or expired token !!!" });
    }
};

// ---- customer token (issued by the auth service, same JWT_SECRET) ----
const CustomerAuth = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res.status(401).json({ success: false, message: "Unauthorized - No token provided" });
        }

        const decode = jwt.verify(token, Envs.JWT_SECRET);

        if (decode.role !== "user") {
            return res.status(403).json({ success: false, message: "Only customers can use this API !!!" });
        }

        req.customer = decode; // { id, email, role, name }
        next();
    }
    catch (error) {
        return res.status(401).json({ success: false, message: "Invalid or expired token !!!" });
    }
};

export default Authmiddleware;
export { CustomerAuth };