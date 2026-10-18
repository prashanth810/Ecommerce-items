import mongoose from "mongoose";
import Envs from "../utils/Envs.js";

const mongo_url = Envs.MONGO_URL;

const ConnectionDB = async () => {
    try {
        await mongoose.connect(mongo_url);
        console.log("Delivery db connected success !!!");
    }
    catch (error) {
        console.error(error.message, "Error while connecting db !!!");
        throw error;
    }
};

export default ConnectionDB;