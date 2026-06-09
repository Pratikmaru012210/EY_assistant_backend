const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const ImageKit = require("@imagekit/nodejs");

const dataStore = require("../store/dataStore");

const router = express.Router();

// Initialize ImageKit
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || ""
});

// Configure multer to keep files in memory buffer
const upload = multer({
  storage: multer.memoryStorage(),
});

router.post(
  "/",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded." });
      }

      // 1. Parse Excel data directly from memory buffer
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetNames = workbook.SheetNames;
      const firstSheet = workbook.Sheets[sheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);

      if (!jsonData || jsonData.length === 0) {
        return res.status(400).json({ success: false, error: "The Excel sheet is empty." });
      }

      dataStore.setData(jsonData);

      // 2. Upload the raw Excel file to ImageKit (if configured)
      const hasImageKitConfig =
        process.env.IMAGEKIT_PUBLIC_KEY &&
        process.env.IMAGEKIT_PUBLIC_KEY !== "your_public_key_here" &&
        process.env.IMAGEKIT_PRIVATE_KEY &&
        process.env.IMAGEKIT_PRIVATE_KEY !== "your_private_key_here";

      let fileUrl = null;

      if (hasImageKitConfig) {
        console.log("Uploading file to ImageKit...");

        const base64File = req.file.buffer.toString("base64");
        const uploadResponse = await imagekit.files.upload({
          file: base64File,
          fileName: `${Date.now()}-${req.file.originalname}`,
          folder: "/EY"
        });
        fileUrl = uploadResponse.url;
        dataStore.setFileId(uploadResponse.fileId);
        console.log("Successfully uploaded to ImageKit:", fileUrl);
      } else {
        console.warn("ImageKit is not configured in .env. Skipping cloud file upload (data parsed locally).");
      }

      return res.json({
        success: true,
        rows: jsonData.length,
        columns: Object.keys(jsonData[0]),
        sampleRow: jsonData[0],
        fileUrl: fileUrl
      });
    } catch (err) {
      console.error("Upload Route Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.delete("/", async (req, res) => {
  try {
    const fileId = dataStore.getFileId();

    const hasImageKitConfig =
      process.env.IMAGEKIT_PUBLIC_KEY &&
      process.env.IMAGEKIT_PUBLIC_KEY !== "your_public_key_here" &&
      process.env.IMAGEKIT_PRIVATE_KEY &&
      process.env.IMAGEKIT_PRIVATE_KEY !== "your_private_key_here";

    if (fileId && hasImageKitConfig) {
      console.log(`Deleting file ${fileId} from ImageKit...`);
      await imagekit.files.delete(fileId);
      console.log("Successfully deleted file from ImageKit.");
    }

    dataStore.clear();

    return res.json({
      success: true,
      message: "Database and cloud file cleared successfully."
    });
  } catch (err) {
    console.error("Delete Route Error:", err);
    // Clear local store anyway to keep UX consistent
    dataStore.clear();
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;