import { AsyncLocalStorage } from "node:async_hooks";
import { type LibSQLDatabase } from "drizzle-orm/libsql";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { promisify } from "node:util";

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

/**
 * Global Request/Thread-scoped Database Context Storage
 */
export const dbContext = new AsyncLocalStorage<LibSQLDatabase<any>>();

/**
 * Proprietary Database Format Constants
 */
export const LAI_FILE_EXTENSION = ".lai";
export const LAI_MAGIC_HEADER = Buffer.from("LAIPH1", "utf8"); // 6-byte header signature

/**
 * Gzip Compression Options optimized for high-density production datasets
 */
export const GZIP_COMPRESSION_OPTIONS: zlib.ZlibOptions = {
  level: zlib.constants.Z_BEST_COMPRESSION,
  memLevel: 9,
};

/**
 * Enforces that any database path strictly uses the proprietary `.lai` file extension.
 */
export function ensureLaiExtension(filePath: string): string {
  if (!filePath) return `database${LAI_FILE_EXTENSION}`;
  const ext = path.extname(filePath);
  if (ext.toLowerCase() === LAI_FILE_EXTENSION) {
    return filePath;
  }
  if (ext) {
    return filePath.slice(0, -ext.length) + LAI_FILE_EXTENSION;
  }
  return filePath + LAI_FILE_EXTENSION;
}

/**
 * Utility to check if a file path ends with the .lai extension.
 */
export function isLaiFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === LAI_FILE_EXTENSION;
}

/**
 * Synchronously serializes database data into the proprietary binary `.lai` container format
 * using Gzip compression (Z_BEST_COMPRESSION) to optimize disk space.
 */
export function serializeLaiData(data: any): Buffer {
  const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
  const rawBuffer = Buffer.from(jsonStr, "utf8");
  const compressed = zlib.gzipSync(rawBuffer, GZIP_COMPRESSION_OPTIONS);
  const checksum = crypto.createHash("sha256").update(compressed).digest();

  const header = Buffer.alloc(6 + 32 + 4);
  LAI_MAGIC_HEADER.copy(header, 0);
  checksum.copy(header, 6);
  header.writeUInt32BE(compressed.length, 38);

  return Buffer.concat([header, compressed]);
}

/**
 * Asynchronously serializes database data into the proprietary binary `.lai` container format
 * using non-blocking Gzip compression for production datasets.
 */
export async function serializeLaiDataAsync(data: any): Promise<Buffer> {
  const jsonStr = typeof data === "string" ? data : JSON.stringify(data);
  const rawBuffer = Buffer.from(jsonStr, "utf8");
  const compressed = await gzipAsync(rawBuffer, GZIP_COMPRESSION_OPTIONS);
  const checksum = crypto.createHash("sha256").update(compressed).digest();

  const header = Buffer.alloc(6 + 32 + 4);
  LAI_MAGIC_HEADER.copy(header, 0);
  checksum.copy(header, 6);
  header.writeUInt32BE(compressed.length, 38);

  return Buffer.concat([header, compressed]);
}

/**
 * Synchronously deserializes a proprietary binary `.lai` container buffer (Gzip decompressed) into structured database data.
 */
export function deserializeLaiData<T = any>(buffer: Buffer): T {
  if (buffer.length < 42) {
    throw new Error("INVALID_LAI_FORMAT: Buffer size is smaller than LAI binary header structure");
  }

  const magic = buffer.subarray(0, 6);
  if (!magic.equals(LAI_MAGIC_HEADER)) {
    throw new Error("INVALID_LAI_MAGIC_HEADER: Unrecognized proprietary .lai file header");
  }

  const expectedChecksum = buffer.subarray(6, 38);
  const payloadSize = buffer.readUInt32BE(38);
  const compressedPayload = buffer.subarray(42, 42 + payloadSize);

  const actualChecksum = crypto.createHash("sha256").update(compressedPayload).digest();
  if (!actualChecksum.equals(expectedChecksum)) {
    throw new Error("CORRUPTED_LAI_DATA: Cryptographic SHA256 checksum mismatch for .lai database binary");
  }

  const decompressed = zlib.gunzipSync(compressedPayload);
  const jsonStr = decompressed.toString("utf8");
  return JSON.parse(jsonStr) as T;
}

/**
 * Asynchronously deserializes a proprietary binary `.lai` container buffer (Gzip decompressed) into structured database data.
 */
export async function deserializeLaiDataAsync<T = any>(buffer: Buffer): Promise<T> {
  if (buffer.length < 42) {
    throw new Error("INVALID_LAI_FORMAT: Buffer size is smaller than LAI binary header structure");
  }

  const magic = buffer.subarray(0, 6);
  if (!magic.equals(LAI_MAGIC_HEADER)) {
    throw new Error("INVALID_LAI_MAGIC_HEADER: Unrecognized proprietary .lai file header");
  }

  const expectedChecksum = buffer.subarray(6, 38);
  const payloadSize = buffer.readUInt32BE(38);
  const compressedPayload = buffer.subarray(42, 42 + payloadSize);

  const actualChecksum = crypto.createHash("sha256").update(compressedPayload).digest();
  if (!actualChecksum.equals(expectedChecksum)) {
    throw new Error("CORRUPTED_LAI_DATA: Cryptographic SHA256 checksum mismatch for .lai database binary");
  }

  const decompressed = await gunzipAsync(compressedPayload);
  const jsonStr = decompressed.toString("utf8");
  return JSON.parse(jsonStr) as T;
}

/**
 * Asynchronously writes database data in the compressed `.lai` binary format,
 * enforcing the `.lai` file extension and Gzip compression across internal backend operations.
 */
export async function writeLaiDatabaseFile(filePath: string, data: any): Promise<string> {
  const enforcedPath = ensureLaiExtension(filePath);
  const dir = path.dirname(enforcedPath);
  await fs.mkdir(dir, { recursive: true });

  const binaryBuffer = await serializeLaiDataAsync(data);
  await fs.writeFile(enforcedPath, binaryBuffer);
  return enforcedPath;
}

/**
 * Synchronously writes database data in the compressed `.lai` binary format,
 * enforcing the `.lai` file extension and Gzip compression across internal backend operations.
 */
export function writeLaiDatabaseFileSync(filePath: string, data: any): string {
  const enforcedPath = ensureLaiExtension(filePath);
  const dir = path.dirname(enforcedPath);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }

  const binaryBuffer = serializeLaiData(data);
  fsSync.writeFileSync(enforcedPath, binaryBuffer);
  return enforcedPath;
}

/**
 * Asynchronously reads, decompresses (Gzip), and deserializes a proprietary `.lai` binary database file,
 * enforcing the `.lai` file extension across internal backend operations.
 */
export async function readLaiDatabaseFile<T = any>(filePath: string): Promise<T> {
  const enforcedPath = ensureLaiExtension(filePath);
  const fileBuffer = await fs.readFile(enforcedPath);
  return deserializeLaiDataAsync<T>(fileBuffer);
}

/**
 * Synchronously reads, decompresses (Gzip), and deserializes a proprietary `.lai` binary database file,
 * enforcing the `.lai` file extension across internal backend operations.
 */
export function readLaiDatabaseFileSync<T = any>(filePath: string): T {
  const enforcedPath = ensureLaiExtension(filePath);
  const fileBuffer = fsSync.readFileSync(enforcedPath);
  return deserializeLaiData<T>(fileBuffer);
}


