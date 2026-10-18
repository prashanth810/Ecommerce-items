import http from "http";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import Envs from "./utils/Envs.js";
import ConnectionDB from "./config/ConnectionDB.js";
import Riderroute from "./routes/Riderroutes.js";
import Deliveryroute from "./routes/Deliveryroutes.js";
import Otproute from "./routes/Otproutes.js";
import startGrpcServer from "./grpc/Grpcserver.js";
import { startReconciler } from "./grpc/Reconcile.js";
import { initSocket } from "./socket/Socket.js";

const app = express();

const PORT = Envs.PORT;

// the service cannot work without these, stop with a clear message
if (!Envs.MONGO_URL || !Envs.JWT_SECRET || !PORT) {
    console.error("Rider service needs PORT, MONGO_URL and JWT_SECRET in the .env file !!!");
    process.exit(1);
}

const corsOptions = {
    origin: (origin, callback) => {
        // Allow all origins (reflection) while supporting credentials
        callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    exposedHeaders: ["Authorization"],
};

app.use(cors(corsOptions));
app.use(morgan("dev"));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.get("/", (req, res) => {
    res.status(200).json({ success: true, message: "Rider service is running properly !!!" });
});

// rider register / login / onboarding / profile  (Riderroutes.js)
// deliveries (Deliveryroutes.js) and the customer delivery otp (Otproutes.js)
app.use("/api/auth/v6", Riderroute);
app.use("/api/auth/v6", Deliveryroute);
app.use("/api/auth/v6", Otproute);

// unknown url
app.use((req, res) => {
    res.status(404).json({ success: false, message: "Route not found !!!" });
});

// bad json body and any error thrown outside a controller
app.use((error, req, res, next) => {
    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, message: "Invalid JSON body !!!" });
    }
    console.error("Unhandled error:", error.message);
    return res.status(error.status || 500).json({ success: false, message: "Something went wrong. Please try again." });
});

// http server is needed because socket.io shares it with express
const server = http.createServer(app);
initSocket(server);

ConnectionDB().then(() => {
    server.listen(PORT, () => {
        console.log(`Rider service is running on port ${PORT}`);
    });
    startGrpcServer();
    startReconciler();
}).catch((error) => {
    console.log("error starting the server", error);
    process.exit(1);
});
