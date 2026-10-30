import mongoose from "mongoose";
import Envs from "../utils/Envs.js";

let paymentConn = null;
let productConn = null;
let userConn = null;
let addressConn = null;

const getPaymentConn = () => {
    if (!paymentConn && Envs.PAYMENT_MONGO_URL) {
        paymentConn = mongoose.createConnection(Envs.PAYMENT_MONGO_URL);
    }
    return paymentConn;
};

const getProductConn = () => {
    if (!productConn && Envs.PRODUCT_MONGO_URL) {
        productConn = mongoose.createConnection(Envs.PRODUCT_MONGO_URL);
    }
    return productConn;
};

const getUserConn = () => {
    if (!userConn && Envs.USER_MONGO_URL) {
        userConn = mongoose.createConnection(Envs.USER_MONGO_URL);
    }
    return userConn;
};

const getAddressConn = () => {
    if (!addressConn && Envs.ADDRESS_MONGO_URL) {
        addressConn = mongoose.createConnection(Envs.ADDRESS_MONGO_URL);
    }
    return addressConn;
};

/**
 * Resolves the vendor / store details (store name, store phone, and pickup address)
 * from order -> product -> vendor user -> vendor address.
 */
const resolveVendorDetails = async (orderId, items = []) => {
    try {
        let productId = null;
        let productName = null;

        // 1. Check order in Payment service if orderId is valid
        if (orderId && mongoose.isValidObjectId(orderId)) {
            try {
                const pConn = getPaymentConn();
                if (pConn) {
                    const order = await pConn.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) });
                    if (order?.items?.[0]) {
                        productId = order.items[0].productId;
                        productName = order.items[0].name;
                    }
                }
            } catch (err) {
                console.error("[VendorResolver] error reading order:", err.message);
            }
        }

        // Fallback to delivery items if order had no items
        if (!productName && Array.isArray(items) && items.length > 0) {
            productName = items[0]?.name;
        }

        // 2. Find product to get vendor (createdby)
        let vendorId = null;
        try {
            const prodConn = getProductConn();
            if (prodConn) {
                let prod = null;
                if (productId && mongoose.isValidObjectId(productId)) {
                    prod = await prodConn.collection("products").findOne({ _id: new mongoose.Types.ObjectId(productId) });
                }
                if (!prod && productName) {
                    prod = await prodConn.collection("products").findOne({ name: productName });
                }
                if (prod?.createdby) {
                    vendorId = prod.createdby;
                }
            }
        } catch (err) {
            console.error("[VendorResolver] error reading product:", err.message);
        }

        if (!vendorId) {
            return { storeName: "", storePhone: "", pickupAddress: "" };
        }

        // 3. Find vendor user details (store_name, name, phone)
        let vendor = null;
        try {
            const uConn = getUserConn();
            if (uConn && mongoose.isValidObjectId(vendorId)) {
                vendor = await uConn.collection("users").findOne({ _id: new mongoose.Types.ObjectId(vendorId) });
            }
        } catch (err) {
            console.error("[VendorResolver] error reading vendor user:", err.message);
        }

        // 4. Find vendor store address
        let vendorAddress = null;
        try {
            const aConn = getAddressConn();
            if (aConn && mongoose.isValidObjectId(vendorId)) {
                vendorAddress = await aConn.collection("addresses").findOne({ userId: new mongoose.Types.ObjectId(vendorId) });
            }
        } catch (err) {
            console.error("[VendorResolver] error reading vendor address:", err.message);
        }

        const storeName = vendor?.store_name || vendorAddress?.full_name || vendor?.name || "";
        const storePhone = vendorAddress?.phone || vendor?.phone || "";
        const formattedAddress = [
            vendorAddress?.building_number,
            vendorAddress?.street,
            vendorAddress?.landmark,
            vendorAddress?.city,
            vendorAddress?.state,
            vendorAddress?.pincode,
            vendorAddress?.country,
        ].filter(Boolean).join(", ");

        return {
            storeName,
            storePhone,
            pickupAddress: formattedAddress,
        };
    } catch (error) {
        console.error("[VendorResolver] resolveVendorDetails error:", error.message);
        return { storeName: "", storePhone: "", pickupAddress: "" };
    }
};

/**
 * Finds the customer email from the user service database (users collection).
 * Returns an empty string when it cannot be found.
 */
const resolveCustomerEmail = async (customerId) => {
    try {
        if (!customerId || !mongoose.isValidObjectId(customerId)) return "";
        const uConn = getUserConn();
        if (!uConn) return "";
        const user = await uConn.collection("users").findOne(
            { _id: new mongoose.Types.ObjectId(String(customerId)) },
            { projection: { email: 1 } }
        );
        return user?.email ? String(user.email).trim() : "";
    } catch (err) {
        console.error("[VendorResolver] error reading customer email:", err.message);
        return "";
    }
};

export { resolveVendorDetails, resolveCustomerEmail };