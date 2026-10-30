import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
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
    AUTH_GRPC_URL: env.AUTH_GRPC_URL || "127.0.0.1:3005",
    INTERNAL_GRPC_KEY: env.INTERNAL_GRPC_KEY,

    // retry failed order-status updates (ms)
    SYNC_RECONCILE_MS: Number(env.SYNC_RECONCILE_MS) || 60000,

    // delivery rules
    OTP_LENGTH: Number(env.OTP_LENGTH) || 4,
    OTP_VALID_DAYS: Number(env.OTP_VALID_DAYS) || 10,
    MAX_OTP_ATTEMPTS: Number(env.MAX_OTP_ATTEMPTS) || 5,
    OTP_LOCK_MINUTES: Number(env.OTP_LOCK_MINUTES) || 15,
    MAX_ACTIVE_DELIVERIES: Number(env.MAX_ACTIVE_DELIVERIES) || 2,

    // cross-service database URLs for resolving vendor / store information
    PAYMENT_MONGO_URL: env.PAYMENT_MONGO_URL,
    PRODUCT_MONGO_URL: env.PRODUCT_MONGO_URL,
    USER_MONGO_URL: env.USER_MONGO_URL,
    ADDRESS_MONGO_URL: env.ADDRESS_MONGO_URL,

    // email (delivery OTP mail to the customer)
    SMTP_HOST: env.SMTP_HOST || env.HOST_NUMBER || "smtp.gmail.com",
    SMTP_PORT: Number(env.SMTP_PORT || env.PORT_NUMBER) || 587,
    SMTP_SECURE: env.SMTP_SECURE === "true" || (Number(env.SMTP_PORT || env.PORT_NUMBER) === 465),
    SMTP_USER: env.SMTP_USER || env.USER_MAIL || "",
    SMTP_PASS: env.SMTP_PASS || env.APP_PASS || "",
    MAIL_FROM: env.MAIL_FROM || env.USER_MAIL || env.SMTP_USER || "",

    // legacy aliases
    HOST_NUMBER: env.HOST_NUMBER || env.SMTP_HOST || "smtp.gmail.com",
    PORT_NUMBER: Number(env.PORT_NUMBER || env.SMTP_PORT) || 587,
    USER_MAIL: env.USER_MAIL || env.SMTP_USER || "",
    APP_PASS: env.APP_PASS || env.SMTP_PASS || "",
};

export default Envs;
