const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");

const dataStore = require("../store/dataStore");

const router = express.Router();

const upload = multer({
  dest: "uploads/",
});

router.post(
  "/",
  upload.single("file"),
  async (req, res) => {

    const workbook = XLSX.readFile(req.file.path);

    const sheetNames = workbook.SheetNames;

    const firstSheet = workbook.Sheets[sheetNames[0]];

    const jsonData =
      XLSX.utils.sheet_to_json(firstSheet);

    dataStore.setData(jsonData);

    return res.json({
      success: true,
      rows: jsonData.length,
      columns: Object.keys(jsonData[0]),
      sampleRow: jsonData[0]
    });
  }
);

module.exports = router;