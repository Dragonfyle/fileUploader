require("dotenv").config();
import net from "net";
import fs from "fs/promises";
import path from "path";
import readline, { Key, clearLine, moveCursor } from "readline";
import { Transform } from "stream";
import { WriteStream } from "fs";

const PROTOCOL = {
  KEYWORDS: {
    WAITING_FOR_PASSWORD: 1,
    PASSWORD: 2,
    PASSWORD_ERROR: 3,
    WAITING_FOR_OTHER_SOCKET: 4,
    DISCONNECTED: 5,
    WAITING_FOR_FILE_NAME: 6,
    WAITING_FOR_FILE_CONTENTS: 7,
    FILE_NAME: 8,
    FILE_CONTENTS: 9,
  },
} as const;

const KEYWORD_BYTES = 1;
const MESSAGE_LENGTH_BYTES = 4;
const FRAME_BYTES = KEYWORD_BYTES + MESSAGE_LENGTH_BYTES;

type Keyword = (typeof PROTOCOL.KEYWORDS)[keyof typeof PROTOCOL.KEYWORDS];

type Packet = {
  keyword: Keyword;
  payload: any;
  EOF: boolean;
};

function createPacket(keyword: Keyword, payload: any = [], EOF = false) {
  const packet = {
    keyword,
    payload,
    EOF,
  };

  return JSON.stringify(packet);
}

const port = Number(process.env.SERVER_PORT || "");
const ip = process.env.SERVER_IP || "";

const socket = net.createConnection(port, ip, () => {
  console.log("\nserver reached");
});

let sourcePath: string;

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
let isPipingContents = false;

const dataBuffer = new Map<Keyword, string>();
let fileWriteStream: WriteStream;

let filename: string;
let currentKeyword: Keyword | null = null;
let messageLength: number = 0;
let bytesRead = 0;
let buffer = Buffer.alloc(0);

socket.on("data", async (data) => {
  buffer = Buffer.concat([buffer, data]);

  do {
    let payload: Buffer;
    if (!currentKeyword) {
      currentKeyword = buffer.readUint8() as Keyword;
      messageLength = buffer.readUInt32BE(KEYWORD_BYTES);
      payload = buffer.subarray(FRAME_BYTES, FRAME_BYTES + messageLength);
    } else {
      payload = buffer;
    }

    bytesRead += data.length;
    buffer = buffer.subarray(FRAME_BYTES + messageLength);

    if (currentKeyword === PROTOCOL.KEYWORDS.WAITING_FOR_PASSWORD) {
      rl.question("Enter password: ", (password) => {
        handleOutboundPswd(socket, password);
      });
    } else if (currentKeyword === PROTOCOL.KEYWORDS.PASSWORD_ERROR) {
      console.log("\nPassword incorrect");
    } else if (currentKeyword === PROTOCOL.KEYWORDS.DISCONNECTED) {
      console.log("\nThe other client disconnected.");
    } else if (currentKeyword === PROTOCOL.KEYWORDS.WAITING_FOR_OTHER_SOCKET) {
      if (!isConnected) {
        console.log("\nConnected to server");
      }
      isConnected = true;

      intervalUnsubscribe = showWaitingForOtherSocket();
    } else if (currentKeyword === PROTOCOL.KEYWORDS.WAITING_FOR_FILE_NAME) {
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
        const fileName = path.basename(filePath);

        const messageBuffer = makeMessage(
          PROTOCOL.KEYWORDS.FILE_NAME,
          Buffer.from(fileName)
        );

        socket.write(messageBuffer);
      });
    } else if (currentKeyword === PROTOCOL.KEYWORDS.FILE_CONTENTS) {
      console.log("writing");
      fileWriteStream.write(payload);
      // const fileHandle = await fs.open("./downloads/file.txt", "w");
      // const writeStream = fileHandle.createWriteStream();
      //
      // writeStream.write(payload, () => fileHandle.close());
    } else if (currentKeyword === PROTOCOL.KEYWORDS.FILE_NAME) {
      console.log(`\nReceiving file: ${payload.toString()}`);
      const fileName = payload.toString();
      // const fileName = packet;
      fs.open(`./downloads/${fileName}`, "w").then((fileHandle) => {
        fileWriteStream = fileHandle.createWriteStream();
      });
      // const fileHandle = await fs.open("./downloads/file.txt", "w");
      // const writeStream = fileHandle.createWriteStream();
      //
      // writeStream.write(payload, () => fileHandle.close());
    } else if (
      currentKeyword === PROTOCOL.KEYWORDS.WAITING_FOR_FILE_CONTENTS &&
      sourcePath
    ) {
      let fileHandle;

      try {
        fileHandle = await fs.open(sourcePath, "r");

        const transformStream = new Transform({
          transform(chunk, encoding, callback) {
            this.push(makeMessage(PROTOCOL.KEYWORDS.FILE_CONTENTS, chunk));

            callback();
          },
        });

        const fileReadStream = fileHandle.createReadStream({
          highWaterMark: 16 * 1024,
        });

        const fileSize = (await fileHandle.stat()).size;

        socket.write(makeMessage(PROTOCOL.KEYWORDS.FILE_CONTENTS, fileSize));
        fileReadStream.pipe(socket, { end: false });
      } catch (error) {
        console.log(`Error while reading file: ${sourcePath}`);
      }
    }

    if (bytesRead === messageLength) {
      currentKeyword = null;
      messageLength = 0;
      bytesRead = 0;
    }
  } while (buffer.length > FRAME_BYTES + messageLength);
});

function handleOutboundPswd(socket: net.Socket, password: string) {
  const messageBuffer = makeMessage(
    PROTOCOL.KEYWORDS.PASSWORD,
    Buffer.from(password)
  );

  socket.write(messageBuffer);
}

function makeFrame(keyword: Keyword, messageLength: number) {
  const buffer = Buffer.alloc(FRAME_BYTES);

  buffer.writeUInt8(keyword);
  buffer.writeUInt32BE(messageLength, KEYWORD_BYTES);

  return buffer;
}

function makeMessage(keyword: Keyword, message?: Buffer): Buffer;
function makeMessage(keyword: Keyword, messageSize?: number): Buffer;

function makeMessage(keyword: Keyword, messageOrSize?: Buffer | number) {
  const payloadSize =
    messageOrSize instanceof Buffer ? messageOrSize.length : messageOrSize || 0;

  const messageLength = FRAME_BYTES + payloadSize;
  const messageBuffer = makeFrame(keyword, messageLength);

  if (messageOrSize instanceof Buffer) {
    return Buffer.concat([messageBuffer, messageOrSize]);
  }

  return messageBuffer;
}
