let excelData = [];

module.exports = {
  setData: (data) => {
    excelData = data;
  },

  getData: () => {
    return excelData;
  }
};