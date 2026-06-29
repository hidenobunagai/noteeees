"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectNoteFiles = collectNoteFiles;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
async function collectNoteFiles(dir, excludeDirs = []) {
    const results = [];
    async function walk(currentDir) {
        let entries;
        try {
            entries = await fs.readdir(currentDir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".")) {
                continue;
            }
            const full = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (excludeDirs.includes(entry.name)) {
                    continue;
                }
                await walk(full);
            }
            else if (entry.isFile() && entry.name.endsWith(".md")) {
                try {
                    const stat = await fs.stat(full);
                    results.push({
                        filePath: full,
                        relativePath: path.relative(dir, full),
                        mtime: stat.mtimeMs,
                    });
                }
                catch {
                    // skip unreadable files
                }
            }
        }
    }
    await walk(dir);
    results.sort((left, right) => left.filePath.localeCompare(right.filePath));
    return results;
}
