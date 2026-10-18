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

export { updateOrderStatus };