import bcrypt from "bcrypt";
import validator from "validator";
import RiderModel from "../models/Ridermodel.js";
import RiderApplicationModel from "../models/RiderApplicationModel.js";
import CreateToken, { CreateOnboardingToken } from "../helperfunctions/Createtoken.js";
import {
    uploadToCloudinary, uploadPrivateToCloudinary, deleteFromCloudinaryByUrl, deletePrivateFromCloudinary,
} from "../config/Cloudinary.js";

// ---------------------------------------------------------------------------
// Rider register / login / onboarding.
//
//  1. POST /rider/register              name, email, password (+ optional full details)
//                                       -> creates RiderApplication OR directly creates Rider (pending verification)
//  2. PUT  /rider/onboarding/personal   phone, dob, gender, address, emergency contact, profile_pic
//  3. PUT  /rider/onboarding/vehicle    vehicle type / name / number, vehicle_images
//  4. PUT  /rider/onboarding/documents  licence, aadhaar, pan (+ images, stored PRIVATE)
//  5. POST /rider/onboarding/submit     creates the Rider (status: pending, is_active: false)
//  6. POST /rider/login                 rider (must be verified by admin) | unfinished application -> onboarding token
// ---------------------------------------------------------------------------

const VEHICLES = ["bicycle", "bike", "scooter"];
const MOTOR_VEHICLES = ["bike", "scooter"];           // these need a licence + number plate
const GENDERS = ["male", "female", "other"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MIN_AGE = 18;

const PHONE_REGEX = /^(?:\+?91|0)?[6-9]\d{9}$/;                       // same rule as the auth service
const PINCODE_REGEX = /^[1-9]\d{5}$/;
const VEHICLE_NUMBER_REGEX = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{6,12}$/;     // spaces and "-" are removed first
const LICENSE_REGEX = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{10,20}$/;
const AADHAAR_REGEX = /^[2-9]\d{11}$/;
const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;

// compared when the email does not exist, so "no such email" and "wrong password" take the same time
const DUMMY_HASH = bcrypt.hashSync("rider-login-timing-guard", 10);

const fail = (res, message, status = 400) => res.status(status).json({ success: false, message });

// ---------- small input helpers ----------
const text = (v) => {
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return String(v);
    return "";
};

// first body field that was sent (accepts camelCase and snake_case from the app)
const given = (body, ...names) => {
    for (const n of names) if (body[n] !== undefined) return body[n];
    return undefined;
};

// reads { street, city, ... } from body.address (object / JSON string / address[street]) or from flat fields
const readGroup = (body, key, flatNames) => {
    let obj = body[key];
    if (typeof obj === "string") {
        try { obj = JSON.parse(obj); } catch { obj = {}; }
    }
    if (!obj || typeof obj !== "object") obj = {};

    const out = {};
    for (const [field, flat] of Object.entries(flatNames)) {
        const v = obj[field] !== undefined ? obj[field] : body[flat];
        if (v !== undefined) out[field] = text(v);
    }
    return out;
};

const cleanPhone = (v) => {
    const c = text(v).replace(/[\s-]/g, "");
    return PHONE_REGEX.test(c) ? c.slice(-10) : null;       // only the 10 digits are stored
};

// YYYY-MM-DD, real date, not in the future, at least MIN_AGE years old
const parseBirthDate = (v) => {
    const raw = text(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "Date of birth must be in YYYY-MM-DD format !!!" };

    const dob = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(dob.getTime()) || dob.toISOString().slice(0, 10) !== raw) return { error: "Enter a valid date of birth !!!" };

    const now = new Date();
    if (dob > now) return { error: "Date of birth cannot be in the future !!!" };

    const oldest = new Date();
    oldest.setUTCFullYear(now.getUTCFullYear() - 100);
    if (dob < oldest) return { error: "Enter a valid date of birth !!!" };

    const youngest = new Date();
    youngest.setUTCFullYear(now.getUTCFullYear() - MIN_AGE);
    if (dob > youngest) return { error: `You must be at least ${MIN_AGE} years old to become a rider !!!` };

    return { value: dob };
};

const fileOf = (req, field) => req.files?.[field]?.[0] || null;
const filesOf = (req, field) => req.files?.[field] || [];

const imageError = (file, label) => (IMAGE_TYPES.includes(file.mimetype)
    ? null
    : `${label}: only jpg, jpeg, png, webp, gif formats are allowed !!!`);

// ---------- what the app may see (private document ids and the password hash never leave) ----------
const documentsDone = (a) => {
    if (!a.vehicleType || !a.aadhaarLast4 || !a.aadhaarImage) return false;
    if (MOTOR_VEHICLES.includes(a.vehicleType) && (!a.licenseNumber || !a.licenseImage)) return false;
    return true;
};

const nextStepOf = (a) => {
    if (!a.steps?.personal) return "personal";
    if (!a.steps?.vehicle) return "vehicle";
    if (!a.steps?.documents || !documentsDone(a)) return "documents";
    return "submit";
};

const applicationView = (doc) => {
    const a = doc.toObject();
    return {
        _id: a._id,
        name: a.name,
        email: a.email,
        status: a.status,
        steps: {
            personal: Boolean(a.steps?.personal),
            vehicle: Boolean(a.steps?.vehicle),
            documents: Boolean(a.steps?.documents) && documentsDone(a),
        },
        nextStep: nextStepOf(a),
        personal: {
            phone: a.phone || "",
            date_of_birth: a.date_of_birth || null,
            gender: a.gender || "",
            profile_pic: a.profile_pic || "",
            address: a.address || {},
            emergency_contact: a.emergency_contact || {},
        },
        vehicle: {
            vehicleType: a.vehicleType || "",
            vehicleName: a.vehicleName || "",
            vehicleNumber: a.vehicleNumber || "",
            vehicleImages: a.vehicleImages || [],
        },
        documents: {
            licenseNumber: a.licenseNumber || "",
            hasLicenseImage: Boolean(a.licenseImage),
            aadhaarLast4: a.aadhaarLast4 || "",
            hasAadhaarImage: Boolean(a.aadhaarImage),
            hasPanNumber: Boolean(a.panNumber),
            hasPanImage: Boolean(a.panImage),
        },
    };
};

// duplicate key error -> which field
const duplicateField = (error) => Object.keys(error?.keyPattern || error?.keyValue || {})[0] || "";

// ============================ register ============================
const RiderRegister = async (req, res) => {
    const body = req.body || {};
    try {
        const name = text(body.name || body.fullName);
        const email = text(body.email).toLowerCase();
        const password = typeof body.password === "string" ? body.password : "";
        const rawPhone = given(body, "phone", "mobile");
        const vehicleTypeSent = given(body, "vehicleType", "vehicle_type");

        if (!name) return fail(res, "Name is required !!!");
        if (name.length < 2 || name.length > 50) return fail(res, "Name must be 2 to 50 characters !!!");

        if (!email) return fail(res, "Email is required !!!");
        if (!validator.isEmail(email)) return fail(res, "Provide valid email !!!");

        if (!password.trim()) return fail(res, "Password is required !!!");
        if (password.length > 72) return fail(res, "Password must be less than 72 characters !!!");
        if (!validator.isStrongPassword(password, { minLength: 8, minLowercase: 1, minUppercase: 1, minSymbols: 1, minNumbers: 1 })) {
            return fail(res, "Provide the Strong password (8+ characters with upper, lower, number and symbol) !!!");
        }

        if (await RiderModel.exists({ email })) {
            return fail(res, "Rider already registered with this email, please login !!!", 409);
        }

        const phone = rawPhone ? cleanPhone(rawPhone) : null;
        if (rawPhone && !phone) return fail(res, "Enter a valid 10-digit mobile number !!!");
        if (phone && await RiderModel.exists({ phone })) {
            return fail(res, "Phone number already in use by another rider !!!", 409);
        }

        // ─── If full onboarding details provided (e.g. from UI all-in-one submission) ───
        if (phone || vehicleTypeSent) {
            const vehicleType = vehicleTypeSent ? text(vehicleTypeSent).toLowerCase() : "bike";
            const validVehicles = ["bicycle", "bike", "scooter"];
            if (!validVehicles.includes(vehicleType)) {
                return fail(res, "Vehicle type must be bicycle, bike, or scooter");
            }

            const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));

            // Profile photo upload if provided
            let profilePicUrl = "";
            const photoFile = fileOf(req, "photo") || fileOf(req, "profile_pic");
            if (photoFile) {
                try {
                    profilePicUrl = await uploadToCloudinary(photoFile.buffer, "riders/profiles");
                } catch (e) {
                    console.warn("Rider photo upload failed:", e.message);
                }
            }

            // Create Rider account in pending verification state
            const rider = await RiderModel.create({
                name,
                email,
                phone: phone || `temp_${Date.now()}`,
                password: hashedPassword,
                profile_pic: profilePicUrl,
                vehicleType,
                vehicleNumber: text(given(body, "vehicleNumber", "vehicle_number")).toUpperCase(),
                vehicleName: text(given(body, "vehicleModel", "vehicleName")),
                address: {
                    street: text(body.address || body.street),
                    city: text(body.city),
                    pincode: text(body.pincode),
                },
                gender: text(body.gender) || "other",
                date_of_birth: body.dob ? new Date(body.dob) : undefined,
                // Verification requirements
                is_active: false,
                is_verified: false,
                verification_status: "pending",
                verification_notes: "Awaiting admin verification",
            });

            // Clean any old unfinished application
            await RiderApplicationModel.deleteOne({ email });

            return res.status(201).json({
                success: true,
                message: "Your account is under verification. Please wait 24 - 48 hours for admin verification.",
                underVerification: true,
                data: rider.toJSON(),
            });
        }

        // ─── Otherwise: Step 1 of multi-step onboarding ────────────────────────
        const pending = await RiderApplicationModel.findOne({ email }).select("status");
        if (pending?.status === "ONBOARDING") {
            return fail(res, "Registration already started with this email, please login to continue !!!", 409);
        }
        if (pending) {
            await RiderApplicationModel.deleteOne({ _id: pending._id });
        }

        const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
        const application = await RiderApplicationModel.create({ name, email, password: hashedPassword });

        return res.status(201).json({
            success: true,
            message: "Registered success, now fill your details to finish onboarding",
            token: CreateOnboardingToken(application),
            data: applicationView(application),
        });
    }
    catch (error) {
        if (error?.code === 11000) return fail(res, "Registration already started or phone in use, please login !!!", 409);
        console.error("RiderRegister error:", error.message);
        return fail(res, "Something went wrong. Please try again.", 500);
    }
};

// ============================ login ============================

const RiderLogin = async (req, res) => {
    const { email: rawEmail, phone: rawPhone, password } = req.body || {};
    try {
        const identifier = text(rawEmail || rawPhone).toLowerCase();

        if (!identifier) return fail(res, "Email or phone number is required !!!");
        if (typeof password !== "string" || !password) {
            return fail(res, "Password is required !!!");
        }

        const invalid = () => fail(res, "Invalid email or password !!!", 401);

        // Find rider by email or phone
        const cleanedPhone = cleanPhone(identifier);
        const rider = await RiderModel.findOne({
            $or: [
                { email: identifier },
                ...(cleanedPhone ? [{ phone: cleanedPhone }] : []),
            ],
        });

        if (rider) {
            if (!(await bcrypt.compare(password, rider.password))) return invalid();

            // Check admin verification status
            if (!rider.is_verified || rider.verification_status === "pending") {
                return res.status(403).json({
                    success: false,
                    message: "Your account is under verification. Please wait 24 - 48 hours for admin verification.",
                    underVerification: true,
                });
            }

            if (rider.verification_status === "rejected") {
                return res.status(403).json({
                    success: false,
                    message: `Your rider application was not approved.${rider.verification_notes ? " Reason: " + rider.verification_notes : ""}`,
                    rejected: true,
                });
            }

            if (!rider.is_active) {
                return fail(res, "Your rider account is disabled !!!", 403);
            }

            return res.status(200).json({
                success: true,
                message: "Login successfull !!!",
                onboardingRequired: false,
                token: CreateToken(rider),
                data: rider.toJSON(),
            });
        }

        // 2. Incomplete onboarding application
        const application = await RiderApplicationModel.findOne({
            email: identifier,
            status: "ONBOARDING",
        });

        if (!application || !application.password) {
            await bcrypt.compare(password, DUMMY_HASH);
            return invalid();
        }

        if (!(await bcrypt.compare(password, application.password))) {
            return invalid();
        }

        return res.status(200).json({
            success: true,
            message: "Login successfull, please finish your onboarding !!!",
            onboardingRequired: true,
            token: CreateOnboardingToken(application),
            data: applicationView(application),
        });
    } catch (error) {
        console.error("RiderLogin error:", error.message);
        return fail(res, "Something went wrong. Please try again.", 500);
    }
};

// ============================ status ============================
const OnboardingStatus = async (req, res) => {
    return res.status(200).json({ success: true, data: applicationView(req.application) });
};

// ============================ step 1: personal ============================
const SavePersonal = async (req, res) => {
    const body = req.body || {};
    let newPic = "";
    try {
        const app = req.application;
        const old = app.toObject();

        // phone
        let phone = old.phone;
        if (body.phone !== undefined) {
            phone = cleanPhone(body.phone);
            if (!phone) return fail(res, "Enter a valid 10 digit phone number !!!");
        }
        if (!phone) return fail(res, "Phone number is required !!!");

        // date of birth
        let date_of_birth = old.date_of_birth;
        if (body.date_of_birth !== undefined) {
            const dob = parseBirthDate(body.date_of_birth);
            if (dob.error) return fail(res, dob.error);
            date_of_birth = dob.value;
        }
        if (!date_of_birth) return fail(res, "Date of birth is required !!!");

        // gender
        let gender = old.gender;
        if (body.gender !== undefined) {
            gender = text(body.gender).toLowerCase();
            if (!GENDERS.includes(gender)) return fail(res, `Gender must be one of: ${GENDERS.join(", ")} !!!`);
        }
        if (!gender) return fail(res, "Gender is required !!!");

        // address
        const address = {
            ...(old.address || {}),
            ...readGroup(body, "address", { street: "street", city: "city", state: "state", pincode: "pincode" }),
        };
        for (const [field, label] of [["street", "Street"], ["city", "City"], ["state", "State"]]) {
            if (!address[field]) return fail(res, `${label} is required !!!`);
            if (address[field].length < 2 || address[field].length > 100) return fail(res, `${label} must be 2 to 100 characters !!!`);
        }
        if (!address.pincode) return fail(res, "Pincode is required !!!");
        if (!PINCODE_REGEX.test(address.pincode)) return fail(res, "Enter a valid 6 digit pincode !!!");

        // emergency contact
        const emergency = {
            ...(old.emergency_contact || {}),
            ...readGroup(body, "emergency_contact", { name: "emergency_contact_name", phone: "emergency_contact_phone" }),
        };
        if (!emergency.name) return fail(res, "Emergency contact name is required !!!");
        if (emergency.name.length < 2 || emergency.name.length > 50) return fail(res, "Emergency contact name must be 2 to 50 characters !!!");
        const emergencyPhone = cleanPhone(emergency.phone);
        if (!emergencyPhone) return fail(res, "Enter a valid emergency contact phone number !!!");
        if (emergencyPhone === phone) return fail(res, "Emergency contact must be a different number !!!");
        emergency.phone = emergencyPhone;

        // profile picture (optional)
        const pic = fileOf(req, "profile_pic");
        if (pic) {
            const err = imageError(pic, "Profile picture");
            if (err) return fail(res, err);
        }

        // phone must be free (riders) and not used by another registration in progress
        if (phone !== old.phone) {
            const taken = (await RiderModel.exists({ phone }))
                || (await RiderApplicationModel.exists({ phone, _id: { $ne: app._id } }));
            if (taken) return fail(res, "Phone number already used !!!", 409);
        }

        // all checks passed -> only now the image is uploaded
        if (pic) newPic = await uploadToCloudinary(pic.buffer, "riders/profile_pic");

        const update = { phone, date_of_birth, gender, address, emergency_contact: emergency, "steps.personal": true };
        if (newPic) update.profile_pic = newPic;

        const saved = await RiderApplicationModel.findOneAndUpdate(
            { _id: app._id, status: "ONBOARDING" },
            { $set: update },
            { returnDocument: "after", runValidators: true }
        );

        if (!saved) {
            if (newPic) await deleteFromCloudinaryByUrl(newPic);
            return fail(res, "Rider registration not found or already completed, please login !!!", 404);
        }

        // old picture is deleted only after the new one is saved
        if (newPic && old.profile_pic) await deleteFromCloudinaryByUrl(old.profile_pic);

        return res.status(200).json({ success: true, message: "Personal details saved", data: applicationView(saved) });
    }
    catch (error) {
        if (newPic) await deleteFromCloudinaryByUrl(newPic);
        if (error?.code === 11000) return fail(res, "Phone number already used !!!", 409);
        if (error?.name === "ValidationError") return fail(res, Object.values(error.errors || {})[0]?.message || "Invalid data !!!");
        console.error("SavePersonal error:", error.message);
        return fail(res, "Something went wrong. Please try again.", 500);
    }
};

// ============================ step 2: vehicle ============================
const SaveVehicle = async (req, res) => {
    const body = req.body || {};
    let uploaded = [];
    try {
        const app = req.application;
        const old = app.toObject();

        // vehicle type
        let vehicleType = old.vehicleType;
        const typeSent = given(body, "vehicleType", "vehicle_type");
        if (typeSent !== undefined) vehicleType = text(typeSent).toLowerCase();
        if (!vehicleType) return fail(res, "Vehicle type is required !!!");
        if (!VEHICLES.includes(vehicleType)) return fail(res, `Vehicle must be one of: ${VEHICLES.join(", ")} !!!`);

        const motor = MOTOR_VEHICLES.includes(vehicleType);

        // vehicle name
        let vehicleName = old.vehicleName || "";
        const nameSent = given(body, "vehicleName", "vehicle_name");
        if (nameSent !== undefined) vehicleName = text(nameSent);
        if (motor && !vehicleName) return fail(res, "Vehicle name (model) is required !!!");
        if (vehicleName.length > 50) return fail(res, "Vehicle name must be less than 50 characters !!!");

        // number plate: only bike / scooter have one
        let vehicleNumber = "";
        if (motor) {
            const numberSent = given(body, "vehicleNumber", "vehicle_number");
            vehicleNumber = (numberSent !== undefined ? text(numberSent) : (old.vehicleNumber || "")).replace(/[\s-]/g, "").toUpperCase();
            if (!vehicleNumber) return fail(res, "Vehicle number is required !!!");
            if (!VEHICLE_NUMBER_REGEX.test(vehicleNumber)) return fail(res, "Enter a valid vehicle number (example MH12AB1234) !!!");
        }

        // images: sending new ones replaces all the old ones
        const images = filesOf(req, "vehicle_images");
        for (const img of images) {
            const err = imageError(img, "Vehicle image");
            if (err) return fail(res, err);
        }
        if (motor && images.length === 0 && (old.vehicleImages || []).length === 0) {
            return fail(res, "At least one vehicle image is required !!!");
        }

        // all checks passed -> only now the images are uploaded
        if (images.length > 0) {
            const results = await Promise.allSettled(images.map((img) => uploadToCloudinary(img.buffer, "riders/vehicle")));
            uploaded = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
            if (uploaded.length !== images.length) {
                throw new Error("Vehicle image upload failed");
            }
        }

        const update = { vehicleType, vehicleName, vehicleNumber, "steps.vehicle": true };
        if (uploaded.length > 0) update.vehicleImages = uploaded;

        let saved = await RiderApplicationModel.findOneAndUpdate(
            { _id: app._id, status: "ONBOARDING" },
            { $set: update },
            { returnDocument: "after", runValidators: true }
        );

        if (!saved) {
            for (const url of uploaded) await deleteFromCloudinaryByUrl(url);
            return fail(res, "Rider registration not found or already completed, please login !!!", 404);
        }

        // old images are deleted only after the new ones are saved
        if (uploaded.length > 0) for (const url of old.vehicleImages || []) await deleteFromCloudinaryByUrl(url);
        uploaded = [];

        // e.g. changed bicycle -> bike: a licence is needed now, so the documents step must be done again
        if (saved.steps.documents && !documentsDone(saved.toObject())) {
            saved = await RiderApplicationModel.findByIdAndUpdate(
                saved._id, { $set: { "steps.documents": false } }, { returnDocument: "after" }
            );
        }

        return res.status(200).json({ success: true, message: "Vehicle details saved", data: applicationView(saved) });
    }
    catch (error) {
        for (const url of uploaded) await deleteFromCloudinaryByUrl(url);
        if (error?.name === "ValidationError") return fail(res, Object.values(error.errors || {})[0]?.message || "Invalid data !!!");
        console.error("SaveVehicle error:", error.message);
        return fail(res, "Something went wrong. Please try again.", 500);
    }
};

// ============================ step 3: documents ============================
const SaveDocuments = async (req, res) => {
    const body = req.body || {};
    let uploaded = {};                    // field -> private public_id, to clean up if something fails
    try {
        const app = req.application;
        const old = app.toObject();

        if (!old.steps?.vehicle || !old.vehicleType) return fail(res, "Complete the vehicle step first !!!");

        const motor = MOTOR_VEHICLES.includes(old.vehicleType);

        // driving licence: only bike / scooter
        let licenseNumber = old.licenseNumber || "";
        if (motor) {
            const licenseSent = given(body, "licenseNumber", "license_number");
            if (licenseSent !== undefined) licenseNumber = text(licenseSent).replace(/[\s-]/g, "").toUpperCase();
            if (!licenseNumber) return fail(res, "Driving licence number is required !!!");
            if (!LICENSE_REGEX.test(licenseNumber)) return fail(res, "Enter a valid driving licence number !!!");
        }

        // aadhaar: the full number is checked and thrown away, only the last 4 digits are kept
        let aadhaarLast4 = old.aadhaarLast4;
        const aadhaarSent = given(body, "aadhaarNumber", "aadhaar_number");
        if (aadhaarSent !== undefined) {
            const digits = text(aadhaarSent).replace(/[\s-]/g, "");
            if (!AADHAAR_REGEX.test(digits)) return fail(res, "Enter a valid 12 digit Aadhaar number !!!");
            aadhaarLast4 = digits.slice(-4);
        }
        if (!aadhaarLast4) return fail(res, "Aadhaar number is required !!!");

        // pan (optional)
        let panNumber = old.panNumber;
        const panSent = given(body, "panNumber", "pan_number");
        if (panSent !== undefined && text(panSent) !== "") {
            panNumber = text(panSent).replace(/\s/g, "").toUpperCase();
            if (!PAN_REGEX.test(panNumber)) return fail(res, "Enter a valid PAN number (example ABCDE1234F) !!!");
        }

        // images
        const licenseImage = fileOf(req, "license_image");
        const aadhaarImage = fileOf(req, "aadhaar_image");
        const panImage = fileOf(req, "pan_image");

        for (const [file, label] of [[licenseImage, "Licence image"], [aadhaarImage, "Aadhaar image"], [panImage, "PAN image"]]) {
            if (!file) continue;
            const err = imageError(file, label);
            if (err) return fail(res, err);
        }

        if (motor && !licenseImage && !old.licenseImage) return fail(res, "Driving licence image is required !!!");
        if (!aadhaarImage && !old.aadhaarImage) return fail(res, "Aadhaar image is required !!!");
        if (panImage && !panNumber) return fail(res, "PAN number is required with the PAN image !!!");

        // all checks passed -> only now the PRIVATE images are uploaded
        const folder = `riders/private/${app._id}`;
        const jobs = [
            ["licenseImage", licenseImage, "license"],
            ["aadhaarImage", aadhaarImage, "aadhaar"],
            ["panImage", panImage, "pan"],
        ].filter(([, file]) => file);

        const results = await Promise.allSettled(jobs.map(([, file, sub]) => uploadPrivateToCloudinary(file.buffer, `${folder}/${sub}`)));
        results.forEach((r, i) => { if (r.status === "fulfilled") uploaded[jobs[i][0]] = r.value; });
        if (results.some((r) => r.status === "rejected")) throw new Error("Document upload failed");

        const update = { aadhaarLast4, "steps.documents": true };
        if (motor) update.licenseNumber = licenseNumber;
        if (panNumber) update.panNumber = panNumber;
        Object.assign(update, uploaded);

        const saved = await RiderApplicationModel.findOneAndUpdate(
            { _id: app._id, status: "ONBOARDING" },
            { $set: update },
            { returnDocument: "after", runValidators: true }
        );

        if (!saved) {
            for (const id of Object.values(uploaded)) await deletePrivateFromCloudinary(id);
            return fail(res, "Rider registration not found or already completed, please login !!!", 404);
        }

        // replaced documents are deleted only after the new ones are saved
        for (const field of Object.keys(uploaded)) await deletePrivateFromCloudinary(old[field]);
        uploaded = {};

        return res.status(200).json({ success: true, message: "Documents saved", data: applicationView(saved) });
    }
    catch (error) {
        for (const id of Object.values(uploaded)) await deletePrivateFromCloudinary(id);
        if (error?.name === "ValidationError") return fail(res, Object.values(error.errors || {})[0]?.message || "Invalid data !!!");
        console.error("SaveDocuments error:", error.message);
        return fail(res, "Something went wrong. Please try again.", 500);
    }
};

// ============================ step 4: submit ============================
const SubmitOnboarding = async (req, res) => {
    try {
        const app = await RiderApplicationModel.findOne({ _id: req.application._id, status: "ONBOARDING" });

        if (!app) return fail(res, "Rider registration not found or already completed, please login !!!", 404);

        const a = app.toObject();

        const missing = [];
        if (!a.steps?.personal) missing.push("personal");
        if (!a.steps?.vehicle) missing.push("vehicle");
        if (!a.steps?.documents || !documentsDone(a)) missing.push("documents");

        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Complete these steps first: ${missing.join(", ")} !!!`,
                missing,
            });
        }

        let rider;
        try {
            rider = await RiderModel.create({
                name: a.name,
                email: a.email,
                phone: a.phone,
                password: a.password,
                profile_pic: a.profile_pic || "",
                date_of_birth: a.date_of_birth,
                gender: a.gender,
                address: a.address,
                emergency_contact: a.emergency_contact,
                vehicleType: a.vehicleType,
                vehicleName: a.vehicleName || "",
                vehicleNumber: a.vehicleNumber || "",
                vehicleImages: a.vehicleImages || [],
                licenseNumber: a.licenseNumber || "",
                documents: {
                    licenseImage: a.licenseImage,
                    aadhaarLast4: a.aadhaarLast4,
                    aadhaarImage: a.aadhaarImage,
                    panNumber: a.panNumber,
                    panImage: a.panImage,
                },
                // Account created in pending verification state
                is_active: false,
                is_verified: false,
                verification_status: "pending",
                verification_notes: "Awaiting admin verification",
            });
        } catch (error) {
            if (error?.code === 11000) {
                const field = duplicateField(error);
                return fail(
                    res,
                    field === "phone" ? "Phone number already used !!!" : "Rider already registered, please login !!!",
                    409
                );
            }
            throw error;
        }

        // the rider exists now -> close the application and drop the password hash and the private data copy
        try {
            await RiderApplicationModel.updateOne(
                { _id: app._id },
                {
                    $set: { status: "COMPLETED", completedAt: new Date() },
                    $unset: {
                        password: "", phone: "", licenseNumber: "", licenseImage: "",
                        aadhaarLast4: "", aadhaarImage: "", panNumber: "", panImage: "",
                    },
                }
            );
        } catch (error) {
            console.error("SubmitOnboarding close application error:", error.message);
        }

        // Account is submitted for verification: do NOT send a login token!
        return res.status(201).json({
            success: true,
            message: "Your account is under verification. Please wait 24 - 48 hours for admin verification.",
            underVerification: true,
            data: rider.toJSON(),
        });
    }
    catch (error) {
        if (error?.name === "ValidationError") return fail(res, Object.values(error.errors || {})[0]?.message || "Invalid data !!!");
        console.error("SubmitOnboarding error:", error.message);
        return fail(res, "Something went wrong. Please try again.", 500);
    }
};

export { RiderRegister, RiderLogin, OnboardingStatus, SavePersonal, SaveVehicle, SaveDocuments, SubmitOnboarding };
