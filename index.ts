import * as fzstd from "./lib/fzstd.js";

class BinaryReader {
    private readonly view: DataView;
    private offset: number;

    constructor(data: Uint8Array) {
        this.view = new DataView(data.buffer);
        this.offset = data.byteOffset;
    }

    readU8() {
        const result = this.view.getUint8(this.offset);
        this.offset += 1;
        return result;
    }

    readU16() {
        const result = this.view.getUint16(this.offset, true)
        this.offset += 2;
        return result;
    }

    readU32() {
        const result = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return result;
    }

    readU64() {
        const result = this.view.getBigUint64(this.offset, true);
        this.offset += 8;
        return result;
    }

    readI8() {
        const result = this.view.getInt8(this.offset);
        this.offset += 1;
        return result;
    }

    readI16() {
        const result = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return result;
    }

    readI32() {
        const result = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return result;
    }

    readI64() {
        const result = this.view.getBigUint64(this.offset, true);
        this.offset += 8;
        return result;
    }

    readAsciiString(length: number) {
        let result = "";

        for (let i = 0; i < length; i++) {
            const charCode = this.readU8();
            result += String.fromCharCode(charCode);
        }

        return result;
    }

    readName(nameMap: readonly string[]) {
        const index = this.readI32();
        return 0 <= index && index < nameMap.length ? nameMap[index] : null;
    }

    getRemainingBytes() {
        return new Uint8Array(this.view.buffer, this.offset);
    }
}

/* -------- */

enum UsmapVersion {
    Initial,
    PackageVersioning,
    LongFName,
    LargeEnums,
    LatestPlusOne,
    Latest = LatestPlusOne - 1
}

enum UsmapCompressionMethod {
    None,
    Oodle,
    Brotli,
    Zstandard
}

/* -------- */

type Guid = [number, number, number, number];

type PackageFileVersion = {
    fileVersionUE4: number;
    fileVersionUE5: number;
}

type CustomVersion = {
    key: Guid;
    version: number;
}

type PackageVersioning = {
    packageVersion: PackageFileVersion;
    customVersions: CustomVersion[];
    netCL: number;
}

/* -------- */

enum PropertyTypeKind {
    ByteProperty,
    BoolProperty,
    IntProperty,
    FloatProperty,
    ObjectProperty,
    NameProperty,
    DelegateProperty,
    DoubleProperty,
    ArrayProperty,
    StructProperty,
    StrProperty,
    TextProperty,
    InterfaceProperty,
    MulticastDelegateProperty,
    WeakObjectProperty,
    LazyObjectProperty,
    AssetObjectProperty,
    SoftObjectProperty,
    UInt64Property,
    UInt32Property,
    UInt16Property,
    Int64Property,
    Int16Property,
    Int8Property,
    MapProperty,
    SetProperty,
    EnumProperty,
    FieldPathProperty,
    OptionalProperty,
    Utf8StrProperty,
    AnsiStrProperty
}

type Enum = {
    name: string;
    members: string[];
}

type AtomicPropertyType = string;

type EnumPropertyType = {
    type: string;
    enumName: string;
    innerType: PropertyType;
}

type StructPropertyType = {
    type: string;
    structType: string;
}

type SequencePropertyType = {
    type: string;
    innerType: PropertyType;
}

type MapPropertyType = {
    type: string;
    innerType: PropertyType;
    valueType: PropertyType;
}

type PropertyType =
    | AtomicPropertyType
    | EnumPropertyType
    | StructPropertyType
    | SequencePropertyType
    | MapPropertyType;

type PropertyInfo = {
    index: number;
    name: string;
    arraySize: number;
    type: PropertyType;
}

type Struct = {
    name: string;
    superType: string | null;
    propertyCount: number;
    properties: PropertyInfo[];
}

type Usmap = {
    packageVersioning: PackageVersioning | null;
    names: string[];
    enums: Enum[];
    structs: Struct[];
}

const MAGIC = 0x30C4;

/* -------- */

function readGuid(reader: BinaryReader): Guid {
    const a = reader.readU32();
    const b = reader.readU32();
    const c = reader.readU32();
    const d = reader.readU32();

    return [a, b, c, d];
}

function readCustomVersion(reader: BinaryReader): CustomVersion {
    const key = readGuid(reader);
    const version = reader.readI32();

    return {key, version};
}

function readPackageVersioning(reader: BinaryReader): PackageVersioning {
    const fileVersionUE4 = reader.readI32();
    const fileVersionUE5 = reader.readI32();
    const packageVersion = {fileVersionUE4, fileVersionUE5};

    const numCustomVersions = reader.readI32();
    const customVersions: CustomVersion[] = [];
    for (let i = 0; i < numCustomVersions; i++) {
        customVersions.push(readCustomVersion(reader));
    }

    const netCL = reader.readU32();

    return {packageVersion, customVersions, netCL};
}

/* -------- */

function readPropertyType(reader: BinaryReader, nameMap: readonly string[]): PropertyType {
    const kind = reader.readU8();
    const type = PropertyTypeKind[kind];

    switch (kind) {
        case PropertyTypeKind.EnumProperty: {
            const innerType = readPropertyType(reader, nameMap);
            const enumName = reader.readName(nameMap)!;
            return {type, enumName, innerType};
        }
        case PropertyTypeKind.StructProperty: {
            const structType = reader.readName(nameMap)!;
            return {type, structType};
        }
        case PropertyTypeKind.SetProperty:
        case PropertyTypeKind.ArrayProperty:
        case PropertyTypeKind.OptionalProperty: {
            const innerType = readPropertyType(reader, nameMap);
            return {type, innerType};
        }
        case PropertyTypeKind.MapProperty: {
            const innerType = readPropertyType(reader, nameMap);
            const valueType = readPropertyType(reader, nameMap);
            return {type, innerType, valueType};
        }
        default:
            return type;
    }
}

function readPropertyInfo(reader: BinaryReader, nameMap: readonly string[]): PropertyInfo {
    const index = reader.readU16();
    const arraySize = reader.readU8();
    const name = reader.readName(nameMap)!;
    const type = readPropertyType(reader, nameMap);

    return {index, name, arraySize, type};
}

function readStruct(reader: BinaryReader, nameMap: readonly string[]): Struct {
    const name = reader.readName(nameMap)!;
    const superType = reader.readName(nameMap);
    const propertyCount = reader.readU16();
    const serializablePropertyCount = reader.readU16();

    const properties: PropertyInfo[] = [];
    for (let i = 0; i < serializablePropertyCount; i++) {
        properties.push(readPropertyInfo(reader, nameMap));
    }

    return {name, superType, propertyCount, properties};
}

function parseUsmapBody(version: UsmapVersion, data: Uint8Array): Usmap {
    const reader = new BinaryReader(data);

    const numNames = reader.readU32();
    const nameMap: string[] = [];
    for (let i = 0; i < numNames; i++) {
        const nameLength = version >= UsmapVersion.LongFName ? reader.readU16() : reader.readU8();
        nameMap.push(reader.readAsciiString(nameLength));
    }

    const numEnums = reader.readU32();
    const enums = new Map<string, Enum>();
    for (let i = 0; i < numEnums; i++) {
        const enumName = reader.readName(nameMap)!;

        const numMembers = version >= UsmapVersion.LargeEnums ? reader.readU16() : reader.readU8();
        const members: string[] = [];
        for (let i = 0; i < numMembers; i++) {
            members.push(reader.readName(nameMap)!);
        }

        if (!enums.has(enumName)) {
            enums.set(enumName, {name: enumName, members});
        }
    }

    const numStructs = reader.readU32();
    const structs = new Map<string, Struct>();
    for (let i = 0; i < numStructs; i++) {
        const struct = readStruct(reader, nameMap);
        structs.set(struct.name, struct);
    }

    return {
        packageVersioning: null,
        names: nameMap,
        enums: [...enums.values()],
        structs: [...structs.values()]
    }
}

function parseUsmap(data: Uint8Array): Usmap {
    const reader = new BinaryReader(data);

    const magic = reader.readU16();
    if (magic !== MAGIC) {
        throw new Error("Usmap has invalid magic: " + magic);
    }

    const usmapVersion = reader.readU8();
    if (usmapVersion > UsmapVersion.Latest) {
        throw new Error("Usmap has invalid version: " + usmapVersion);
    }

    let hasVersioning = false;
    if (usmapVersion >= UsmapVersion.PackageVersioning) {
        const b = reader.readI32();
        hasVersioning = b === 1;
    }

    const packageVersioning = hasVersioning ? readPackageVersioning(reader) : null;

    const compressionMethod = reader.readU8();
    const sizeCompressed = reader.readU32();
    const sizeDecompressed = reader.readU32();

    const body = reader.getRemainingBytes();

    let uncompressed: Uint8Array;
    switch (compressionMethod) {
        case UsmapCompressionMethod.None:
            if (sizeCompressed !== sizeDecompressed) {
                throw new Error("No compression specified but sizeCompressed != sizeDecompressed");
            }
            uncompressed = body.slice();
            break;
        case UsmapCompressionMethod.Oodle:
            throw new Error("Usmap uses Oodle compression, which is unsupported");
        case UsmapCompressionMethod.Brotli:
            uncompressed = (window as any).brotli.decompress(body);
            break;
        case UsmapCompressionMethod.Zstandard:
            uncompressed = fzstd.decompress(body, null);
            break;
        default:
            throw new Error("Unsupported compression method: " + compressionMethod);
    }

    const result = parseUsmapBody(usmapVersion, uncompressed);
    result.packageVersioning = packageVersioning;
    return result;
}

export default parseUsmap;