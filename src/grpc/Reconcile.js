import DeliveryModel from "../models/Deliverymodel.js";
import Envs from "../utils/Envs.js";
import { updateOrderStatus } from "./Grpchelper.js";

// Retries every order-status update that failed earlier (orderSynced:false).
// orderSynced is set back to true ONLY after the order service confirms the update.
const SYNC_STATUS = { PICKED_UP: "OUT_FOR_DELIVERY", DELIVERED: "DELIVERED" };

let running = false;

const reconcileOrders = async () => {
    if (running) return;
    running = true;
    try {
        const pending = await DeliveryModel.find({ orderSynced: false, status: { $in: Object.keys(SYNC_STATUS) } })
            .select("orderId status deliveredAt")
            .limit(50)
            .lean();

        for (const d of pending) {
            const ok = await updateOrderStatus(
                d.orderId,
                SYNC_STATUS[d.status],
                d.deliveredAt ? new Date(d.deliveredAt).toISOString() : ""
            );
            // status in the filter: if it moved on meanwhile, the next round handles the new status
            if (ok) await DeliveryModel.updateOne({ _id: d._id, status: d.status }, { $set: { orderSynced: true } });
        }
    } catch (error) {
        console.error("Order sync reconcile error:", error.message);
    } finally {
        running = false;
    }
};

const startReconciler = () => {
    const timer = setInterval(reconcileOrders, Envs.SYNC_RECONCILE_MS);
    timer.unref();
};

export { reconcileOrders, startReconciler };