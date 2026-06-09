let excelData = [];
let fileId = null;

module.exports = {
  setData: (data) => {
    excelData = data;
  },

  getData: () => {
    return excelData;
  },

  setFileId: (id) => {
    fileId = id;
  },

  getFileId: () => {
    return fileId;
  },

  clear: () => {
    excelData = [];
    fileId = null;
  }
};