require("dotenv").config();

const fs = require("fs");
const axios = require("axios");
const FormDat = require("form-data");

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error("Usage: node upload.js <url>");
  process.exit(1);
}

const filePath = args[0];

const uploadURL = `${process.env.SERVER_IP}:${process.env.SERVER_PORT}${process.env.SERVER_UPLOAD_PATH}`;

function isOk(status: number) {
  return status >= 200 && status < 300;
}

async function uploadFile() {
  const form = new FormDat();
  form.append("headers", "Content-Type: ");
  form.append("file", fs.createReadStream(filePath));

  try {
    const response = await axios.post(uploadURL, form, {
      headers: {
        ...form.getHeaders(),
        access_token: process.env.ACCESS_TOKEN,
      },
    });

    if (!isOk(response.status)) {
      throw new Error(`Server responded with: ${response.statusText}`);
    }

    console.log("File uploaded successfully!");
  } catch (error) {
    console.error("Error uploading file:", error);
  }
}

uploadFile();
