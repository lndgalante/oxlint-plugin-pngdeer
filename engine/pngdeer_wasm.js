export class Compressed {
    static __wrap(ptr) {
        const obj = Object.create(Compressed.prototype);
        obj.__wbg_ptr = ptr;
        CompressedFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CompressedFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_compressed_free(ptr, 0);
    }
    /**
     * The compressed PNG file.
     * @returns {Uint8Array}
     */
    get png() {
        const ret = wasm.compressed_png(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * JSON: target, colors, variant, score, evals, miss, outcome, bytes, and a time breakdown.
     * @returns {string}
     */
    get report() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.compressed_report(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Compressed.prototype[Symbol.dispose] = Compressed.prototype.free;

export class CompressedJpeg {
    static __wrap(ptr) {
        const obj = Object.create(CompressedJpeg.prototype);
        obj.__wbg_ptr = ptr;
        CompressedJpegFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CompressedJpegFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_compressedjpeg_free(ptr, 0);
    }
    /**
     * The JPEG file.
     * @returns {Uint8Array}
     */
    get jpeg() {
        const ret = wasm.compressedjpeg_jpeg(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * JSON: target, quality, score, tries, rounds, outcome, bytes, and a time breakdown.
     * @returns {string}
     */
    get report() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.compressedjpeg_report(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) CompressedJpeg.prototype[Symbol.dispose] = CompressedJpeg.prototype.free;

export class CompressedWebp {
    static __wrap(ptr) {
        const obj = Object.create(CompressedWebp.prototype);
        obj.__wbg_ptr = ptr;
        CompressedWebpFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CompressedWebpFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_compressedwebp_free(ptr, 0);
    }
    /**
     * JSON: target, mode (lossy or lossless), quality, score, both candidates' sizes, the PNG's
     * report, bytes, and a time breakdown.
     * @returns {string}
     */
    get report() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.compressedwebp_report(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The WebP file.
     * @returns {Uint8Array}
     */
    get webp() {
        const ret = wasm.compressedwebp_webp(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) CompressedWebp.prototype[Symbol.dispose] = CompressedWebp.prototype.free;

/**
 * Compresses one PNG file to the smallest palette PNG scoring at least `target` (SSIMULACRA2), or
 * with no target at a quality picked per image (auto mode). Images over `preview_pixels` (default
 * pngdeer::PREVIEW_PIXELS, as on the command line) are searched on a downscaled preview and checked
 * at full size; 0 searches at full size, several times slower on big images.
 * @param {Uint8Array} input
 * @param {number | null} [target]
 * @param {number | null} [preview_pixels]
 * @returns {Compressed}
 */
export function compress(input, target, preview_pixels) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compress(ptr0, len0, !isLikeNone(target), isLikeNone(target) ? 0 : target, isLikeNone(preview_pixels) ? Number.MAX_SAFE_INTEGER : (preview_pixels) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return Compressed.__wrap(ret[0]);
}

/**
 * Compresses one JPEG file to the lowest quality JPEG scoring at least `target` (pngdeer::compress_jpeg),
 * never bigger than the input; with no target, at a quality picked per image.
 * @param {Uint8Array} input
 * @param {number | null} [target]
 * @returns {CompressedJpeg}
 */
export function compress_jpeg(input, target) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compress_jpeg(ptr0, len0, !isLikeNone(target), isLikeNone(target) ? 0 : target);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return CompressedJpeg.__wrap(ret[0]);
}

/**
 * Compresses one PNG file to WebP (pngdeer::compress_webp): the smaller of its palette image stored
 * losslessly and the lowest lossy quality reaching the target; with no target, TinyPNG's WebP
 * quality for the image. `preview_pixels` as for `compress`. A JPEG becomes lossy WebP, at JPEG
 * output's automatic quality.
 * @param {Uint8Array} input
 * @param {number | null} [target]
 * @param {number | null} [preview_pixels]
 * @returns {CompressedWebp}
 */
export function compress_webp(input, target, preview_pixels) {
    const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compress_webp(ptr0, len0, !isLikeNone(target), isLikeNone(target) ? 0 : target, isLikeNone(preview_pixels) ? Number.MAX_SAFE_INTEGER : (preview_pixels) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return CompressedWebp.__wrap(ret[0]);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_now_aa4ccb83129e9e55: function() {
            const ret = Date.now();
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./pngdeer_wasm_bg.js": import0,
    };
}

const CompressedFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_compressed_free(ptr, 1));
const CompressedJpegFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_compressedjpeg_free(ptr, 1));
const CompressedWebpFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_compressedwebp_free(ptr, 1));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('pngdeer_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
