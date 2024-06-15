import "dotenv/config";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import commander from "commander";
import path from "path";

const program = new commander.Command();
// const args = process.argv.slice(2);

// if (args.length < 1) {
// console.error("Usage: node upload.js <url>");
// process.exit(1);
// }
//
// const filePath = args[0];

const uploadURL = `${process.env.SERVER_IP}:${process.env.SERVER_PORT}${process.env.SERVER_UPLOAD_PATH}`;
let filePath: string;

function isOk(status: number) {
  return status >= 200 && status < 300;
}

async function uploadFile() {
  const form = new FormData();
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

program.arguments("<file>").action(async (file) => {
  console.log(file);
  try {
    filePath = path.resolve(file);

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Could not resolve path to file", error);
    process.exit(1);
  }
});

program.parse(process.argv);

uploadFile();
