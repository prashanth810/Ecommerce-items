import express from "express";
import { AdminAuth } from "../middlewares/Authmiddleware.js";
import Ratelimit from "../middlewares/Ratelimit.js";
import {
    getPendingRiders,
    verifyRider,
    getAllRiders,
    getRiderById,
} from "../controllers/Adminridercontroller.js";

const Adminrouter = express.Router();
const limit = (max) => Ratelimit(60 * 1000, max, 5 * 60 * 1000);

// ─── Admin Rider Verification Endpoints ─────────────────────────────────────

// GET /api/auth/v6/admin/riders/pending - Get all riders pending admin verification
Adminrouter.get("/admin/riders/pending", limit(30), AdminAuth, getPendingRiders);

// GET /api/auth/v6/admin/riders - Get all riders (optional ?status=pending|verified|rejected)
Adminrouter.get("/admin/riders", limit(30), AdminAuth, getAllRiders);

// GET /api/auth/v6/admin/riders/:id - Get a single rider's full details
Adminrouter.get("/admin/riders/:id", limit(30), AdminAuth, getRiderById);

// PATCH & POST /api/auth/v6/admin/riders/:id/verify - Approve or reject rider account
// Body: { action: "approve" | "reject", reason?: string }
// Automatically sends email to rider on verification!
Adminrouter.patch("/admin/riders/:id/verify", limit(20), AdminAuth, verifyRider);
Adminrouter.post("/admin/riders/:id/verify", limit(20), AdminAuth, verifyRider);

// Direct shortcut path for convenience:
// PATCH /api/auth/v6/admin/verify-rider/:id
Adminrouter.patch("/admin/verify-rider/:id", limit(20), AdminAuth, verifyRider);
Adminrouter.post("/admin/verify-rider/:id", limit(20), AdminAuth, verifyRider);

export default Adminrouter;

