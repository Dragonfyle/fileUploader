require("dotenv").config();
import net from "net";
import fs from "fs/promises";
import path from "path";
import readline, { Key, clearLine, moveCursor } from "readline";
import { Transform } from "stream";

const PROTOCOL = {
  KEYWORDS: {
    WAITING_FOR_OTHER_SOCKET: "wfos",
    PASSWORD: "pswd",
    PASSWORD_ERROR: "pswd-err",
    CONNECTED: "cnctd",
    DISCONNECTED: "dcnctd",
    WAITING_FOR_FILE_NAME: "wffn",
    WAITING_FOR_FILE_CONTENTS: "wffc",
    FILE_NAME: "fnm",
    FILE_CONTENTS: "fct",
  },
} as const;

type Keyword = (typeof PROTOCOL.KEYWORDS)[keyof typeof PROTOCOL.KEYWORDS];
type KeywordQueue = Keyword[];

type Packet = {
  keywords: KeywordQueue;
  payload?: any;
};

const NULL_BYTE = 0x00;

function createPacket(keywords: KeywordQueue, payload?: any) {
  const packet = {
    keywords,
    payload,
  };

  return JSON.stringify(packet);
}

const port = Number(process.env.SERVER_PORT || "");
const ip = process.env.SERVER_IP || "";

const socket = net.createConnection(port, ip, () => {
  console.log("\nserver reached");
});

let sourcePath: string;
let fileName;

function showWaitingForOtherSocket() {
  // process.stdin.pause();
  let isFirstTick = true;

  let dots = "";
  const intervalId = setInterval(() => {
    dots += ".";
    if (dots.length > 5) {
      dots = "";
    }

    if (!isFirstTick) {
      moveCursor(process.stdout, 0, -1);
      clearLine(process.stdout, 0);
    }

    console.log(`\rWaiting for the other client to connect${dots}`);

    isFirstTick = false;
  }, 500);

  return () => {
    clearInterval(intervalId);
    process.stdin.resume();
  };
}

let intervalUnsubscribe: () => void;

let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

let isConnected = false;
let buffer = "";
const keywordQueue: KeywordQueue = [];

socket.on("data", async (data) => {
  buffer += data.toString();
  console.log(buffer.toString());

  if (data[data.length - 1] !== NULL_BYTE) return;

  buffer = buffer.slice(0, -1);
  const dataParsed: Packet = JSON.parse(buffer);
  console.log(dataParsed);
  const keywords = dataParsed.keywords;
  const payload = dataParsed.payload;

  buffer = "";

  for (const keyword of keywords) {
    if (keyword === PROTOCOL.KEYWORDS.PASSWORD) {
      rl.question("Enter password: ", (password) => {
        socket.write(createPacket([PROTOCOL.KEYWORDS.PASSWORD], password));
        socket.write(Buffer.from([NULL_BYTE]));
      });
    } else if (keyword === PROTOCOL.KEYWORDS.PASSWORD_ERROR) {
      console.log("\nPassword incorrect");
    } else if (keyword === PROTOCOL.KEYWORDS.DISCONNECTED) {
      console.log("The other client disconnected.");
    } else if (keyword === PROTOCOL.KEYWORDS.WAITING_FOR_OTHER_SOCKET) {
      if (!isConnected) {
        console.log("\nConnected to server");
      }
      isConnected = true;

      intervalUnsubscribe = showWaitingForOtherSocket();
    } else if (keyword === PROTOCOL.KEYWORDS.WAITING_FOR_FILE_NAME) {
      if (!isConnected) {
        console.log("\nConnected to server");
      }
      isConnected = true;

      if (intervalUnsubscribe) {
        intervalUnsubscribe();
      }

      moveCursor(process.stdout, 4, 0);

      rl.question("Enter file path: ", async (filePath) => {
        sourcePath = filePath;
        fileName = path.basename(filePath);

        const fileNamePacket = createPacket(
          [PROTOCOL.KEYWORDS.FILE_NAME],
          fileName
        );

        socket.write(fileNamePacket);
        socket.write(Buffer.from([NULL_BYTE]));
      });
    } else if (keyword === PROTOCOL.KEYWORDS.FILE_CONTENTS) {
      const fileHandle = await fs.open("./downloads/file.txt", "w");
      const writeStream = fileHandle.createWriteStream();
      const buffer = Buffer.from(payload.data);
      writeStream.write(buffer, () => fileHandle.close());
    } else if (
      keyword === PROTOCOL.KEYWORDS.WAITING_FOR_FILE_CONTENTS &&
      sourcePath
    ) {
      let fileHandle;

      try {
        fileHandle = await fs.open(sourcePath, "r");

        const transformStream = new Transform({
          transform(chunk, encoding, callback) {
            const wrappedChunk = createPacket(
              [PROTOCOL.KEYWORDS.FILE_CONTENTS],
              chunk
            );
            callback(null, wrappedChunk);
          },
        });

        const fileReadStream = fileHandle.createReadStream();

        fileReadStream.pipe(transformStream).pipe(socket, { end: false });
        fileReadStream.on("end", () => {
          socket.write(Buffer.from([NULL_BYTE]));
        });
      } catch (error) {
        console.log(`Error while opening file: ${sourcePath}`);
      }
    }
  }
});

let pathBuffer = "";

// process.stdin.on("data", async (data) => {
// if (isConnected) {
// pathBuffer += data.toString();
//
// fileReadStream.on("end", () => {
// console.log("File sent successfully");
// fileHandle.close();
// });
// }
// }
// } else {
// }
// });

// process.stdin.on("data", (data) => {
// data.p;
//
//
//
// if (!socket.write(data)) {
// process.stdin.pause();
// }
//
// process.stdin.on("drain", () => {
// process.stdin.resume();
// });
// });
