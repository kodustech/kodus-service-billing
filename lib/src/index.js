"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
require("reflect-metadata");
const database_1 = require("./config/database");
const subscription_routes_1 = __importDefault(require("./routes/subscription.routes"));
const cors_2 = __importDefault(require("./config/utils/cors"));
const cron_1 = __importDefault(require("./cron"));
require("dotenv/config");
const app = (0, express_1.default)();
const port = process.env.API_PORT || 3992;
(0, database_1.initializeDatabase)()
    .then(() => {
    console.log("Database initialized successfully!");
    cron_1.default;
})
    .catch((err) => {
    console.error("Error during database initialization", err);
});
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)(cors_2.default));
app.post("/webhook", express_1.default.raw({ type: "application/json" }));
app.use(body_parser_1.default.urlencoded({ extended: false }));
app.use(body_parser_1.default.json({ limit: "10mb" }));
app.use("/api/billing", subscription_routes_1.default);
app.listen(port, () => {
    console.log(`billing service listening to port ${port}`);
});
//# sourceMappingURL=index.js.map