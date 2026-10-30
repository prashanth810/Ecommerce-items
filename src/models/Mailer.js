import nodemailer from "nodemailer";
import Envs from "../utils/Envs.js";

// clean the values (spaces / quotes / hidden characters in .env break SMTP)
const clean = (v) => (v ?? "").toString().trim().replace(/^["']|["']$/g, "");

let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;

    const host = clean(Envs.SMTP_HOST || Envs.HOST_NUMBER) || "smtp.gmail.com";
    const port = Number(clean(Envs.SMTP_PORT || Envs.PORT_NUMBER)) || 587;
    const user = clean(Envs.SMTP_USER || Envs.USER_MAIL);
    const pass = clean(Envs.SMTP_PASS || Envs.APP_PASS).replace(/\s+/g, ""); // app password: no spaces
    const secure = port === 465 || Envs.SMTP_SECURE === true;

    if (!user || !pass) {
        throw new Error("Mail is not configured: set USER_MAIL / SMTP_USER and APP_PASS / SMTP_PASS in .env of delivery service");
    }

    transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: !secure,
        auth: { user, pass },
        tls: { servername: host },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
    });
    return transporter;
};

const sendMail = async ({ to, subject, html }) => {
    const user = clean(Envs.SMTP_USER || Envs.USER_MAIL);
    const from = clean(Envs.MAIL_FROM) || `"Delivery App" <${user}>`;
    return getTransporter().sendMail({ from, to, subject, html });
};

export default sendMail;
