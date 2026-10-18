import dotenv from "dotenv";

dotenv.config();

const env = process.env;

const Envs = {
    PORT: env.PORT,
    MONGO_URL: env.MONGO_URL,
    JWT_SECRET: env.JWT_SECRET,

    // cloudinary (rider profile picture)
    CLOUDINARY_CLOUD_NAME: env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: env.CLOUDINARY_API_SECRET,

    // grpc
    GRPC_PORT: env.GRPC_PORT || 3006,
    ORDER_GRPC_URL: env.ORDER_GRPC_URL || "127.0.0.1:3004",
    INTERNAL_GRPC_KEY: env.INTERNAL_GRPC_KEY || "ecommerce_grpc_internal_secret_key_2026",

    // retry failed order-status updates (ms)
    SYNC_RECONCILE_MS: Number(env.SYNC_RECONCILE_MS) || 60000,

    // delivery rules
    OTP_LENGTH: Number(env.OTP_LENGTH) || 4,
    OTP_VALID_DAYS: Number(env.OTP_VALID_DAYS) || 10,
    MAX_OTP_ATTEMPTS: Number(env.MAX_OTP_ATTEMPTS) || 5,
    OTP_LOCK_MINUTES: Number(env.OTP_LOCK_MINUTES) || 15,
    MAX_ACTIVE_DELIVERIES: Number(env.MAX_ACTIVE_DELIVERIES) || 2,
};

export default Envs;