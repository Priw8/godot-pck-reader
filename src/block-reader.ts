import { type FileHandle } from "fs/promises";
import { read as readWithClb } from "fs";
import { promisify } from "util";
const read = promisify(readWithClb);

export const MAX_BLOCK_SIZE = 4096;

// Utility class to avoid repeated small sequential file reads and instead read larger chunks for efficiency
export class BlockReader {
    private blockBufferOffset = -1;
    private blockBufferContentSize = -1;
    private blockBuffer = Buffer.alloc(MAX_BLOCK_SIZE);
    constructor(private readonly handle: FileHandle) {}

    public async read(count: number, offset: number, maxPrefetchSize = MAX_BLOCK_SIZE) {
        if (maxPrefetchSize > MAX_BLOCK_SIZE) {
            throw new Error(`maxPrefetchSize exceeds maximum of ${MAX_BLOCK_SIZE}`);
        }

        if (
            this.blockBufferOffset != -1 &&
            offset >= this.blockBufferOffset &&
            offset + count < this.blockBufferOffset + this.blockBufferContentSize
        ) {
            const virtualOffset = offset - this.blockBufferOffset;
            return this.blockBuffer.subarray(virtualOffset, virtualOffset + count);
        }

        const res = await read(this.handle.fd, this.blockBuffer, 0, maxPrefetchSize, offset);
        this.blockBufferOffset = offset;
        this.blockBufferContentSize = res.bytesRead;
        if (res.bytesRead < count) {
            throw new Error(`failed to read ${count} bytes`);
        }

        return this.blockBuffer.subarray(0, count);
    }
}
