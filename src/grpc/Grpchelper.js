import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import Envs from "../utils/Envs.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));

let orderClient;
const getOrderClient = () => {
    if (!orderClient) {
        const proto = grpc.loadPackageDefinition(
            protoLoader.loadSync(path.join(__dirname, "./Order.proto"), {
                keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
            })
        );
        orderClient = new proto.order.OrderService(Envs.ORDER_GRPC_URL, grpc.credentials.createInsecure());
    }
    return orderClient;
};

// Tell the order service about a delivery status change.
// status: "OUT_FOR_DELIVERY" | "DELIVERED". Returns true/false, never throws.
const updateOrderStatus = (orderId, status, deliveredAt = "") =>
    new Promise((resolve) => {
        try {
            const metadata = new grpc.Metadata();
            metadata.set("x-internal-key", Envs.INTERNAL_GRPC_KEY || "");

            getOrderClient().UpdateOrderStatus(
                { orderId: String(orderId), status, deliveredAt },
                metadata,
                { deadline: Date.now() + 5000 },
                (error, response) => {
                    if (error) {
                        console.error("Riderservice gRPC UpdateOrderStatus error:", error.message);
                        return resolve(false);
                    }
                    resolve(Boolean(response?.success));
                }
            );
        } catch (error) {
            console.error("Riderservice gRPC UpdateOrderStatus error:", error.message);
            resolve(false);
        }
    });

// ---------- user service: get the customer email by id ----------
let authClient;
const getAuthClient = () => {
    if (!authClient) {
        const proto = grpc.loadPackageDefinition(
            protoLoader.loadSync(path.join(__dirname, "./Auth.proto"), {
                keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
            })
        );
        authClient = new proto.auth.AuthService(Envs.AUTH_GRPC_URL, grpc.credentials.createInsecure());
    }
    return authClient;
};

// Returns the email of the user, or an empty string when not found. Never throws.
const getUserEmail = (userId) =>
    new Promise((resolve) => {
        try {
            const metadata = new grpc.Metadata();
            metadata.set("x-internal-key", Envs.INTERNAL_GRPC_KEY || "");

            getAuthClient().GetUserById(
                { userId: String(userId) },
                metadata,
                { deadline: Date.now() + 5000 },
                (error, response) => {
                    if (error) {
                        console.error("Riderservice gRPC GetUserById error:", error.message);
                        return resolve("");
                    }
                    resolve(response?.success ? String(response.data?.email || "").trim() : "");
                }
            );
        } catch (error) {
            console.error("Riderservice gRPC GetUserById error:", error.message);
            resolve("");
        }
    });

export { updateOrderStatus, getUserEmail };