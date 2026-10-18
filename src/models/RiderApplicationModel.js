import mongoose from "mongoose";

// A rider who has registered (name, email, password) but has NOT finished the details yet.
// Nobody in this collection can log in. When every detail is submitted the rider is created
// in the "riders" collection (RiderModel) and this record is marked COMPLETED.
const RiderApplicationSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    email: { type: String, unique: true, required: true, trim: true, lowercase: true },
    password: { type: String, minlength: 8 }, // hashed; removed after the rider is created

    status: { type: String, enum: ["ONBOARDING", "COMPLETED"], default: "ONBOARDING" },
    completedAt: { type: Date },

    // which steps are finished
    steps: {
        personal: { type: Boolean, default: false },
        vehicle: { type: Boolean, default: false },
        documents: { type: Boolean, default: false },
    },

    // ---- step 1: personal ----
    phone: { type: String, unique: true, sparse: true, trim: true },
    date_of_birth: { type: Date },
    gender: { type: String, enum: ["male", "female", "other"] },
    profile_pic: { type: String, default: "" },
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

    // ---- step 2: vehicle ----
    vehicleType: { type: String, enum: ["bicycle", "bike", "scooter"] },
    vehicleName: { type: String, trim: true },
    vehicleNumber: { type: String, trim: true, uppercase: true },
    vehicleImages: [{ type: String }],

    // ---- step 3: documents (images are stored PRIVATE in cloudinary, only the public_id is kept) ----
    licenseNumber: { type: String, trim: true, uppercase: true },
    licenseImage: { type: String },
    aadhaarLast4: { type: String },          // the full Aadhaar number is never stored
    aadhaarImage: { type: String },
    panNumber: { type: String, trim: true, uppercase: true }, // optional
    panImage: { type: String },
}, { timestamps: true, minimize: false });

const RiderApplicationModel = mongoose.model("RiderApplication", RiderApplicationSchema);

export default RiderApplicationModel;