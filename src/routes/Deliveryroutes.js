import express from "express";
import Authmiddleware from "../middlewares/Authmiddleware.js";
import Ratelimit from "../middlewares/Ratelimit.js";
import {
    AvailableDeliveries, AcceptDelivery, DeclineDelivery, CancelDelivery,
    PickupDelivery, CompleteDelivery, MyActiveDeliveries, MyDeliveryHistory, GetMyDelivery,
} from "../controllers/Deliverycontroller.js";

const Deliveryroute = express.Router();

const limit = (max) => Ratelimit(60 * 1000, max, 5 * 60 * 1000);

// list (keep /my/* above /:id)
Deliveryroute.get("/deliveries/available", limit(30), Authmiddleware, AvailableDeliveries);
Deliveryroute.get("/deliveries/my/active", limit(30), Authmiddleware, MyActiveDeliveries);
Deliveryroute.get("/deliveries/my/history", limit(20), Authmiddleware, MyDeliveryHistory);
Deliveryroute.get("/deliveries/:id", limit(30), Authmiddleware, GetMyDelivery);

// ride actions
Deliveryroute.post("/deliveries/:id/accept", limit(15), Authmiddleware, AcceptDelivery);
Deliveryroute.post("/deliveries/:id/decline", limit(20), Authmiddleware, DeclineDelivery);
Deliveryroute.post("/deliveries/:id/cancel", limit(10), Authmiddleware, CancelDelivery);
Deliveryroute.patch("/deliveries/:id/pickup", limit(15), Authmiddleware, PickupDelivery);
Deliveryroute.post("/deliveries/:id/deliver", limit(20), Authmiddleware, CompleteDelivery);

export default Deliveryroute;