import fs, { type FileHandle } from "fs/promises";
import { EventEmitter } from "events";
import { read as readWithClb } from "fs";
import { promisify } from "util";
import { BlockReader, MAX_BLOCK_SIZE } from "./block-reader.js";

const read = promisify(readWithClb);

interface PckFileEvents {
    ready: [];
}

const MAGICK = "GDPC"
    .split("")
    .map((c, index) => c.charCodeAt(0) << (index * 8))
    .reduce((v, a) => a + v, 0);
const SCRATCH_BUFFER_SIZE = 2048;
const PCK_HEADER_SIZE = (32 + 32 + 32 + 32 + 32 + 32 + 64 + 64) / 8;

export class PckFile extends EventEmitter<PckFileEvents> {
    private reader: BlockReader;
    private currentOffset = 0;
    private scratchBuffer = Buffer.alloc(SCRATCH_BUFFER_SIZE);

    private magick = -1;
    private packVersion = -1;
    private majorVersion = -1;
    private minorVersion = -1;
    private patchVersion = -1;
    private flags = -1;
    private dataOffset = -1;
    private indexOffset = -1;

    private entries: PckFileEntry[] = [];
    private entriesByPath: Record<string, PckFileEntry> = {};

    constructor(private readonly handle: FileHandle) {
        super();
        this.reader = new BlockReader(handle);
        void this.init();
    }

    private seek(newOffset: number) {
        this.currentOffset = newOffset;
    }

    private async readBytes(count: number, maxPrefetchSize = MAX_BLOCK_SIZE) {
        const res = await this.reader.read(count, this.currentOffset, maxPrefetchSize);

        this.currentOffset += count;
        return res;
    }

    private async readHeader() {
        const header = await this.readBytes(PCK_HEADER_SIZE, PCK_HEADER_SIZE);
        this.magick = header.readUint32LE();
        if (this.magick != MAGICK) {
            throw new Error(`This does not appear to be a .pck archive (invalid magick)`);
        }
        this.packVersion = header.readUint32LE(4);
        this.majorVersion = header.readUint32LE(8);
        this.minorVersion = header.readUint32LE(12);
        this.patchVersion = header.readUint32LE(16);
        this.flags = header.readUint32LE(20);

        // Note: operating with bigints is hell here because fs functions don't accept bigints, only numbers
        // So we can't use them (average javascript fun!). Anyhow, I expect these numbers to generally stay in
        // a range that's accurately representable as integers by float64 so this should not be a problem
        // (I mean, max safe integer in js is 2^53 - 1. To get such an offset, the file would have to be over 9 petabytes)
        this.dataOffset = Number(header.readBigUInt64LE(24).toString());
        this.indexOffset = Number(header.readBigUInt64LE(32).toString());
    }

    private async readU32() {
        const bytes = await this.readBytes(4);
        return bytes.readUInt32LE(0);
    }

    private async readIndex() {
        this.seek(this.indexOffset);
        const fileCount = await this.readU32();
        for (let i = 0; i < fileCount; ++i) {
            const pathLength = await this.readU32();
            const fileEntryBuffer = await this.readBytes(
                // path, offset, size, md5hash, flags
                pathLength + 8 + 8 + 16 + 4,
            );
            const path = fileEntryBuffer
                .subarray(0, Math.min(fileEntryBuffer.indexOf(0), pathLength))
                .toString("utf-8");

            const entry = new PckFileEntry({
                handle: this.handle,
                path: path,
                offset: fileEntryBuffer.readUint32LE(pathLength) + this.dataOffset,
                size: fileEntryBuffer.readUint32LE(pathLength + 8),
            });
            this.entries.push(entry);
            if (this.entriesByPath[path]) {
                throw new Error(`Duplicate entry in pck: ${path}`);
            }
            this.entriesByPath[path] = entry;
        }
    }

    private async init() {
        await this.readHeader();
        await this.readIndex();
        this.emit("ready");
    }

    public getEntries() {
        return this.entries;
    }

    public getEntryByPath(path: string) {
        return this.entriesByPath[path];
    }
}

export async function openPck(path: string) {
    const stat = await fs.stat(path);
    if (!stat.isFile()) {
        throw new Error(`openPck: file specified by ${path} is not a regular file`);
    }
    // This does not use readFile because we absolutely cannot load the entire thing into memory!
    const handle = await fs.open(path);
    const pck = new PckFile(handle);

    return new Promise<PckFile>((resolve, reject) => {
        pck.on("ready", async () => {
            resolve(pck);
        });
    });
}

interface PckFileEntryParams {
    handle: FileHandle;
    path: string;
    size: number;
    offset: number;
}

export class PckFileEntry {
    private handle: FileHandle;
    private path: string;
    private size: number;
    private offset: number;

    constructor(params: PckFileEntryParams) {
        this.handle = params.handle;
        this.path = params.path;
        this.size = params.size;
        this.offset = params.offset;
    }

    public getPath() {
        return this.path;
    }

    public getSize() {
        return this.size;
    }

    public async getContent() {
        const outputBuffer = Buffer.allocUnsafe(this.size);
        const res = await read(this.handle.fd, outputBuffer, 0, this.size, this.offset);
        // Because of allocUnsafe, the memory must not be returned unless it was fully written to
        if (res.bytesRead != this.size) {
            throw new Error(`failed to read ${this.size} bytes from Pck entry ${this.path}`);
        }
        return res.buffer;
    }
}
