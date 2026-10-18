import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import Envs from "../utils/Envs.js";
import RiderModel from "../models/Ridermodel.js";
import DeliveryModel from "../models/Deliverymodel.js";
import BlacklistTokenModel from "../models/Blacklisttokenmodel.js";
import { previewOf } from "../htmlfiles/Preview.js";

// ---------------------------------------------------------------------------
// ONE Socket.IO server for the rider service. Only logged-in riders can connect.
//
// Frontend:  io(RIDER_SERVICE_URL, { auth: { token: "<rider JWT>" } })
//
// Server -> rider events
//   delivery:new-job      preview of a new open job (no full address / phone)
//   delivery:unavailable  { deliveryId, reason }  taken by someone else / cancelled / declined
//   delivery:assigned     { data }  full details, sent to the rider who accepted (all their devices)
//   delivery:cancelled    { deliveryId, orderId, reason }  order cancelled after this rider accepted
//   delivery:sync         { reason }  refetch GET /deliveries/available (connect, went online, missed events)
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = ["ACCEPTED", "PICKED_UP"];

let io = null;
const connected = new Map(); // riderId -> number of open sockets

const roomOf = (riderId) => `rider:${String(riderId)}`;

const initSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: { origin: true, credentials: true, methods: ["GET", "POST"] },
    });

    // same checks as Authmiddleware (role delivery, not logged out, account active)
    io.use(async (socket, next) => {
        try {
            const header = socket.handshake.headers?.authorization;
            const token = socket.handshake.auth?.token || (header ? header.split(" ")[1] : null);
            if (!token) return next(new Error("Unauthorized - No token provided"));

            const decode = jwt.verify(token, Envs.JWT_SECRET);
            if (decode.role !== "delivery") return next(new Error("Only riders can connect"));

            if (await BlacklistTokenModel.findOne({ token })) return next(new Error("Session expired"));

            const rider = await RiderModel.findById(decode.id).select("_id is_active").lean();
            if (!rider || !rider.is_active) return next(new Error("Rider not allowed"));

            socket.data.riderId = String(rider._id);
            next();
        } catch (error) {
            next(new Error("Invalid or expired token"));
        }
    });

    io.on("connection", (socket) => {
        const riderId = socket.data.riderId;

        socket.join("riders");
        socket.join(roomOf(riderId));
        connected.set(riderId, (connected.get(riderId) || 0) + 1);

        // a reconnecting app may have missed events -> tell it to reload the list
        socket.emit("delivery:sync", { reason: "connected" });

        socket.on("disconnect", () => {
            const left = (connected.get(riderId) || 1) - 1;
            if (left <= 0) connected.delete(riderId);
            else connected.set(riderId, left);
        });
    });

    return io;
};

// ---- helpers: never throw, a socket problem must not break an API call ----

// new PENDING job -> only riders who are connected + online + active + not declined + not at the max
const notifyNewJob = async (delivery) => {
    try {
        if (!io || connected.size === 0) return;

        const ids = [...connected.keys()];
        const riders = await RiderModel.find({ _id: { $in: ids }, isOnline: true, is_active: true }).select("_id").lean();
        if (riders.length === 0) return;

        const declined = new Set((delivery.declinedBy || []).map(String));
        const candidates = riders.filter((r) => !declined.has(String(r._id)));
        if (candidates.length === 0) return;

        const busy = await DeliveryModel.aggregate([
            { $match: { riderId: { $in: candidates.map((r) => r._id) }, status: { $in: ACTIVE_STATUSES } } },
            { $group: { _id: "$riderId", n: { $sum: 1 } } },
        ]);
        const full = new Set(busy.filter((b) => b.n >= Envs.MAX_ACTIVE_DELIVERIES).map((b) => String(b._id)));

        const preview = previewOf(delivery);
        for (const rider of candidates) {
            if (full.has(String(rider._id))) continue;
            io.to(roomOf(rider._id)).emit("delivery:new-job", preview);
        }
    } catch (error) {
        console.error("Socket notifyNewJob error:", error.message);
    }
};

// job is gone for everybody (accepted by someone / order cancelled). Only ids are sent.
const notifyJobUnavailable = (deliveryId, reason, exceptRiderId = null) => {
    try {
        if (!io) return;
        const target = exceptRiderId ? io.to("riders").except(roomOf(exceptRiderId)) : io.to("riders");
        target.emit("delivery:unavailable", { deliveryId: String(deliveryId), reason });
    } catch (error) {
        console.error("Socket notifyJobUnavailable error:", error.message);
    }
};

// one rider (all his devices)
const notifyRider = (riderId, event, payload) => {
    try {
        if (!io || !riderId) return;
        io.to(roomOf(riderId)).emit(event, payload);
    } catch (error) {
        console.error("Socket notifyRider error:", error.message);
    }
};

export { initSocket, notifyNewJob, notifyJobUnavailable, notifyRider };