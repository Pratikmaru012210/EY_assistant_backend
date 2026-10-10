const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");

const dataStore = require("../store/dataStore");

const router = express.Router();

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

      return res.json({
        success: true,
        rows: jsonData.length,
        columns: Object.keys(jsonData[0]),
        sampleRow: jsonData[0],
        jsonData: jsonData
      });
    } catch (err) {
      console.error("Upload Route Error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

// Rehydrate endpoint: restores backend RAM dataStore from client-stored IndexedDB JSON
router.post("/rehydrate", (req, res) => {
  try {
    const { jsonData } = req.body;
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
      return res.status(400).json({ success: false, error: "Invalid jsonData provided for rehydration." });
    }

    dataStore.setData(jsonData);
    return res.json({
      success: true,
      rows: jsonData.length,
      columns: Object.keys(jsonData[0])
    });
  } catch (err) {
    console.error("Rehydrate Route Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/", async (req, res) => {
  try {
    dataStore.clear();

    return res.json({
      success: true,
      message: "Database cleared successfully from server RAM."
    });
  } catch (err) {
    console.error("Delete Route Error:", err);
    dataStore.clear();
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;