require("dotenv").config();

const express = require("express");
const cors = require("cors");
const uploadRoute = require("./routes/upload");
const chatRoute = require("./routes/chat");
const app = express();


// Configure CORS options
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [];

const corsOptions = {
  origin: (origin, callback) => {
    // If ALLOWED_ORIGINS is not configured, allow all origins
    if (!process.env.ALLOWED_ORIGINS) {
      return callback(null, true);
    }
    // Allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes("*")) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
app.use(express.json());

app.use("/api/upload", uploadRoute);
app.use("/api/chat", chatRoute);
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});