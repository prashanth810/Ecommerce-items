import multer from 'multer';
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import Envs from '../utils/Envs.js';

// ─── Cloudinary Config ────────────────────────────────────────────────────────
cloudinary.config({
    cloud_name: Envs.CLOUDINARY_CLOUD_NAME,
    api_key: Envs.CLOUDINARY_API_KEY,
    api_secret: Envs.CLOUDINARY_API_SECRET,
});

// ─── Multer (memory storage — no disk, no cloudinary plugin needed) ───────────
const upload = multer({ storage: multer.memoryStorage() });

// ─── Upload buffer → Cloudinary ───────────────────────────────────────────────
const uploadToCloudinary = (fileBuffer, folder = "users") => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
    });
};

// ─── Upload a PRIVATE document (Aadhaar, licence, PAN) ─────────────────────────
// type "authenticated" = the image can't be opened with a plain URL. Returns the public_id (not a URL).
const uploadPrivateToCloudinary = (fileBuffer, folder = "private") => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder, type: "authenticated", resource_type: "image" },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.public_id);
            }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
    });
};

// ─── Delete helpers (never throw: a failed clean-up must not break an API call) ───────
// public image: needs the public_id, which is inside the url
// https://res.cloudinary.com/<cloud>/image/upload/v123/riders/profile_pic/abc.jpg -> riders/profile_pic/abc
const deleteFromCloudinaryByUrl = async (url) => {
    try {
        if (!url) return;
        const parts = url.split("/");
        const uploadIndex = parts.indexOf("upload");
        if (uploadIndex === -1) return;
        const fullPath = parts.slice(uploadIndex + 2).join("/");
        await cloudinary.uploader.destroy(fullPath.substring(0, fullPath.lastIndexOf(".")));
    } catch (err) {
        console.warn("Old image deletion failed:", err.message);
    }
};

// private document (stored with uploadPrivateToCloudinary): we already keep the public_id
const deletePrivateFromCloudinary = async (publicId) => {
    try {
        if (!publicId) return;
        await cloudinary.uploader.destroy(publicId, { type: "authenticated", resource_type: "image" });
    } catch (err) {
        console.warn("Private document deletion failed:", err.message);
    }
};

export { upload, uploadToCloudinary, uploadPrivateToCloudinary, deleteFromCloudinaryByUrl, deletePrivateFromCloudinary, cloudinary };