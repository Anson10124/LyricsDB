// A small, typed stand-in for the Emscripten glue that ships with NetEase's
// afp.wasm. The module is C++ compiled with embind: when its constructors run
// it "registers" one function (ExtractQueryFP) and one class (vector<char>)
// by calling back into JavaScript. We record those registrations and call them
// through the wasm function table, instead of rebuilding embind's whole
// type system the way the original glue does.

// Exports of afp.wasm, named by what they do (the build minified them)
interface AfpExports {
  B: WebAssembly.Memory;
  C: () => void; // __wasm_call_ctors: runs the embind registrations
  D: WebAssembly.Table; // indirect function table
  E: (size: number) => number; // malloc
  F: (ptr: number) => void; // free
}

interface RegisteredFunction {
  argTypes: number[]; // [return type, ...argument types]
  invoker: number;
  fn: number;
}

interface RegisteredMethod {
  argTypes: number[]; // [return type, this type, ...argument types]
  invoker: number;
  context: number;
}

interface RegisteredClass {
  name: string;
  destructor: number;
}

interface NumberReader {
  size: 1 | 2 | 4 | 8;
  kind: "int" | "uint" | "float";
}

const FUNCTION_NAME = "ExtractQueryFP";
const VECTOR_CLASS = "vector<char>";
const STRING_TYPE = "std::string";

// Emval handles 0-4 are reserved for undefined, null, true and false
const FIRST_EMVAL_HANDLE = 5;

const utf8 = new TextDecoder("utf-8");

export class FingerprintRuntime {
  private readonly exports: AfpExports;
  private readonly typeNames = new Map<number, string>();
  private readonly numberReaders = new Map<number, NumberReader>();
  private readonly functions = new Map<string, RegisteredFunction>();
  private readonly classes = new Map<number, RegisteredClass>();
  // Pointer and const-pointer type IDs of each class, mapped to the class itself
  private readonly classPointerTypes = new Map<number, number>();
  private readonly methods = new Map<string, RegisteredMethod>();
  private readonly emvalHandles = new Map<number, { value: unknown; refs: number }>();
  private nextEmvalHandle = FIRST_EMVAL_HANDLE;

  private constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as unknown as AfpExports;
  }

  static async load(module: BufferSource): Promise<FingerprintRuntime> {
    // The import object needs the runtime, and the runtime needs the instance
    const holder: { runtime?: FingerprintRuntime } = {};
    const imports = { a: createImports(() => holder.runtime!) };
    const { instance } = await WebAssembly.instantiate(module, imports);
    const runtime = new FingerprintRuntime(instance);
    holder.runtime = runtime;
    runtime.exports.C();
    runtime.assertExpectedBuild();
    return runtime;
  }

  // Raw fingerprint bytes for a buffer of 8 kHz mono float samples
  extractQueryFP(pcm: Float32Array): Uint8Array {
    const fn = this.functions.get(FUNCTION_NAME)!;
    const vectorType = fn.argTypes[0]!;
    const size = this.method(vectorType, "size");
    const get = this.method(vectorType, "get");
    const vectorClass = this.classes.get(vectorType)!;

    // The C++ side takes the samples as a std::string of raw float bytes
    const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const stringPtr = this.writeStdString(bytes);
    let vectorPtr: number;
    try {
      vectorPtr = this.call(fn.invoker, fn.fn, stringPtr);
    } finally {
      this.exports.F(stringPtr);
    }

    try {
      const length = this.call(size.invoker, size.context, vectorPtr) >>> 0;
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        const handle = this.call(get.invoker, get.context, vectorPtr, i);
        out[i] = Number(this.takeEmval(handle)) & 0xff;
      }
      return out;
    } finally {
      this.call(vectorClass.destructor, vectorPtr);
    }
  }

  // ---- registrations, called from the wasm imports ----

  registerType(type: number, namePtr: number, reader?: NumberReader): void {
    this.typeNames.set(type, this.readCString(namePtr));
    if (reader) this.numberReaders.set(type, reader);
  }

  registerFunction(
    namePtr: number,
    argCount: number,
    argTypesPtr: number,
    invoker: number,
    fn: number,
  ): void {
    this.functions.set(this.readCString(namePtr), {
      argTypes: this.readTypeList(argTypesPtr, argCount),
      invoker,
      fn,
    });
  }

  registerClass(
    rawType: number,
    pointerType: number,
    constPointerType: number,
    namePtr: number,
    destructor: number,
  ): void {
    const name = this.readCString(namePtr);
    this.classes.set(rawType, { name, destructor });
    this.typeNames.set(rawType, name);
    this.classPointerTypes.set(pointerType, rawType);
    this.classPointerTypes.set(constPointerType, rawType);
  }

  registerMethod(
    rawClassType: number,
    namePtr: number,
    argCount: number,
    argTypesPtr: number,
    invoker: number,
    context: number,
  ): void {
    const key = methodKey(rawClassType, this.readCString(namePtr));
    this.methods.set(key, {
      argTypes: this.readTypeList(argTypesPtr, argCount),
      invoker,
      context,
    });
  }

  // ---- emval: how C++ hands a JS value back (vector.get returns one) ----

  emvalTakeValue(type: number, ptr: number): number {
    const reader = this.numberReaders.get(type);
    if (!reader) {
      throw new Error(`afp.wasm returned a value of unsupported type ${this.typeName(type)}`);
    }
    const handle = this.nextEmvalHandle++;
    this.emvalHandles.set(handle, { value: this.readNumber(ptr, reader), refs: 1 });
    return handle;
  }

  // C++ copies and destroys `val`s as it returns them, so count references
  emvalIncref(handle: number): void {
    const entry = this.emvalHandles.get(handle);
    if (entry) entry.refs++;
  }

  emvalDecref(handle: number): void {
    const entry = this.emvalHandles.get(handle);
    if (entry && --entry.refs === 0) this.emvalHandles.delete(handle);
  }

  // ---- memory helpers ----

  get memory(): WebAssembly.Memory {
    return this.exports.B;
  }

  malloc(size: number): number {
    return this.exports.E(size);
  }

  readCString(ptr: number, maxBytes = Infinity): string {
    const heap = new Uint8Array(this.memory.buffer);
    let end = ptr;
    while (heap[end] !== 0 && end - ptr < maxBytes) end++;
    return utf8.decode(heap.subarray(ptr, end));
  }

  private writeStdString(bytes: Uint8Array): number {
    // embind's std::string wire format: a 32-bit length, then the bytes
    const ptr = this.exports.E(4 + bytes.length + 1);
    if (ptr === 0) throw new Error("afp.wasm ran out of memory");
    new DataView(this.memory.buffer).setUint32(ptr, bytes.length, true);
    const heap = new Uint8Array(this.memory.buffer);
    heap.set(bytes, ptr + 4);
    heap[ptr + 4 + bytes.length] = 0;
    return ptr;
  }

  private readNumber(ptr: number, reader: NumberReader): number {
    const view = new DataView(this.memory.buffer);
    switch (`${reader.kind}${reader.size}`) {
      case "int1": return view.getInt8(ptr);
      case "uint1": return view.getUint8(ptr);
      case "int2": return view.getInt16(ptr, true);
      case "uint2": return view.getUint16(ptr, true);
      case "int4": return view.getInt32(ptr, true);
      case "uint4": return view.getUint32(ptr, true);
      case "float4": return view.getFloat32(ptr, true);
      case "float8": return view.getFloat64(ptr, true);
      default:
        throw new Error(`Unsupported ${reader.size}-byte ${reader.kind} from afp.wasm`);
    }
  }

  private readTypeList(ptr: number, count: number): number[] {
    const view = new DataView(this.memory.buffer);
    return Array.from({ length: count }, (_, i) => view.getUint32(ptr + i * 4, true));
  }

  private takeEmval(handle: number): unknown {
    if (handle < FIRST_EMVAL_HANDLE) return [undefined, null, true, false][handle - 1];
    const entry = this.emvalHandles.get(handle);
    if (!entry) throw new Error(`afp.wasm returned an unknown value handle ${handle}`);
    this.emvalDecref(handle);
    return entry.value;
  }

  private call(tableIndex: number, ...args: number[]): number {
    const fn = this.exports.D.get(tableIndex) as ((...a: number[]) => number) | null;
    if (!fn) throw new Error(`afp.wasm has no function at table index ${tableIndex}`);
    return fn(...args);
  }

  private method(classType: number, name: string): RegisteredMethod {
    return this.methods.get(methodKey(classType, name))!;
  }

  private typeName(type: number): string {
    const classType = this.classPointerTypes.get(type);
    if (classType !== undefined) return `${this.typeName(classType)}*`;
    return this.typeNames.get(type) ?? `#${type}`;
  }

  // Fail loudly if a different afp.wasm build is dropped in
  private assertExpectedBuild(): void {
    const fn = this.functions.get(FUNCTION_NAME);
    const vectorType = fn?.argTypes[0];
    const ok =
      fn !== undefined &&
      fn.argTypes.length === 2 &&
      this.classes.get(vectorType!)?.name === VECTOR_CLASS &&
      this.typeName(fn.argTypes[1]!) === STRING_TYPE &&
      this.methods.has(methodKey(vectorType!, "size")) &&
      this.methods.has(methodKey(vectorType!, "get"));
    if (!ok) {
      throw new Error(
        `afp.wasm does not export ${FUNCTION_NAME}(${STRING_TYPE}) -> ${VECTOR_CLASS} as expected`,
      );
    }
  }
}

function methodKey(classType: number, name: string): string {
  return `${classType}.${name}`;
}

// The module's 27 imports, keyed by their minified names. Each comment gives
// the Emscripten function it stands for.
function createImports(runtime: () => FingerprintRuntime) {
  const unsupported = (name: string) => () => {
    throw new Error(`afp.wasm called ${name}, which this loader does not provide`);
  };
  const noop = () => 0;

  return {
    // _embind_register_memory_view(type, kind, name)
    a: (type: number, _kind: number, name: number) => runtime().registerType(type, name),
    // _embind_register_integer(type, name, size, min, max)
    b: (type: number, name: number, size: number, min: number) =>
      runtime().registerType(type, name, {
        size: size as 1 | 2 | 4,
        kind: min < 0 ? "int" : "uint",
      }),
    // _embind_register_class_function(class, name, argCount, argTypes, sig, invoker, context, pureVirtual)
    c: (
      classType: number,
      name: number,
      argCount: number,
      argTypes: number,
      _signature: number,
      invoker: number,
      context: number,
    ) => runtime().registerMethod(classType, name, argCount, argTypes, invoker, context),
    // __assert_fail(condition, file, line, function)
    d: (condition: number, file: number, line: number) => {
      const rt = runtime();
      throw new Error(
        `afp.wasm assertion failed: ${rt.readCString(condition)} at ${rt.readCString(file)}:${line}`,
      );
    },
    // _embind_register_std_wstring(type, charSize, name)
    e: (type: number, _charSize: number, name: number) => runtime().registerType(type, name),
    // __cxa_throw
    f: () => {
      throw new Error("afp.wasm threw a C++ exception");
    },
    // __cxa_allocate_exception(size)
    g: (size: number) => runtime().malloc(size + 16) + 16,
    // abort
    h: () => {
      throw new Error("afp.wasm aborted");
    },
    // fd_write(fd, iov, iovcnt, pnum): accept and drop anything printed
    i: (_fd: number, iov: number, iovcnt: number, pnum: number) => {
      const view = new DataView(runtime().memory.buffer);
      let written = 0;
      for (let i = 0; i < iovcnt; i++) written += view.getUint32(iov + i * 8 + 4, true);
      view.setUint32(pnum, written, true);
      return 0;
    },
    // _embind_register_float(type, name, size)
    j: (type: number, name: number, size: number) =>
      runtime().registerType(type, name, { size: size as 4 | 8, kind: "float" }),
    // _embind_register_std_string(type, name)
    k: (type: number, name: number) => runtime().registerType(type, name),
    // _embind_register_function(name, argCount, argTypes, sig, invoker, fn)
    l: (
      name: number,
      argCount: number,
      argTypes: number,
      _signature: number,
      invoker: number,
      fn: number,
    ) => runtime().registerFunction(name, argCount, argTypes, invoker, fn),
    // _emval_decref(handle)
    m: (handle: number) => runtime().emvalDecref(handle),
    // _emval_incref(handle)
    n: (handle: number) => runtime().emvalIncref(handle),
    // _emval_take_value(type, ptr)
    o: (type: number, ptr: number) => runtime().emvalTakeValue(type, ptr),
    // _embind_register_bigint: never passed across the boundary
    p: noop,
    // setTempRet0
    q: noop,
    // emscripten_memcpy_big(dest, src, num)
    r: (dest: number, src: number, num: number) => {
      new Uint8Array(runtime().memory.buffer).copyWithin(dest, src, src + num);
    },
    // emscripten_resize_heap: the build has a fixed 16 MB heap
    s: () => {
      throw new Error("afp.wasm ran out of memory");
    },
    // strftime_l
    t: unsupported("strftime_l"),
    // environ_get / environ_sizes_get: no environment variables
    u: noop,
    v: noop,
    // _embind_register_class_constructor: never constructed from JS
    w: noop,
    // _embind_register_emval(type, name)
    x: (type: number, name: number) => runtime().registerType(type, name),
    // _embind_register_bool(type, name, size, true, false)
    y: (type: number, name: number) => runtime().registerType(type, name),
    // _embind_register_void(type, name)
    z: (type: number, name: number) => runtime().registerType(type, name),
    // _embind_register_class(type, ptrType, constPtrType, base, getActualTypeSig, getActualType,
    //   upcastSig, upcast, downcastSig, downcast, name, destructorSig, destructor)
    A: (
      type: number,
      pointerType: number,
      constPointerType: number,
      _base: number,
      _getActualTypeSig: number,
      _getActualType: number,
      _upcastSig: number,
      _upcast: number,
      _downcastSig: number,
      _downcast: number,
      name: number,
      _destructorSig: number,
      destructor: number,
    ) => runtime().registerClass(type, pointerType, constPointerType, name, destructor),
  };
}
