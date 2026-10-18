import mongoose from "mongoose";

// Rider account. Riders are created in this service: register -> personal / vehicle / document
// details -> submit (see Riderauthcontroller.js). Only a rider who finished every step exists here,
// so only finished riders can log in. The private document ids are stripped from every response (see toJSON).
const RiderSchema = new mongoose.Schema({
    name: {
        type: String, required: true, trim: true, minlength: 2, maxlength: 50
    },
    email: {
        type: String, unique: true, required: true, trim: true, lowercase: true
    },
    phone: {
        type: String, unique: true, required: true, trim: true
    },
    password: {
        type: String, required: true, minlength: 8
    },
    profile_pic: {
        type: String, default: ""
    },

    vehicleType: {
        type: String,
        enum: { values: ["bicycle", "bike", "scooter"], message: "Vehicle must be bicycle, bike or scooter." },
        required: true,
    },
    vehicleNumber: { type: String, trim: true, uppercase: true, default: "" },
    licenseNumber: { type: String, trim: true, uppercase: true, default: "" },

    role: { type: String, default: "delivery", immutable: true },
    is_active: { type: Boolean, default: true },   // account enabled
    isOnline: { type: Boolean, default: false },   // available to take deliveries

    // details collected during onboarding (Riderauthcontroller.js)
    vehicleName: { type: String, trim: true, default: "" },
    vehicleImages: [{ type: String }],
    date_of_birth: { type: Date },
    gender: { type: String, enum: ["male", "female", "other"] },
    address: {
        street: { type: String, trim: true },
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        pincode: { type: String, trim: true },
    },
    emergency_contact: {
        name: { type: String, trim: true },
        phone: { type: String, trim: true },
    },
    // verification documents: photos are PRIVATE in cloudinary (only the id is kept), Aadhaar only last 4 digits
    documents: {
        licenseImage: { type: String },
        aadhaarLast4: { type: String },
        aadhaarImage: { type: String },
        panNumber: { type: String },
        panImage: { type: String },
    },
}, {
    timestamps: true,
    minimize: false,
    // the document ids and the password hash must never leave this service,
    // whatever a controller sends with res.json(rider)
    toJSON: { transform: (doc, ret) => { delete ret.password; delete ret.documents; return ret; } },
    toObject: { transform: (doc, ret) => { delete ret.documents; return ret; } },
});

const RiderModel = mongoose.model("Rider", RiderSchema);

export default RiderModel;