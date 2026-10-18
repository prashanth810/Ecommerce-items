import express from "express";
import { CustomerAuth } from "../middlewares/Authmiddleware.js";
import Ratelimit from "../middlewares/Ratelimit.js";
import { GetMyDeliveryOtp } from "../controllers/Otpcontroller.js";

const Otproute = express.Router();

// customer token required
Otproute.get("/customer/delivery-otp", Ratelimit(60 * 1000, 20, 5 * 60 * 1000), CustomerAuth, GetMyDeliveryOtp);

export default Otproute;