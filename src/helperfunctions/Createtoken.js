import crypto from "crypto";
import jwt from "jsonwebtoken";
import Envs from "../utils/Envs.js";

// full login token: only for riders who finished onboarding (role "delivery")
// jwtid makes every token unique: logout blacklists the token string, so a login right after a logout
// (same second, same payload) must not give back the same, already blacklisted, string
const CreateToken = (rider) => {
    return jwt.sign({
        id: rider._id,
        email: rider.email,
        role: "delivery",
        name: rider.name,
    }, Envs.JWT_SECRET, { expiresIn: "1d", jwtid: crypto.randomUUID() });
};

// onboarding token: only works on the "fill your details" APIs (Rideronboardauth.js),
// the role is different, so it can NOT be used on any delivery / order API
const CreateOnboardingToken = (application) => {
    return jwt.sign({
        id: application._id,
        email: application.email,
        role: "rider_onboarding",
        name: application.name,
    }, Envs.JWT_SECRET, { expiresIn: "3d", jwtid: crypto.randomUUID() });
};

export default CreateToken;
export { CreateOnboardingToken };