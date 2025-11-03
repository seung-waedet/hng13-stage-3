import { RuntimeContext } from './@mastra-core-runtime-context.mjs';
import { M as MastraError } from './error.mjs';
import { WritableStream as WritableStream$1, TransformStream as TransformStream$1 } from 'stream/web';
import { i as isVercelTool, v as validateToolInput } from './tools.mjs';
import { I as InvalidArgumentError, J as JSONParseError, T as TypeValidationError, A as AISDKError, C as ConsoleLogger, L as LogLevel, M as MastraBase, R as RegisteredLogger } from './index2.mjs';
import { createHash } from 'crypto';
import { z } from './zod.mjs';
import { a as zodToJsonSchema$1 } from './zod-to-json.mjs';
import { s as safeParseAsync, t as toJSONSchema, u as union, i as string, j as _instanceof, k as custom, l as lazy, m as _null, n as number, o as boolean, r as record, p as array, q as object$1, v as literal, w as unknown, x as discriminatedUnion, dS as ZodOptional$1, dR as ZodObject$1, dO as ZodNull$1, dd as ZodArray$1, e9 as ZodUnion$1, Z as ZodString$1, b as ZodNumber$1, h as ZodDate$1, dp as ZodDefault$1, dM as ZodNever$1, e$ as strictObject, ea as ZodUnknown, y as looseObject } from './schemas.mjs';
import { Z as ZodFirstPartyTypeKind, h as literalType, f as nullType, b as arrayType, a as anyType, o as objectType, g as booleanType, u as unionType, n as numberType, s as stringType, e as enumType, av as neverType, al as intersectionType, X as ZodOptional, W as ZodObject, T as ZodNull, p as ZodArray, a7 as ZodUnion, a3 as ZodString, V as ZodNumber, x as ZodDate, y as ZodDefault, S as ZodNever } from './v3.mjs';

// src/tools/stream.ts
var ToolStream = class extends WritableStream$1 {
  originalStream;
  constructor({
    prefix,
    callId,
    name,
    runId
  }, originalStream) {
    super({
      async write(chunk) {
        const writer = originalStream?.getWriter();
        try {
          await writer?.write({
            type: `${prefix}-output`,
            runId,
            from: "USER",
            payload: {
              output: chunk,
              ...prefix === "workflow-step" ? {
                runId,
                stepName: name
              } : {
                [`${prefix}CallId`]: callId,
                [`${prefix}Name`]: name
              }
            }
          });
        } finally {
          writer?.releaseLock();
        }
      }
    });
    this.originalStream = originalStream;
  }
  async write(data) {
    const writer = this.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }
  async custom(data) {
    const writer = this.originalStream?.getWriter();
    try {
      await writer?.write(data);
    } finally {
      writer?.releaseLock();
    }
  }
};

const parseAnyOf = (schema, refs) => {
    return schema.anyOf.length
        ? schema.anyOf.length === 1
            ? parseSchema(schema.anyOf[0], {
                ...refs,
                path: [...refs.path, "anyOf", 0],
            })
            : `z.union([${schema.anyOf
                .map((schema, i) => parseSchema(schema, { ...refs, path: [...refs.path, "anyOf", i] }))
                .join(", ")}])`
        : `z.any()`;
};

const parseBoolean = (_schema) => {
    return "z.boolean()";
};

const parseDefault = (_schema) => {
    return "z.any()";
};

const parseMultipleType = (schema, refs) => {
    return `z.union([${schema.type
        .map((type) => parseSchema({ ...schema, type }, { ...refs, withoutDefaults: true }))
        .join(", ")}])`;
};

const parseNot = (schema, refs) => {
    return `z.any().refine((value) => !${parseSchema(schema.not, {
        ...refs,
        path: [...refs.path, "not"],
    })}.safeParse(value).success, "Invalid input: Should NOT be valid against schema")`;
};

const parseNull = (_schema) => {
    return "z.null()";
};

const half = (arr) => {
    return [arr.slice(0, arr.length / 2), arr.slice(arr.length / 2)];
};

const originalIndex = Symbol("Original index");
const ensureOriginalIndex = (arr) => {
    let newArr = [];
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (typeof item === "boolean") {
            newArr.push(item ? { [originalIndex]: i } : { [originalIndex]: i, not: {} });
        }
        else if (originalIndex in item) {
            return arr;
        }
        else {
            newArr.push({ ...item, [originalIndex]: i });
        }
    }
    return newArr;
};
function parseAllOf(schema, refs) {
    if (schema.allOf.length === 0) {
        return "z.never()";
    }
    else if (schema.allOf.length === 1) {
        const item = schema.allOf[0];
        return parseSchema(item, {
            ...refs,
            path: [...refs.path, "allOf", item[originalIndex]],
        });
    }
    else {
        const [left, right] = half(ensureOriginalIndex(schema.allOf));
        return `z.intersection(${parseAllOf({ allOf: left }, refs)}, ${parseAllOf({
            allOf: right,
        }, refs)})`;
    }
}

function withMessage(schema, key, get) {
    const value = schema[key];
    let r = "";
    if (value !== undefined) {
        const got = get({ value, json: JSON.stringify(value) });
        if (got) {
            const opener = got[0];
            const prefix = got.length === 3 ? got[1] : "";
            const closer = got.length === 3 ? got[2] : got[1];
            r += opener;
            if (schema.errorMessage?.[key] !== undefined) {
                r += prefix + JSON.stringify(schema.errorMessage[key]);
            }
            r += closer;
        }
    }
    return r;
}

const parseArray = (schema, refs) => {
    if (Array.isArray(schema.items)) {
        return `z.tuple([${schema.items.map((v, i) => parseSchema(v, { ...refs, path: [...refs.path, "items", i] }))}])`;
    }
    let r = !schema.items
        ? "z.array(z.any())"
        : `z.array(${parseSchema(schema.items, {
            ...refs,
            path: [...refs.path, "items"],
        })})`;
    r += withMessage(schema, "minItems", ({ json }) => [
        `.min(${json}`,
        ", ",
        ")",
    ]);
    r += withMessage(schema, "maxItems", ({ json }) => [
        `.max(${json}`,
        ", ",
        ")",
    ]);
    return r;
};

const parseConst = (schema) => {
    return `z.literal(${JSON.stringify(schema.const)})`;
};

const parseEnum = (schema) => {
    if (schema.enum.length === 0) {
        return "z.never()";
    }
    else if (schema.enum.length === 1) {
        // union does not work when there is only one element
        return `z.literal(${JSON.stringify(schema.enum[0])})`;
    }
    else if (schema.enum.every((x) => typeof x === "string")) {
        return `z.enum([${schema.enum.map((x) => JSON.stringify(x))}])`;
    }
    else {
        return `z.union([${schema.enum
            .map((x) => `z.literal(${JSON.stringify(x)})`)
            .join(", ")}])`;
    }
};

const parseIfThenElse = (schema, refs) => {
    const $if = parseSchema(schema.if, { ...refs, path: [...refs.path, "if"] });
    const $then = parseSchema(schema.then, {
        ...refs,
        path: [...refs.path, "then"],
    });
    const $else = parseSchema(schema.else, {
        ...refs,
        path: [...refs.path, "else"],
    });
    return `z.union([${$then}, ${$else}]).superRefine((value,ctx) => {
  const result = ${$if}.safeParse(value).success
    ? ${$then}.safeParse(value)
    : ${$else}.safeParse(value);
  if (!result.success) {
    result.error.errors.forEach((error) => ctx.addIssue(error))
  }
})`;
};

const parseNumber = (schema) => {
    let r = "z.number()";
    if (schema.type === "integer") {
        r += withMessage(schema, "type", () => [".int(", ")"]);
    }
    else {
        r += withMessage(schema, "format", ({ value }) => {
            if (value === "int64") {
                return [".int(", ")"];
            }
        });
    }
    r += withMessage(schema, "multipleOf", ({ value, json }) => {
        if (value === 1) {
            if (r.startsWith("z.number().int(")) {
                return;
            }
            return [".int(", ")"];
        }
        return [`.multipleOf(${json}`, ", ", ")"];
    });
    if (typeof schema.minimum === "number") {
        if (schema.exclusiveMinimum === true) {
            r += withMessage(schema, "minimum", ({ json }) => [
                `.gt(${json}`,
                ", ",
                ")",
            ]);
        }
        else {
            r += withMessage(schema, "minimum", ({ json }) => [
                `.gte(${json}`,
                ", ",
                ")",
            ]);
        }
    }
    else if (typeof schema.exclusiveMinimum === "number") {
        r += withMessage(schema, "exclusiveMinimum", ({ json }) => [
            `.gt(${json}`,
            ", ",
            ")",
        ]);
    }
    if (typeof schema.maximum === "number") {
        if (schema.exclusiveMaximum === true) {
            r += withMessage(schema, "maximum", ({ json }) => [
                `.lt(${json}`,
                ", ",
                ")",
            ]);
        }
        else {
            r += withMessage(schema, "maximum", ({ json }) => [
                `.lte(${json}`,
                ", ",
                ")",
            ]);
        }
    }
    else if (typeof schema.exclusiveMaximum === "number") {
        r += withMessage(schema, "exclusiveMaximum", ({ json }) => [
            `.lt(${json}`,
            ", ",
            ")",
        ]);
    }
    return r;
};

const parseOneOf = (schema, refs) => {
    return schema.oneOf.length
        ? schema.oneOf.length === 1
            ? parseSchema(schema.oneOf[0], {
                ...refs,
                path: [...refs.path, "oneOf", 0],
            })
            : `z.any().superRefine((x, ctx) => {
    const schemas = [${schema.oneOf
                .map((schema, i) => parseSchema(schema, {
                ...refs,
                path: [...refs.path, "oneOf", i],
            }))
                .join(", ")}];
    const errors = schemas.reduce<z.ZodError[]>(
      (errors, schema) =>
        ((result) =>
          result.error ? [...errors, result.error] : errors)(
          schema.safeParse(x),
        ),
      [],
    );
    if (schemas.length - errors.length !== 1) {
      ctx.addIssue({
        path: ctx.path,
        code: "invalid_union",
        unionErrors: errors,
        message: "Invalid input: Should pass single schema",
      });
    }
  })`
        : "z.any()";
};

const expandJsdocs = (jsdocs) => {
    const lines = jsdocs.split("\n");
    const result = lines.length === 1
        ? lines[0]
        : `\n${lines.map(x => `* ${x}`)
            .join("\n")}\n`;
    return `/**${result}*/\n`;
};
const addJsdocs = (schema, parsed) => {
    const description = schema.description;
    if (!description) {
        return parsed;
    }
    return `\n${expandJsdocs(description)}${parsed}`;
};

function parseObject(objectSchema, refs) {
    let properties = undefined;
    if (objectSchema.properties) {
        if (!Object.keys(objectSchema.properties).length) {
            properties = "z.object({})";
        }
        else {
            properties = "z.object({ ";
            properties += Object.keys(objectSchema.properties)
                .map((key) => {
                const propSchema = objectSchema.properties[key];
                let result = `${JSON.stringify(key)}: ${parseSchema(propSchema, {
                    ...refs,
                    path: [...refs.path, "properties", key],
                })}`;
                if (refs.withJsdocs && typeof propSchema === "object") {
                    result = addJsdocs(propSchema, result);
                }
                const hasDefault = typeof propSchema === "object" && propSchema.default !== undefined;
                const required = Array.isArray(objectSchema.required)
                    ? objectSchema.required.includes(key)
                    : typeof propSchema === "object" && propSchema.required === true;
                const optional = !hasDefault && !required;
                return optional ? `${result}.optional()` : result;
            })
                .join(", ");
            properties += " })";
        }
    }
    const additionalProperties = objectSchema.additionalProperties !== undefined
        ? parseSchema(objectSchema.additionalProperties, {
            ...refs,
            path: [...refs.path, "additionalProperties"],
        })
        : undefined;
    let patternProperties = undefined;
    if (objectSchema.patternProperties) {
        const parsedPatternProperties = Object.fromEntries(Object.entries(objectSchema.patternProperties).map(([key, value]) => {
            return [
                key,
                parseSchema(value, {
                    ...refs,
                    path: [...refs.path, "patternProperties", key],
                }),
            ];
        }, {}));
        patternProperties = "";
        if (properties) {
            if (additionalProperties) {
                patternProperties += `.catchall(z.union([${[
                    ...Object.values(parsedPatternProperties),
                    additionalProperties,
                ].join(", ")}]))`;
            }
            else if (Object.keys(parsedPatternProperties).length > 1) {
                patternProperties += `.catchall(z.union([${Object.values(parsedPatternProperties).join(", ")}]))`;
            }
            else {
                patternProperties += `.catchall(${Object.values(parsedPatternProperties)})`;
            }
        }
        else {
            if (additionalProperties) {
                patternProperties += `z.record(z.union([${[
                    ...Object.values(parsedPatternProperties),
                    additionalProperties,
                ].join(", ")}]))`;
            }
            else if (Object.keys(parsedPatternProperties).length > 1) {
                patternProperties += `z.record(z.union([${Object.values(parsedPatternProperties).join(", ")}]))`;
            }
            else {
                patternProperties += `z.record(${Object.values(parsedPatternProperties)})`;
            }
        }
        patternProperties += ".superRefine((value, ctx) => {\n";
        patternProperties += "for (const key in value) {\n";
        if (additionalProperties) {
            if (objectSchema.properties) {
                patternProperties += `let evaluated = [${Object.keys(objectSchema.properties)
                    .map((key) => JSON.stringify(key))
                    .join(", ")}].includes(key)\n`;
            }
            else {
                patternProperties += `let evaluated = false\n`;
            }
        }
        for (const key in objectSchema.patternProperties) {
            patternProperties +=
                "if (key.match(new RegExp(" + JSON.stringify(key) + "))) {\n";
            if (additionalProperties) {
                patternProperties += "evaluated = true\n";
            }
            patternProperties +=
                "const result = " +
                    parsedPatternProperties[key] +
                    ".safeParse(value[key])\n";
            patternProperties += "if (!result.success) {\n";
            patternProperties += `ctx.addIssue({
          path: [...ctx.path, key],
          code: 'custom',
          message: \`Invalid input: Key matching regex /\${key}/ must match schema\`,
          params: {
            issues: result.error.issues
          }
        })\n`;
            patternProperties += "}\n";
            patternProperties += "}\n";
        }
        if (additionalProperties) {
            patternProperties += "if (!evaluated) {\n";
            patternProperties +=
                "const result = " + additionalProperties + ".safeParse(value[key])\n";
            patternProperties += "if (!result.success) {\n";
            patternProperties += `ctx.addIssue({
          path: [...ctx.path, key],
          code: 'custom',
          message: \`Invalid input: must match catchall schema\`,
          params: {
            issues: result.error.issues
          }
        })\n`;
            patternProperties += "}\n";
            patternProperties += "}\n";
        }
        patternProperties += "}\n";
        patternProperties += "})";
    }
    let output = properties
        ? patternProperties
            ? properties + patternProperties
            : additionalProperties
                ? additionalProperties === "z.never()"
                    ? properties + ".strict()"
                    : properties + `.catchall(${additionalProperties})`
                : properties
        : patternProperties
            ? patternProperties
            : additionalProperties
                ? `z.record(${additionalProperties})`
                : "z.record(z.any())";
    if (its.an.anyOf(objectSchema)) {
        output += `.and(${parseAnyOf({
            anyOf: objectSchema.anyOf.map((x) => typeof x === "object" &&
                !x.type &&
                (x.properties || x.additionalProperties || x.patternProperties)
                ? { ...x, type: "object" }
                : x),
        }, refs)})`;
    }
    if (its.a.oneOf(objectSchema)) {
        output += `.and(${parseOneOf({
            oneOf: objectSchema.oneOf.map((x) => typeof x === "object" &&
                !x.type &&
                (x.properties || x.additionalProperties || x.patternProperties)
                ? { ...x, type: "object" }
                : x),
        }, refs)})`;
    }
    if (its.an.allOf(objectSchema)) {
        output += `.and(${parseAllOf({
            allOf: objectSchema.allOf.map((x) => typeof x === "object" &&
                !x.type &&
                (x.properties || x.additionalProperties || x.patternProperties)
                ? { ...x, type: "object" }
                : x),
        }, refs)})`;
    }
    return output;
}

const parseString = (schema) => {
    let r = "z.string()";
    r += withMessage(schema, "format", ({ value }) => {
        switch (value) {
            case "email":
                return [".email(", ")"];
            case "ip":
                return [".ip(", ")"];
            case "ipv4":
                return ['.ip({ version: "v4"', ", message: ", " })"];
            case "ipv6":
                return ['.ip({ version: "v6"', ", message: ", " })"];
            case "uri":
                return [".url(", ")"];
            case "uuid":
                return [".uuid(", ")"];
            case "date-time":
                return [".datetime({ offset: true", ", message: ", " })"];
            case "time":
                return [".time(", ")"];
            case "date":
                return [".date(", ")"];
            case "binary":
                return [".base64(", ")"];
            case "duration":
                return [".duration(", ")"];
        }
    });
    r += withMessage(schema, "pattern", ({ json }) => [
        `.regex(new RegExp(${json})`,
        ", ",
        ")",
    ]);
    r += withMessage(schema, "minLength", ({ json }) => [
        `.min(${json}`,
        ", ",
        ")",
    ]);
    r += withMessage(schema, "maxLength", ({ json }) => [
        `.max(${json}`,
        ", ",
        ")",
    ]);
    r += withMessage(schema, "contentEncoding", ({ value }) => {
        if (value === "base64") {
            return [".base64(", ")"];
        }
    });
    const contentMediaType = withMessage(schema, "contentMediaType", ({ value }) => {
        if (value === "application/json") {
            return [
                ".transform((str, ctx) => { try { return JSON.parse(str); } catch (err) { ctx.addIssue({ code: \"custom\", message: \"Invalid JSON\" }); }}",
                ", ",
                ")"
            ];
        }
    });
    if (contentMediaType != "") {
        r += contentMediaType;
        r += withMessage(schema, "contentSchema", ({ value }) => {
            if (value && value instanceof Object) {
                return [
                    `.pipe(${parseSchema(value)}`,
                    ", ",
                    ")"
                ];
            }
        });
    }
    return r;
};

const omit = (obj, ...keys) => Object.keys(obj).reduce((acc, key) => {
    if (!keys.includes(key)) {
        acc[key] = obj[key];
    }
    return acc;
}, {});

/**
 * For compatibility with open api 3.0 nullable
 */
const parseNullable = (schema, refs) => {
    return `${parseSchema(omit(schema, "nullable"), refs, true)}.nullable()`;
};

const parseSchema = (schema, refs = { seen: new Map(), path: [] }, blockMeta) => {
    if (typeof schema !== "object")
        return schema ? "z.any()" : "z.never()";
    if (refs.parserOverride) {
        const custom = refs.parserOverride(schema, refs);
        if (typeof custom === "string") {
            return custom;
        }
    }
    let seen = refs.seen.get(schema);
    if (seen) {
        if (seen.r !== undefined) {
            return seen.r;
        }
        if (refs.depth === undefined || seen.n >= refs.depth) {
            return "z.any()";
        }
        seen.n += 1;
    }
    else {
        seen = { r: undefined, n: 0 };
        refs.seen.set(schema, seen);
    }
    let parsed = selectParser$1(schema, refs);
    if (!blockMeta) {
        if (!refs.withoutDescribes) {
            parsed = addDescribes(schema, parsed);
        }
        if (!refs.withoutDefaults) {
            parsed = addDefaults(schema, parsed);
        }
        parsed = addAnnotations(schema, parsed);
    }
    seen.r = parsed;
    return parsed;
};
const addDescribes = (schema, parsed) => {
    if (schema.description) {
        parsed += `.describe(${JSON.stringify(schema.description)})`;
    }
    return parsed;
};
const addDefaults = (schema, parsed) => {
    if (schema.default !== undefined) {
        parsed += `.default(${JSON.stringify(schema.default)})`;
    }
    return parsed;
};
const addAnnotations = (schema, parsed) => {
    if (schema.readOnly) {
        parsed += ".readonly()";
    }
    return parsed;
};
const selectParser$1 = (schema, refs) => {
    if (its.a.nullable(schema)) {
        return parseNullable(schema, refs);
    }
    else if (its.an.object(schema)) {
        return parseObject(schema, refs);
    }
    else if (its.an.array(schema)) {
        return parseArray(schema, refs);
    }
    else if (its.an.anyOf(schema)) {
        return parseAnyOf(schema, refs);
    }
    else if (its.an.allOf(schema)) {
        return parseAllOf(schema, refs);
    }
    else if (its.a.oneOf(schema)) {
        return parseOneOf(schema, refs);
    }
    else if (its.a.not(schema)) {
        return parseNot(schema, refs);
    }
    else if (its.an.enum(schema)) {
        return parseEnum(schema); //<-- needs to come before primitives
    }
    else if (its.a.const(schema)) {
        return parseConst(schema);
    }
    else if (its.a.multipleType(schema)) {
        return parseMultipleType(schema, refs);
    }
    else if (its.a.primitive(schema, "string")) {
        return parseString(schema);
    }
    else if (its.a.primitive(schema, "number") ||
        its.a.primitive(schema, "integer")) {
        return parseNumber(schema);
    }
    else if (its.a.primitive(schema, "boolean")) {
        return parseBoolean();
    }
    else if (its.a.primitive(schema, "null")) {
        return parseNull();
    }
    else if (its.a.conditional(schema)) {
        return parseIfThenElse(schema, refs);
    }
    else {
        return parseDefault();
    }
};
const its = {
    an: {
        object: (x) => x.type === "object",
        array: (x) => x.type === "array",
        anyOf: (x) => x.anyOf !== undefined,
        allOf: (x) => x.allOf !== undefined,
        enum: (x) => x.enum !== undefined,
    },
    a: {
        nullable: (x) => x.nullable === true,
        multipleType: (x) => Array.isArray(x.type),
        not: (x) => x.not !== undefined,
        const: (x) => x.const !== undefined,
        primitive: (x, p) => x.type === p,
        conditional: (x) => Boolean("if" in x && x.if && "then" in x && "else" in x && x.then && x.else),
        oneOf: (x) => x.oneOf !== undefined,
    },
};

const jsonSchemaToZod = (schema, { module, name, type, noImport, ...rest } = {}) => {
    if (type && (!name || module !== "esm")) {
        throw new Error("Option `type` requires `name` to be set and `module` to be `esm`");
    }
    let result = parseSchema(schema, {
        module,
        name,
        path: [],
        seen: new Map(),
        ...rest,
    });
    const jsdocs = rest.withJsdocs && typeof schema !== "boolean" && schema.description
        ? expandJsdocs(schema.description)
        : "";
    if (module === "cjs") {
        result = `${jsdocs}module.exports = ${name ? `{ ${JSON.stringify(name)}: ${result} }` : result}
`;
        if (!noImport) {
            result = `${jsdocs}const { z } = require("zod")

${result}`;
        }
    }
    else if (module === "esm") {
        result = `${jsdocs}export ${name ? `const ${name} =` : `default`} ${result}
`;
        if (!noImport) {
            result = `import { z } from "zod"

${result}`;
        }
    }
    else if (name) {
        result = `${jsdocs}const ${name} = ${result}`;
    }
    if (type && name) {
        let typeName = typeof type === "string"
            ? type
            : `${name[0].toUpperCase()}${name.substring(1)}`;
        result += `export type ${typeName} = z.infer<typeof ${name}>
`;
    }
    return result;
};

// src/combine-headers.ts
var createIdGenerator = ({
  prefix,
  size = 16,
  alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  separator = "-"
} = {}) => {
  const generator = () => {
    const alphabetLength = alphabet.length;
    const chars = new Array(size);
    for (let i = 0; i < size; i++) {
      chars[i] = alphabet[Math.random() * alphabetLength | 0];
    }
    return chars.join("");
  };
  if (prefix == null) {
    return generator;
  }
  if (alphabet.includes(separator)) {
    throw new InvalidArgumentError({
      argument: "separator",
      message: `The separator "${separator}" must not be part of the alphabet "${alphabet}".`
    });
  }
  return () => `${prefix}${separator}${generator()}`;
};
createIdGenerator();

// src/secure-json-parse.ts
var suspectProtoRx = /"__proto__"\s*:/;
var suspectConstructorRx = /"constructor"\s*:/;
function _parse(text) {
  const obj = JSON.parse(text);
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (suspectProtoRx.test(text) === false && suspectConstructorRx.test(text) === false) {
    return obj;
  }
  return filter(obj);
}
function filter(obj) {
  let next = [obj];
  while (next.length) {
    const nodes = next;
    next = [];
    for (const node of nodes) {
      if (Object.prototype.hasOwnProperty.call(node, "__proto__")) {
        throw new SyntaxError("Object contains forbidden prototype property");
      }
      if (Object.prototype.hasOwnProperty.call(node, "constructor") && Object.prototype.hasOwnProperty.call(node.constructor, "prototype")) {
        throw new SyntaxError("Object contains forbidden prototype property");
      }
      for (const key in node) {
        const value = node[key];
        if (value && typeof value === "object") {
          next.push(value);
        }
      }
    }
  }
  return obj;
}
function secureJsonParse(text) {
  const { stackTraceLimit } = Error;
  Error.stackTraceLimit = 0;
  try {
    return _parse(text);
  } finally {
    Error.stackTraceLimit = stackTraceLimit;
  }
}
var validatorSymbol = Symbol.for("vercel.ai.validator");
function validator(validate) {
  return { [validatorSymbol]: true, validate };
}
function isValidator(value) {
  return typeof value === "object" && value !== null && validatorSymbol in value && value[validatorSymbol] === true && "validate" in value;
}
function asValidator(value) {
  return isValidator(value) ? value : typeof value === "function" ? value() : standardSchemaValidator(value);
}
function standardSchemaValidator(standardSchema) {
  return validator(async (value) => {
    const result = await standardSchema["~standard"].validate(value);
    return result.issues == null ? { success: true, value: result.value } : {
      success: false,
      error: new TypeValidationError({
        value,
        cause: result.issues
      })
    };
  });
}
async function safeValidateTypes({
  value,
  schema
}) {
  const validator2 = asValidator(schema);
  try {
    if (validator2.validate == null) {
      return { success: true, value, rawValue: value };
    }
    const result = await validator2.validate(value);
    if (result.success) {
      return { success: true, value: result.value, rawValue: value };
    }
    return {
      success: false,
      error: TypeValidationError.wrap({ value, cause: result.error }),
      rawValue: value
    };
  } catch (error) {
    return {
      success: false,
      error: TypeValidationError.wrap({ value, cause: error }),
      rawValue: value
    };
  }
}
async function safeParseJSON({
  text,
  schema
}) {
  try {
    const value = secureJsonParse(text);
    if (schema == null) {
      return { success: true, value, rawValue: value };
    }
    return await safeValidateTypes({ value, schema });
  } catch (error) {
    return {
      success: false,
      error: JSONParseError.isInstance(error) ? error : new JSONParseError({ text, cause: error }),
      rawValue: void 0
    };
  }
}

// src/zod-to-json-schema/get-relative-path.ts
var getRelativePath = (pathA, pathB) => {
  let i = 0;
  for (; i < pathA.length && i < pathB.length; i++) {
    if (pathA[i] !== pathB[i]) break;
  }
  return [(pathA.length - i).toString(), ...pathB.slice(i)].join("/");
};

// src/zod-to-json-schema/options.ts
var ignoreOverride = Symbol(
  "Let zodToJsonSchema decide on which parser to use"
);
var defaultOptions = {
  name: void 0,
  $refStrategy: "root",
  basePath: ["#"],
  effectStrategy: "input",
  pipeStrategy: "all",
  dateStrategy: "format:date-time",
  mapStrategy: "entries",
  removeAdditionalStrategy: "passthrough",
  allowedAdditionalProperties: true,
  rejectedAdditionalProperties: false,
  definitionPath: "definitions",
  strictUnions: false,
  definitions: {},
  errorMessages: false,
  patternStrategy: "escape",
  applyRegexFlags: false,
  emailStrategy: "format:email",
  base64Strategy: "contentEncoding:base64",
  nameStrategy: "ref"
};
var getDefaultOptions = (options) => typeof options === "string" ? {
  ...defaultOptions,
  name: options
} : {
  ...defaultOptions,
  ...options
};

// src/zod-to-json-schema/parsers/any.ts
function parseAnyDef() {
  return {};
}
function parseArrayDef(def, refs) {
  var _a, _b, _c;
  const res = {
    type: "array"
  };
  if (((_a = def.type) == null ? void 0 : _a._def) && ((_c = (_b = def.type) == null ? void 0 : _b._def) == null ? void 0 : _c.typeName) !== ZodFirstPartyTypeKind.ZodAny) {
    res.items = parseDef(def.type._def, {
      ...refs,
      currentPath: [...refs.currentPath, "items"]
    });
  }
  if (def.minLength) {
    res.minItems = def.minLength.value;
  }
  if (def.maxLength) {
    res.maxItems = def.maxLength.value;
  }
  if (def.exactLength) {
    res.minItems = def.exactLength.value;
    res.maxItems = def.exactLength.value;
  }
  return res;
}

// src/zod-to-json-schema/parsers/bigint.ts
function parseBigintDef(def) {
  const res = {
    type: "integer",
    format: "int64"
  };
  if (!def.checks) return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "min":
        if (check.inclusive) {
          res.minimum = check.value;
        } else {
          res.exclusiveMinimum = check.value;
        }
        break;
      case "max":
        if (check.inclusive) {
          res.maximum = check.value;
        } else {
          res.exclusiveMaximum = check.value;
        }
        break;
      case "multipleOf":
        res.multipleOf = check.value;
        break;
    }
  }
  return res;
}

// src/zod-to-json-schema/parsers/boolean.ts
function parseBooleanDef() {
  return { type: "boolean" };
}

// src/zod-to-json-schema/parsers/branded.ts
function parseBrandedDef(_def, refs) {
  return parseDef(_def.type._def, refs);
}

// src/zod-to-json-schema/parsers/catch.ts
var parseCatchDef = (def, refs) => {
  return parseDef(def.innerType._def, refs);
};

// src/zod-to-json-schema/parsers/date.ts
function parseDateDef(def, refs, overrideDateStrategy) {
  const strategy = overrideDateStrategy != null ? overrideDateStrategy : refs.dateStrategy;
  if (Array.isArray(strategy)) {
    return {
      anyOf: strategy.map((item, i) => parseDateDef(def, refs, item))
    };
  }
  switch (strategy) {
    case "string":
    case "format:date-time":
      return {
        type: "string",
        format: "date-time"
      };
    case "format:date":
      return {
        type: "string",
        format: "date"
      };
    case "integer":
      return integerDateParser(def);
  }
}
var integerDateParser = (def) => {
  const res = {
    type: "integer",
    format: "unix-time"
  };
  for (const check of def.checks) {
    switch (check.kind) {
      case "min":
        res.minimum = check.value;
        break;
      case "max":
        res.maximum = check.value;
        break;
    }
  }
  return res;
};

// src/zod-to-json-schema/parsers/default.ts
function parseDefaultDef(_def, refs) {
  return {
    ...parseDef(_def.innerType._def, refs),
    default: _def.defaultValue()
  };
}

// src/zod-to-json-schema/parsers/effects.ts
function parseEffectsDef(_def, refs) {
  return refs.effectStrategy === "input" ? parseDef(_def.schema._def, refs) : parseAnyDef();
}

// src/zod-to-json-schema/parsers/enum.ts
function parseEnumDef(def) {
  return {
    type: "string",
    enum: Array.from(def.values)
  };
}

// src/zod-to-json-schema/parsers/intersection.ts
var isJsonSchema7AllOfType = (type) => {
  if ("type" in type && type.type === "string") return false;
  return "allOf" in type;
};
function parseIntersectionDef(def, refs) {
  const allOf = [
    parseDef(def.left._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "0"]
    }),
    parseDef(def.right._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "1"]
    })
  ].filter((x) => !!x);
  const mergedAllOf = [];
  allOf.forEach((schema) => {
    if (isJsonSchema7AllOfType(schema)) {
      mergedAllOf.push(...schema.allOf);
    } else {
      let nestedSchema = schema;
      if ("additionalProperties" in schema && schema.additionalProperties === false) {
        const { additionalProperties, ...rest } = schema;
        nestedSchema = rest;
      }
      mergedAllOf.push(nestedSchema);
    }
  });
  return mergedAllOf.length ? { allOf: mergedAllOf } : void 0;
}

// src/zod-to-json-schema/parsers/literal.ts
function parseLiteralDef(def) {
  const parsedType = typeof def.value;
  if (parsedType !== "bigint" && parsedType !== "number" && parsedType !== "boolean" && parsedType !== "string") {
    return {
      type: Array.isArray(def.value) ? "array" : "object"
    };
  }
  return {
    type: parsedType === "bigint" ? "integer" : parsedType,
    const: def.value
  };
}

// src/zod-to-json-schema/parsers/string.ts
var emojiRegex = void 0;
var zodPatterns = {
  /**
   * `c` was changed to `[cC]` to replicate /i flag
   */
  cuid: /^[cC][^\s-]{8,}$/,
  cuid2: /^[0-9a-z]+$/,
  ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
  /**
   * `a-z` was added to replicate /i flag
   */
  email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/,
  /**
   * Constructed a valid Unicode RegExp
   *
   * Lazily instantiate since this type of regex isn't supported
   * in all envs (e.g. React Native).
   *
   * See:
   * https://github.com/colinhacks/zod/issues/2433
   * Fix in Zod:
   * https://github.com/colinhacks/zod/commit/9340fd51e48576a75adc919bff65dbc4a5d4c99b
   */
  emoji: () => {
    if (emojiRegex === void 0) {
      emojiRegex = RegExp(
        "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$",
        "u"
      );
    }
    return emojiRegex;
  },
  /**
   * Unused
   */
  uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
  /**
   * Unused
   */
  ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/,
  /**
   * Unused
   */
  ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,
  ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,
  base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/,
  nanoid: /^[a-zA-Z0-9_-]{21}$/,
  jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
};
function parseStringDef(def, refs) {
  const res = {
    type: "string"
  };
  if (def.checks) {
    for (const check of def.checks) {
      switch (check.kind) {
        case "min":
          res.minLength = typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value;
          break;
        case "max":
          res.maxLength = typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value;
          break;
        case "email":
          switch (refs.emailStrategy) {
            case "format:email":
              addFormat(res, "email", check.message, refs);
              break;
            case "format:idn-email":
              addFormat(res, "idn-email", check.message, refs);
              break;
            case "pattern:zod":
              addPattern(res, zodPatterns.email, check.message, refs);
              break;
          }
          break;
        case "url":
          addFormat(res, "uri", check.message, refs);
          break;
        case "uuid":
          addFormat(res, "uuid", check.message, refs);
          break;
        case "regex":
          addPattern(res, check.regex, check.message, refs);
          break;
        case "cuid":
          addPattern(res, zodPatterns.cuid, check.message, refs);
          break;
        case "cuid2":
          addPattern(res, zodPatterns.cuid2, check.message, refs);
          break;
        case "startsWith":
          addPattern(
            res,
            RegExp(`^${escapeLiteralCheckValue(check.value, refs)}`),
            check.message,
            refs
          );
          break;
        case "endsWith":
          addPattern(
            res,
            RegExp(`${escapeLiteralCheckValue(check.value, refs)}$`),
            check.message,
            refs
          );
          break;
        case "datetime":
          addFormat(res, "date-time", check.message, refs);
          break;
        case "date":
          addFormat(res, "date", check.message, refs);
          break;
        case "time":
          addFormat(res, "time", check.message, refs);
          break;
        case "duration":
          addFormat(res, "duration", check.message, refs);
          break;
        case "length":
          res.minLength = typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value;
          res.maxLength = typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value;
          break;
        case "includes": {
          addPattern(
            res,
            RegExp(escapeLiteralCheckValue(check.value, refs)),
            check.message,
            refs
          );
          break;
        }
        case "ip": {
          if (check.version !== "v6") {
            addFormat(res, "ipv4", check.message, refs);
          }
          if (check.version !== "v4") {
            addFormat(res, "ipv6", check.message, refs);
          }
          break;
        }
        case "base64url":
          addPattern(res, zodPatterns.base64url, check.message, refs);
          break;
        case "jwt":
          addPattern(res, zodPatterns.jwt, check.message, refs);
          break;
        case "cidr": {
          if (check.version !== "v6") {
            addPattern(res, zodPatterns.ipv4Cidr, check.message, refs);
          }
          if (check.version !== "v4") {
            addPattern(res, zodPatterns.ipv6Cidr, check.message, refs);
          }
          break;
        }
        case "emoji":
          addPattern(res, zodPatterns.emoji(), check.message, refs);
          break;
        case "ulid": {
          addPattern(res, zodPatterns.ulid, check.message, refs);
          break;
        }
        case "base64": {
          switch (refs.base64Strategy) {
            case "format:binary": {
              addFormat(res, "binary", check.message, refs);
              break;
            }
            case "contentEncoding:base64": {
              res.contentEncoding = "base64";
              break;
            }
            case "pattern:zod": {
              addPattern(res, zodPatterns.base64, check.message, refs);
              break;
            }
          }
          break;
        }
        case "nanoid": {
          addPattern(res, zodPatterns.nanoid, check.message, refs);
        }
      }
    }
  }
  return res;
}
function escapeLiteralCheckValue(literal, refs) {
  return refs.patternStrategy === "escape" ? escapeNonAlphaNumeric(literal) : literal;
}
var ALPHA_NUMERIC = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789"
);
function escapeNonAlphaNumeric(source) {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (!ALPHA_NUMERIC.has(source[i])) {
      result += "\\";
    }
    result += source[i];
  }
  return result;
}
function addFormat(schema, value, message, refs) {
  var _a;
  if (schema.format || ((_a = schema.anyOf) == null ? void 0 : _a.some((x) => x.format))) {
    if (!schema.anyOf) {
      schema.anyOf = [];
    }
    if (schema.format) {
      schema.anyOf.push({
        format: schema.format
      });
      delete schema.format;
    }
    schema.anyOf.push({
      format: value,
      ...message && refs.errorMessages && { errorMessage: { format: message } }
    });
  } else {
    schema.format = value;
  }
}
function addPattern(schema, regex, message, refs) {
  var _a;
  if (schema.pattern || ((_a = schema.allOf) == null ? void 0 : _a.some((x) => x.pattern))) {
    if (!schema.allOf) {
      schema.allOf = [];
    }
    if (schema.pattern) {
      schema.allOf.push({
        pattern: schema.pattern
      });
      delete schema.pattern;
    }
    schema.allOf.push({
      pattern: stringifyRegExpWithFlags(regex, refs),
      ...message && refs.errorMessages && { errorMessage: { pattern: message } }
    });
  } else {
    schema.pattern = stringifyRegExpWithFlags(regex, refs);
  }
}
function stringifyRegExpWithFlags(regex, refs) {
  var _a;
  if (!refs.applyRegexFlags || !regex.flags) {
    return regex.source;
  }
  const flags = {
    i: regex.flags.includes("i"),
    // Case-insensitive
    m: regex.flags.includes("m"),
    // `^` and `$` matches adjacent to newline characters
    s: regex.flags.includes("s")
    // `.` matches newlines
  };
  const source = flags.i ? regex.source.toLowerCase() : regex.source;
  let pattern = "";
  let isEscaped = false;
  let inCharGroup = false;
  let inCharRange = false;
  for (let i = 0; i < source.length; i++) {
    if (isEscaped) {
      pattern += source[i];
      isEscaped = false;
      continue;
    }
    if (flags.i) {
      if (inCharGroup) {
        if (source[i].match(/[a-z]/)) {
          if (inCharRange) {
            pattern += source[i];
            pattern += `${source[i - 2]}-${source[i]}`.toUpperCase();
            inCharRange = false;
          } else if (source[i + 1] === "-" && ((_a = source[i + 2]) == null ? void 0 : _a.match(/[a-z]/))) {
            pattern += source[i];
            inCharRange = true;
          } else {
            pattern += `${source[i]}${source[i].toUpperCase()}`;
          }
          continue;
        }
      } else if (source[i].match(/[a-z]/)) {
        pattern += `[${source[i]}${source[i].toUpperCase()}]`;
        continue;
      }
    }
    if (flags.m) {
      if (source[i] === "^") {
        pattern += `(^|(?<=[\r
]))`;
        continue;
      } else if (source[i] === "$") {
        pattern += `($|(?=[\r
]))`;
        continue;
      }
    }
    if (flags.s && source[i] === ".") {
      pattern += inCharGroup ? `${source[i]}\r
` : `[${source[i]}\r
]`;
      continue;
    }
    pattern += source[i];
    if (source[i] === "\\") {
      isEscaped = true;
    } else if (inCharGroup && source[i] === "]") {
      inCharGroup = false;
    } else if (!inCharGroup && source[i] === "[") {
      inCharGroup = true;
    }
  }
  return pattern;
}

// src/zod-to-json-schema/parsers/record.ts
function parseRecordDef(def, refs) {
  var _a, _b, _c, _d, _e, _f;
  const schema = {
    type: "object",
    additionalProperties: (_a = parseDef(def.valueType._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    })) != null ? _a : refs.allowedAdditionalProperties
  };
  if (((_b = def.keyType) == null ? void 0 : _b._def.typeName) === ZodFirstPartyTypeKind.ZodString && ((_c = def.keyType._def.checks) == null ? void 0 : _c.length)) {
    const { type, ...keyType } = parseStringDef(def.keyType._def, refs);
    return {
      ...schema,
      propertyNames: keyType
    };
  } else if (((_d = def.keyType) == null ? void 0 : _d._def.typeName) === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      ...schema,
      propertyNames: {
        enum: def.keyType._def.values
      }
    };
  } else if (((_e = def.keyType) == null ? void 0 : _e._def.typeName) === ZodFirstPartyTypeKind.ZodBranded && def.keyType._def.type._def.typeName === ZodFirstPartyTypeKind.ZodString && ((_f = def.keyType._def.type._def.checks) == null ? void 0 : _f.length)) {
    const { type, ...keyType } = parseBrandedDef(
      def.keyType._def,
      refs
    );
    return {
      ...schema,
      propertyNames: keyType
    };
  }
  return schema;
}

// src/zod-to-json-schema/parsers/map.ts
function parseMapDef(def, refs) {
  if (refs.mapStrategy === "record") {
    return parseRecordDef(def, refs);
  }
  const keys = parseDef(def.keyType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "0"]
  }) || parseAnyDef();
  const values = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "1"]
  }) || parseAnyDef();
  return {
    type: "array",
    maxItems: 125,
    items: {
      type: "array",
      items: [keys, values],
      minItems: 2,
      maxItems: 2
    }
  };
}

// src/zod-to-json-schema/parsers/native-enum.ts
function parseNativeEnumDef(def) {
  const object = def.values;
  const actualKeys = Object.keys(def.values).filter((key) => {
    return typeof object[object[key]] !== "number";
  });
  const actualValues = actualKeys.map((key) => object[key]);
  const parsedTypes = Array.from(
    new Set(actualValues.map((values) => typeof values))
  );
  return {
    type: parsedTypes.length === 1 ? parsedTypes[0] === "string" ? "string" : "number" : ["string", "number"],
    enum: actualValues
  };
}

// src/zod-to-json-schema/parsers/never.ts
function parseNeverDef() {
  return { not: parseAnyDef() };
}

// src/zod-to-json-schema/parsers/null.ts
function parseNullDef() {
  return {
    type: "null"
  };
}

// src/zod-to-json-schema/parsers/union.ts
var primitiveMappings = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBigInt: "integer",
  ZodBoolean: "boolean",
  ZodNull: "null"
};
function parseUnionDef(def, refs) {
  const options = def.options instanceof Map ? Array.from(def.options.values()) : def.options;
  if (options.every(
    (x) => x._def.typeName in primitiveMappings && (!x._def.checks || !x._def.checks.length)
  )) {
    const types = options.reduce((types2, x) => {
      const type = primitiveMappings[x._def.typeName];
      return type && !types2.includes(type) ? [...types2, type] : types2;
    }, []);
    return {
      type: types.length > 1 ? types : types[0]
    };
  } else if (options.every((x) => x._def.typeName === "ZodLiteral" && !x.description)) {
    const types = options.reduce(
      (acc, x) => {
        const type = typeof x._def.value;
        switch (type) {
          case "string":
          case "number":
          case "boolean":
            return [...acc, type];
          case "bigint":
            return [...acc, "integer"];
          case "object":
            if (x._def.value === null) return [...acc, "null"];
          case "symbol":
          case "undefined":
          case "function":
          default:
            return acc;
        }
      },
      []
    );
    if (types.length === options.length) {
      const uniqueTypes = types.filter((x, i, a) => a.indexOf(x) === i);
      return {
        type: uniqueTypes.length > 1 ? uniqueTypes : uniqueTypes[0],
        enum: options.reduce(
          (acc, x) => {
            return acc.includes(x._def.value) ? acc : [...acc, x._def.value];
          },
          []
        )
      };
    }
  } else if (options.every((x) => x._def.typeName === "ZodEnum")) {
    return {
      type: "string",
      enum: options.reduce(
        (acc, x) => [
          ...acc,
          ...x._def.values.filter((x2) => !acc.includes(x2))
        ],
        []
      )
    };
  }
  return asAnyOf(def, refs);
}
var asAnyOf = (def, refs) => {
  const anyOf = (def.options instanceof Map ? Array.from(def.options.values()) : def.options).map(
    (x, i) => parseDef(x._def, {
      ...refs,
      currentPath: [...refs.currentPath, "anyOf", `${i}`]
    })
  ).filter(
    (x) => !!x && (!refs.strictUnions || typeof x === "object" && Object.keys(x).length > 0)
  );
  return anyOf.length ? { anyOf } : void 0;
};

// src/zod-to-json-schema/parsers/nullable.ts
function parseNullableDef(def, refs) {
  if (["ZodString", "ZodNumber", "ZodBigInt", "ZodBoolean", "ZodNull"].includes(
    def.innerType._def.typeName
  ) && (!def.innerType._def.checks || !def.innerType._def.checks.length)) {
    return {
      type: [
        primitiveMappings[def.innerType._def.typeName],
        "null"
      ]
    };
  }
  const base = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", "0"]
  });
  return base && { anyOf: [base, { type: "null" }] };
}

// src/zod-to-json-schema/parsers/number.ts
function parseNumberDef(def) {
  const res = {
    type: "number"
  };
  if (!def.checks) return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "int":
        res.type = "integer";
        break;
      case "min":
        if (check.inclusive) {
          res.minimum = check.value;
        } else {
          res.exclusiveMinimum = check.value;
        }
        break;
      case "max":
        if (check.inclusive) {
          res.maximum = check.value;
        } else {
          res.exclusiveMaximum = check.value;
        }
        break;
      case "multipleOf":
        res.multipleOf = check.value;
        break;
    }
  }
  return res;
}

// src/zod-to-json-schema/parsers/object.ts
function parseObjectDef(def, refs) {
  const result = {
    type: "object",
    properties: {}
  };
  const required = [];
  const shape = def.shape();
  for (const propName in shape) {
    let propDef = shape[propName];
    if (propDef === void 0 || propDef._def === void 0) {
      continue;
    }
    const propOptional = safeIsOptional(propDef);
    const parsedDef = parseDef(propDef._def, {
      ...refs,
      currentPath: [...refs.currentPath, "properties", propName],
      propertyPath: [...refs.currentPath, "properties", propName]
    });
    if (parsedDef === void 0) {
      continue;
    }
    result.properties[propName] = parsedDef;
    if (!propOptional) {
      required.push(propName);
    }
  }
  if (required.length) {
    result.required = required;
  }
  const additionalProperties = decideAdditionalProperties(def, refs);
  if (additionalProperties !== void 0) {
    result.additionalProperties = additionalProperties;
  }
  return result;
}
function decideAdditionalProperties(def, refs) {
  if (def.catchall._def.typeName !== "ZodNever") {
    return parseDef(def.catchall._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    });
  }
  switch (def.unknownKeys) {
    case "passthrough":
      return refs.allowedAdditionalProperties;
    case "strict":
      return refs.rejectedAdditionalProperties;
    case "strip":
      return refs.removeAdditionalStrategy === "strict" ? refs.allowedAdditionalProperties : refs.rejectedAdditionalProperties;
  }
}
function safeIsOptional(schema) {
  try {
    return schema.isOptional();
  } catch (e) {
    return true;
  }
}

// src/zod-to-json-schema/parsers/optional.ts
var parseOptionalDef = (def, refs) => {
  var _a;
  if (refs.currentPath.toString() === ((_a = refs.propertyPath) == null ? void 0 : _a.toString())) {
    return parseDef(def.innerType._def, refs);
  }
  const innerSchema = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", "1"]
  });
  return innerSchema ? { anyOf: [{ not: parseAnyDef() }, innerSchema] } : parseAnyDef();
};

// src/zod-to-json-schema/parsers/pipeline.ts
var parsePipelineDef = (def, refs) => {
  if (refs.pipeStrategy === "input") {
    return parseDef(def.in._def, refs);
  } else if (refs.pipeStrategy === "output") {
    return parseDef(def.out._def, refs);
  }
  const a = parseDef(def.in._def, {
    ...refs,
    currentPath: [...refs.currentPath, "allOf", "0"]
  });
  const b = parseDef(def.out._def, {
    ...refs,
    currentPath: [...refs.currentPath, "allOf", a ? "1" : "0"]
  });
  return {
    allOf: [a, b].filter((x) => x !== void 0)
  };
};

// src/zod-to-json-schema/parsers/promise.ts
function parsePromiseDef(def, refs) {
  return parseDef(def.type._def, refs);
}

// src/zod-to-json-schema/parsers/set.ts
function parseSetDef(def, refs) {
  const items = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items"]
  });
  const schema = {
    type: "array",
    uniqueItems: true,
    items
  };
  if (def.minSize) {
    schema.minItems = def.minSize.value;
  }
  if (def.maxSize) {
    schema.maxItems = def.maxSize.value;
  }
  return schema;
}

// src/zod-to-json-schema/parsers/tuple.ts
function parseTupleDef(def, refs) {
  if (def.rest) {
    return {
      type: "array",
      minItems: def.items.length,
      items: def.items.map(
        (x, i) => parseDef(x._def, {
          ...refs,
          currentPath: [...refs.currentPath, "items", `${i}`]
        })
      ).reduce(
        (acc, x) => x === void 0 ? acc : [...acc, x],
        []
      ),
      additionalItems: parseDef(def.rest._def, {
        ...refs,
        currentPath: [...refs.currentPath, "additionalItems"]
      })
    };
  } else {
    return {
      type: "array",
      minItems: def.items.length,
      maxItems: def.items.length,
      items: def.items.map(
        (x, i) => parseDef(x._def, {
          ...refs,
          currentPath: [...refs.currentPath, "items", `${i}`]
        })
      ).reduce(
        (acc, x) => x === void 0 ? acc : [...acc, x],
        []
      )
    };
  }
}

// src/zod-to-json-schema/parsers/undefined.ts
function parseUndefinedDef() {
  return {
    not: parseAnyDef()
  };
}

// src/zod-to-json-schema/parsers/unknown.ts
function parseUnknownDef() {
  return parseAnyDef();
}

// src/zod-to-json-schema/parsers/readonly.ts
var parseReadonlyDef = (def, refs) => {
  return parseDef(def.innerType._def, refs);
};

// src/zod-to-json-schema/select-parser.ts
var selectParser = (def, typeName, refs) => {
  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString:
      return parseStringDef(def, refs);
    case ZodFirstPartyTypeKind.ZodNumber:
      return parseNumberDef(def);
    case ZodFirstPartyTypeKind.ZodObject:
      return parseObjectDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBigInt:
      return parseBigintDef(def);
    case ZodFirstPartyTypeKind.ZodBoolean:
      return parseBooleanDef();
    case ZodFirstPartyTypeKind.ZodDate:
      return parseDateDef(def, refs);
    case ZodFirstPartyTypeKind.ZodUndefined:
      return parseUndefinedDef();
    case ZodFirstPartyTypeKind.ZodNull:
      return parseNullDef();
    case ZodFirstPartyTypeKind.ZodArray:
      return parseArrayDef(def, refs);
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return parseUnionDef(def, refs);
    case ZodFirstPartyTypeKind.ZodIntersection:
      return parseIntersectionDef(def, refs);
    case ZodFirstPartyTypeKind.ZodTuple:
      return parseTupleDef(def, refs);
    case ZodFirstPartyTypeKind.ZodRecord:
      return parseRecordDef(def, refs);
    case ZodFirstPartyTypeKind.ZodLiteral:
      return parseLiteralDef(def);
    case ZodFirstPartyTypeKind.ZodEnum:
      return parseEnumDef(def);
    case ZodFirstPartyTypeKind.ZodNativeEnum:
      return parseNativeEnumDef(def);
    case ZodFirstPartyTypeKind.ZodNullable:
      return parseNullableDef(def, refs);
    case ZodFirstPartyTypeKind.ZodOptional:
      return parseOptionalDef(def, refs);
    case ZodFirstPartyTypeKind.ZodMap:
      return parseMapDef(def, refs);
    case ZodFirstPartyTypeKind.ZodSet:
      return parseSetDef(def, refs);
    case ZodFirstPartyTypeKind.ZodLazy:
      return () => def.getter()._def;
    case ZodFirstPartyTypeKind.ZodPromise:
      return parsePromiseDef(def, refs);
    case ZodFirstPartyTypeKind.ZodNaN:
    case ZodFirstPartyTypeKind.ZodNever:
      return parseNeverDef();
    case ZodFirstPartyTypeKind.ZodEffects:
      return parseEffectsDef(def, refs);
    case ZodFirstPartyTypeKind.ZodAny:
      return parseAnyDef();
    case ZodFirstPartyTypeKind.ZodUnknown:
      return parseUnknownDef();
    case ZodFirstPartyTypeKind.ZodDefault:
      return parseDefaultDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBranded:
      return parseBrandedDef(def, refs);
    case ZodFirstPartyTypeKind.ZodReadonly:
      return parseReadonlyDef(def, refs);
    case ZodFirstPartyTypeKind.ZodCatch:
      return parseCatchDef(def, refs);
    case ZodFirstPartyTypeKind.ZodPipeline:
      return parsePipelineDef(def, refs);
    case ZodFirstPartyTypeKind.ZodFunction:
    case ZodFirstPartyTypeKind.ZodVoid:
    case ZodFirstPartyTypeKind.ZodSymbol:
      return void 0;
    default:
      return /* @__PURE__ */ ((_) => void 0)();
  }
};

// src/zod-to-json-schema/parse-def.ts
function parseDef(def, refs, forceResolution = false) {
  var _a;
  const seenItem = refs.seen.get(def);
  if (refs.override) {
    const overrideResult = (_a = refs.override) == null ? void 0 : _a.call(
      refs,
      def,
      refs,
      seenItem,
      forceResolution
    );
    if (overrideResult !== ignoreOverride) {
      return overrideResult;
    }
  }
  if (seenItem && !forceResolution) {
    const seenSchema = get$ref(seenItem, refs);
    if (seenSchema !== void 0) {
      return seenSchema;
    }
  }
  const newItem = { def, path: refs.currentPath, jsonSchema: void 0 };
  refs.seen.set(def, newItem);
  const jsonSchemaOrGetter = selectParser(def, def.typeName, refs);
  const jsonSchema2 = typeof jsonSchemaOrGetter === "function" ? parseDef(jsonSchemaOrGetter(), refs) : jsonSchemaOrGetter;
  if (jsonSchema2) {
    addMeta(def, refs, jsonSchema2);
  }
  if (refs.postProcess) {
    const postProcessResult = refs.postProcess(jsonSchema2, def, refs);
    newItem.jsonSchema = jsonSchema2;
    return postProcessResult;
  }
  newItem.jsonSchema = jsonSchema2;
  return jsonSchema2;
}
var get$ref = (item, refs) => {
  switch (refs.$refStrategy) {
    case "root":
      return { $ref: item.path.join("/") };
    case "relative":
      return { $ref: getRelativePath(refs.currentPath, item.path) };
    case "none":
    case "seen": {
      if (item.path.length < refs.currentPath.length && item.path.every((value, index) => refs.currentPath[index] === value)) {
        console.warn(
          `Recursive reference detected at ${refs.currentPath.join(
            "/"
          )}! Defaulting to any`
        );
        return parseAnyDef();
      }
      return refs.$refStrategy === "seen" ? parseAnyDef() : void 0;
    }
  }
};
var addMeta = (def, refs, jsonSchema2) => {
  if (def.description) {
    jsonSchema2.description = def.description;
  }
  return jsonSchema2;
};

// src/zod-to-json-schema/refs.ts
var getRefs = (options) => {
  const _options = getDefaultOptions(options);
  const currentPath = _options.name !== void 0 ? [..._options.basePath, _options.definitionPath, _options.name] : _options.basePath;
  return {
    ..._options,
    currentPath,
    propertyPath: void 0,
    seen: new Map(
      Object.entries(_options.definitions).map(([name, def]) => [
        def._def,
        {
          def: def._def,
          path: [..._options.basePath, _options.definitionPath, name],
          // Resolution of references will be forced even though seen, so it's ok that the schema is undefined here for now.
          jsonSchema: void 0
        }
      ])
    )
  };
};

// src/zod-to-json-schema/zod-to-json-schema.ts
var zodToJsonSchema = (schema, options) => {
  var _a;
  const refs = getRefs(options);
  let definitions = typeof options === "object" && options.definitions ? Object.entries(options.definitions).reduce(
    (acc, [name2, schema2]) => {
      var _a2;
      return {
        ...acc,
        [name2]: (_a2 = parseDef(
          schema2._def,
          {
            ...refs,
            currentPath: [...refs.basePath, refs.definitionPath, name2]
          },
          true
        )) != null ? _a2 : parseAnyDef()
      };
    },
    {}
  ) : void 0;
  const name = typeof options === "string" ? options : (options == null ? void 0 : options.nameStrategy) === "title" ? void 0 : options == null ? void 0 : options.name;
  const main = (_a = parseDef(
    schema._def,
    name === void 0 ? refs : {
      ...refs,
      currentPath: [...refs.basePath, refs.definitionPath, name]
    },
    false
  )) != null ? _a : parseAnyDef();
  const title = typeof options === "object" && options.name !== void 0 && options.nameStrategy === "title" ? options.name : void 0;
  if (title !== void 0) {
    main.title = title;
  }
  const combined = name === void 0 ? definitions ? {
    ...main,
    [refs.definitionPath]: definitions
  } : main : {
    $ref: [
      ...refs.$refStrategy === "relative" ? [] : refs.basePath,
      refs.definitionPath,
      name
    ].join("/"),
    [refs.definitionPath]: {
      ...definitions,
      [name]: main
    }
  };
  combined.$schema = "http://json-schema.org/draft-07/schema#";
  return combined;
};

// src/zod-to-json-schema/index.ts
var zod_to_json_schema_default = zodToJsonSchema;

// src/zod-schema.ts
function zod3Schema(zodSchema2, options) {
  var _a;
  const useReferences = (_a = void 0 ) != null ? _a : false;
  return jsonSchema(
    // defer json schema creation to avoid unnecessary computation when only validation is needed
    () => zod_to_json_schema_default(zodSchema2, {
      $refStrategy: useReferences ? "root" : "none"
    }),
    {
      validate: async (value) => {
        const result = await zodSchema2.safeParseAsync(value);
        return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
      }
    }
  );
}
function zod4Schema(zodSchema2, options) {
  var _a;
  const useReferences = (_a = void 0 ) != null ? _a : false;
  return jsonSchema(
    // defer json schema creation to avoid unnecessary computation when only validation is needed
    () => toJSONSchema(zodSchema2, {
      target: "draft-7",
      io: "output",
      reused: useReferences ? "ref" : "inline"
    }),
    {
      validate: async (value) => {
        const result = await safeParseAsync(zodSchema2, value);
        return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
      }
    }
  );
}
function isZod4Schema(zodSchema2) {
  return "_zod" in zodSchema2;
}
function zodSchema(zodSchema2, options) {
  if (isZod4Schema(zodSchema2)) {
    return zod4Schema(zodSchema2);
  } else {
    return zod3Schema(zodSchema2);
  }
}

// src/schema.ts
var schemaSymbol = Symbol.for("vercel.ai.schema");
function jsonSchema(jsonSchema2, {
  validate
} = {}) {
  return {
    [schemaSymbol]: true,
    _type: void 0,
    // should never be used directly
    [validatorSymbol]: true,
    get jsonSchema() {
      if (typeof jsonSchema2 === "function") {
        jsonSchema2 = jsonSchema2();
      }
      return jsonSchema2;
    },
    validate
  };
}
function isSchema(value) {
  return typeof value === "object" && value !== null && schemaSymbol in value && value[schemaSymbol] === true && "jsonSchema" in value && "validate" in value;
}
function asSchema(schema) {
  return schema == null ? jsonSchema({
    properties: {},
    additionalProperties: false
  }) : isSchema(schema) ? schema : typeof schema === "function" ? schema() : zodSchema(schema);
}

var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name16 in all)
    __defProp(target, name16, { get: all[name16], enumerable: true });
};
var name6 = "AI_NoObjectGeneratedError";
var marker6 = `vercel.ai.error.${name6}`;
var symbol6 = Symbol.for(marker6);
var _a6;
var NoObjectGeneratedError = class extends AISDKError {
  constructor({
    message = "No object generated.",
    cause,
    text: text2,
    response,
    usage,
    finishReason
  }) {
    super({ name: name6, message, cause });
    this[_a6] = true;
    this.text = text2;
    this.response = response;
    this.usage = usage;
    this.finishReason = finishReason;
  }
  static isInstance(error) {
    return AISDKError.hasMarker(error, marker6);
  }
};
_a6 = symbol6;

// src/prompt/data-content.ts
var dataContentSchema = union([
  string(),
  _instanceof(Uint8Array),
  _instanceof(ArrayBuffer),
  custom(
    // Buffer might not be available in some environments such as CloudFlare:
    (value) => {
      var _a16, _b;
      return (_b = (_a16 = globalThis.Buffer) == null ? void 0 : _a16.isBuffer(value)) != null ? _b : false;
    },
    { message: "Must be a Buffer" }
  )
]);
var jsonValueSchema = lazy(
  () => union([
    _null(),
    string(),
    number(),
    boolean(),
    record(string(), jsonValueSchema),
    array(jsonValueSchema)
  ])
);

// src/types/provider-metadata.ts
var providerMetadataSchema = record(
  string(),
  record(string(), jsonValueSchema)
);
var textPartSchema = object$1({
  type: literal("text"),
  text: string(),
  providerOptions: providerMetadataSchema.optional()
});
var imagePartSchema = object$1({
  type: literal("image"),
  image: union([dataContentSchema, _instanceof(URL)]),
  mediaType: string().optional(),
  providerOptions: providerMetadataSchema.optional()
});
var filePartSchema = object$1({
  type: literal("file"),
  data: union([dataContentSchema, _instanceof(URL)]),
  filename: string().optional(),
  mediaType: string(),
  providerOptions: providerMetadataSchema.optional()
});
var reasoningPartSchema = object$1({
  type: literal("reasoning"),
  text: string(),
  providerOptions: providerMetadataSchema.optional()
});
var toolCallPartSchema = object$1({
  type: literal("tool-call"),
  toolCallId: string(),
  toolName: string(),
  input: unknown(),
  providerOptions: providerMetadataSchema.optional(),
  providerExecuted: boolean().optional()
});
var outputSchema = discriminatedUnion("type", [
  object$1({
    type: literal("text"),
    value: string()
  }),
  object$1({
    type: literal("json"),
    value: jsonValueSchema
  }),
  object$1({
    type: literal("error-text"),
    value: string()
  }),
  object$1({
    type: literal("error-json"),
    value: jsonValueSchema
  }),
  object$1({
    type: literal("content"),
    value: array(
      union([
        object$1({
          type: literal("text"),
          text: string()
        }),
        object$1({
          type: literal("media"),
          data: string(),
          mediaType: string()
        })
      ])
    )
  })
]);
var toolResultPartSchema = object$1({
  type: literal("tool-result"),
  toolCallId: string(),
  toolName: string(),
  output: outputSchema,
  providerOptions: providerMetadataSchema.optional()
});

// src/prompt/message.ts
var systemModelMessageSchema = object$1(
  {
    role: literal("system"),
    content: string(),
    providerOptions: providerMetadataSchema.optional()
  }
);
var userModelMessageSchema = object$1({
  role: literal("user"),
  content: union([
    string(),
    array(union([textPartSchema, imagePartSchema, filePartSchema]))
  ]),
  providerOptions: providerMetadataSchema.optional()
});
var assistantModelMessageSchema = object$1({
  role: literal("assistant"),
  content: union([
    string(),
    array(
      union([
        textPartSchema,
        filePartSchema,
        reasoningPartSchema,
        toolCallPartSchema,
        toolResultPartSchema
      ])
    )
  ]),
  providerOptions: providerMetadataSchema.optional()
});
var toolModelMessageSchema = object$1({
  role: literal("tool"),
  content: array(toolResultPartSchema),
  providerOptions: providerMetadataSchema.optional()
});
union([
  systemModelMessageSchema,
  userModelMessageSchema,
  assistantModelMessageSchema,
  toolModelMessageSchema
]);

// src/generate-text/generate-text.ts
createIdGenerator({
  prefix: "aitxt",
  size: 24
});

// src/util/fix-json.ts
function fixJson(input) {
  const stack = ["ROOT"];
  let lastValidIndex = -1;
  let literalStart = null;
  function processValueStart(char, i, swapState) {
    {
      switch (char) {
        case '"': {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_STRING");
          break;
        }
        case "f":
        case "t":
        case "n": {
          lastValidIndex = i;
          literalStart = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_LITERAL");
          break;
        }
        case "-": {
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_NUMBER");
          break;
        }
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9": {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_NUMBER");
          break;
        }
        case "{": {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_OBJECT_START");
          break;
        }
        case "[": {
          lastValidIndex = i;
          stack.pop();
          stack.push(swapState);
          stack.push("INSIDE_ARRAY_START");
          break;
        }
      }
    }
  }
  function processAfterObjectValue(char, i) {
    switch (char) {
      case ",": {
        stack.pop();
        stack.push("INSIDE_OBJECT_AFTER_COMMA");
        break;
      }
      case "}": {
        lastValidIndex = i;
        stack.pop();
        break;
      }
    }
  }
  function processAfterArrayValue(char, i) {
    switch (char) {
      case ",": {
        stack.pop();
        stack.push("INSIDE_ARRAY_AFTER_COMMA");
        break;
      }
      case "]": {
        lastValidIndex = i;
        stack.pop();
        break;
      }
    }
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const currentState = stack[stack.length - 1];
    switch (currentState) {
      case "ROOT":
        processValueStart(char, i, "FINISH");
        break;
      case "INSIDE_OBJECT_START": {
        switch (char) {
          case '"': {
            stack.pop();
            stack.push("INSIDE_OBJECT_KEY");
            break;
          }
          case "}": {
            lastValidIndex = i;
            stack.pop();
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_AFTER_COMMA": {
        switch (char) {
          case '"': {
            stack.pop();
            stack.push("INSIDE_OBJECT_KEY");
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_KEY": {
        switch (char) {
          case '"': {
            stack.pop();
            stack.push("INSIDE_OBJECT_AFTER_KEY");
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_AFTER_KEY": {
        switch (char) {
          case ":": {
            stack.pop();
            stack.push("INSIDE_OBJECT_BEFORE_VALUE");
            break;
          }
        }
        break;
      }
      case "INSIDE_OBJECT_BEFORE_VALUE": {
        processValueStart(char, i, "INSIDE_OBJECT_AFTER_VALUE");
        break;
      }
      case "INSIDE_OBJECT_AFTER_VALUE": {
        processAfterObjectValue(char, i);
        break;
      }
      case "INSIDE_STRING": {
        switch (char) {
          case '"': {
            stack.pop();
            lastValidIndex = i;
            break;
          }
          case "\\": {
            stack.push("INSIDE_STRING_ESCAPE");
            break;
          }
          default: {
            lastValidIndex = i;
          }
        }
        break;
      }
      case "INSIDE_ARRAY_START": {
        switch (char) {
          case "]": {
            lastValidIndex = i;
            stack.pop();
            break;
          }
          default: {
            lastValidIndex = i;
            processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE");
            break;
          }
        }
        break;
      }
      case "INSIDE_ARRAY_AFTER_VALUE": {
        switch (char) {
          case ",": {
            stack.pop();
            stack.push("INSIDE_ARRAY_AFTER_COMMA");
            break;
          }
          case "]": {
            lastValidIndex = i;
            stack.pop();
            break;
          }
          default: {
            lastValidIndex = i;
            break;
          }
        }
        break;
      }
      case "INSIDE_ARRAY_AFTER_COMMA": {
        processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE");
        break;
      }
      case "INSIDE_STRING_ESCAPE": {
        stack.pop();
        lastValidIndex = i;
        break;
      }
      case "INSIDE_NUMBER": {
        switch (char) {
          case "0":
          case "1":
          case "2":
          case "3":
          case "4":
          case "5":
          case "6":
          case "7":
          case "8":
          case "9": {
            lastValidIndex = i;
            break;
          }
          case "e":
          case "E":
          case "-":
          case ".": {
            break;
          }
          case ",": {
            stack.pop();
            if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
              processAfterArrayValue(char, i);
            }
            if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
              processAfterObjectValue(char, i);
            }
            break;
          }
          case "}": {
            stack.pop();
            if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
              processAfterObjectValue(char, i);
            }
            break;
          }
          case "]": {
            stack.pop();
            if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
              processAfterArrayValue(char, i);
            }
            break;
          }
          default: {
            stack.pop();
            break;
          }
        }
        break;
      }
      case "INSIDE_LITERAL": {
        const partialLiteral = input.substring(literalStart, i + 1);
        if (!"false".startsWith(partialLiteral) && !"true".startsWith(partialLiteral) && !"null".startsWith(partialLiteral)) {
          stack.pop();
          if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
            processAfterObjectValue(char, i);
          } else if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
            processAfterArrayValue(char, i);
          }
        } else {
          lastValidIndex = i;
        }
        break;
      }
    }
  }
  let result = input.slice(0, lastValidIndex + 1);
  for (let i = stack.length - 1; i >= 0; i--) {
    const state = stack[i];
    switch (state) {
      case "INSIDE_STRING": {
        result += '"';
        break;
      }
      case "INSIDE_OBJECT_KEY":
      case "INSIDE_OBJECT_AFTER_KEY":
      case "INSIDE_OBJECT_AFTER_COMMA":
      case "INSIDE_OBJECT_START":
      case "INSIDE_OBJECT_BEFORE_VALUE":
      case "INSIDE_OBJECT_AFTER_VALUE": {
        result += "}";
        break;
      }
      case "INSIDE_ARRAY_START":
      case "INSIDE_ARRAY_AFTER_COMMA":
      case "INSIDE_ARRAY_AFTER_VALUE": {
        result += "]";
        break;
      }
      case "INSIDE_LITERAL": {
        const partialLiteral = input.substring(literalStart, input.length);
        if ("true".startsWith(partialLiteral)) {
          result += "true".slice(partialLiteral.length);
        } else if ("false".startsWith(partialLiteral)) {
          result += "false".slice(partialLiteral.length);
        } else if ("null".startsWith(partialLiteral)) {
          result += "null".slice(partialLiteral.length);
        }
      }
    }
  }
  return result;
}

// src/util/parse-partial-json.ts
async function parsePartialJson(jsonText) {
  if (jsonText === void 0) {
    return { value: void 0, state: "undefined-input" };
  }
  let result = await safeParseJSON({ text: jsonText });
  if (result.success) {
    return { value: result.value, state: "successful-parse" };
  }
  result = await safeParseJSON({ text: fixJson(jsonText) });
  if (result.success) {
    return { value: result.value, state: "repaired-parse" };
  }
  return { value: void 0, state: "failed-parse" };
}

// src/generate-text/stream-text.ts
createIdGenerator({
  prefix: "aitxt",
  size: 24
});

// src/generate-object/generate-object.ts
createIdGenerator({ prefix: "aiobj", size: 24 });

// src/generate-object/stream-object.ts
createIdGenerator({ prefix: "aiobj", size: 24 });

// src/generate-text/output.ts
var output_exports = {};
__export(output_exports, {
  object: () => object,
  text: () => text
});
var text = () => ({
  type: "text",
  responseFormat: { type: "text" },
  async parsePartial({ text: text2 }) {
    return { partial: text2 };
  },
  async parseOutput({ text: text2 }) {
    return text2;
  }
});
var object = ({
  schema: inputSchema
}) => {
  const schema = asSchema(inputSchema);
  return {
    type: "object",
    responseFormat: {
      type: "json",
      schema: schema.jsonSchema
    },
    async parsePartial({ text: text2 }) {
      const result = await parsePartialJson(text2);
      switch (result.state) {
        case "failed-parse":
        case "undefined-input":
          return void 0;
        case "repaired-parse":
        case "successful-parse":
          return {
            // Note: currently no validation of partial results:
            partial: result.value
          };
        default: {
          const _exhaustiveCheck = result.state;
          throw new Error(`Unsupported parse state: ${_exhaustiveCheck}`);
        }
      }
    },
    async parseOutput({ text: text2 }, context) {
      const parseResult = await safeParseJSON({ text: text2 });
      if (!parseResult.success) {
        throw new NoObjectGeneratedError({
          message: "No object generated: could not parse the response.",
          cause: parseResult.error,
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      const validationResult = await safeValidateTypes({
        value: parseResult.value,
        schema
      });
      if (!validationResult.success) {
        throw new NoObjectGeneratedError({
          message: "No object generated: response did not match schema.",
          cause: validationResult.error,
          text: text2,
          response: context.response,
          usage: context.usage,
          finishReason: context.finishReason
        });
      }
      return validationResult.value;
    }
  };
};

// src/index.ts
function convertJsonSchemaToZod(schema) {
  function addMetadata(zodSchema, jsonSchema) {
    if (jsonSchema.description) {
      zodSchema = zodSchema.describe(jsonSchema.description);
    }
    return zodSchema;
  }
  if (schema.const !== void 0) {
    if (typeof schema.const === "string") {
      return addMetadata(literalType(schema.const), schema);
    } else if (typeof schema.const === "number") {
      return addMetadata(literalType(schema.const), schema);
    } else if (typeof schema.const === "boolean") {
      return addMetadata(literalType(schema.const), schema);
    } else if (schema.const === null) {
      return addMetadata(nullType(), schema);
    }
    return addMetadata(literalType(schema.const), schema);
  }
  if (schema.type) {
    switch (schema.type) {
      case "string": {
        if (schema.enum) {
          if (schema.enum.length === 0) {
            return addMetadata(stringType(), schema);
          }
          return addMetadata(enumType(schema.enum), schema);
        }
        let stringSchema = stringType();
        if (schema.minLength !== void 0) {
          stringSchema = stringSchema.min(schema.minLength);
        }
        if (schema.maxLength !== void 0) {
          stringSchema = stringSchema.max(schema.maxLength);
        }
        if (schema.pattern !== void 0) {
          const regex = new RegExp(schema.pattern);
          stringSchema = stringSchema.regex(regex);
        }
        return addMetadata(stringSchema, schema);
      }
      case "number":
      case "integer": {
        if (schema.enum) {
          if (schema.enum.length === 0) {
            return addMetadata(numberType(), schema);
          }
          const options = schema.enum.map((val) => literalType(val));
          if (options.length === 1) {
            return addMetadata(options[0], schema);
          }
          if (options.length >= 2) {
            const unionSchema = unionType([options[0], options[1], ...options.slice(2)]);
            return addMetadata(unionSchema, schema);
          }
        }
        let numberSchema = schema.type === "integer" ? numberType().int() : numberType();
        if (schema.minimum !== void 0) {
          numberSchema = numberSchema.min(schema.minimum);
        }
        if (schema.maximum !== void 0) {
          numberSchema = numberSchema.max(schema.maximum);
        }
        if (schema.exclusiveMinimum !== void 0) {
          numberSchema = numberSchema.gt(schema.exclusiveMinimum);
        }
        if (schema.exclusiveMaximum !== void 0) {
          numberSchema = numberSchema.lt(schema.exclusiveMaximum);
        }
        if (schema.multipleOf !== void 0) {
          numberSchema = numberSchema.multipleOf(schema.multipleOf);
        }
        return addMetadata(numberSchema, schema);
      }
      case "boolean":
        if (schema.enum) {
          if (schema.enum.length === 0) {
            return addMetadata(booleanType(), schema);
          }
          const options = schema.enum.map((val) => literalType(val));
          if (options.length === 1) {
            return addMetadata(options[0], schema);
          }
          if (options.length >= 2) {
            const unionSchema = unionType([options[0], options[1], ...options.slice(2)]);
            return addMetadata(unionSchema, schema);
          }
        }
        return addMetadata(booleanType(), schema);
      case "null":
        return addMetadata(nullType(), schema);
      case "object":
        if (schema.properties) {
          const shape = {};
          for (const [key, propSchema] of Object.entries(
            schema.properties
          )) {
            shape[key] = convertJsonSchemaToZod(propSchema);
          }
          if (schema.required && Array.isArray(schema.required)) {
            const required = new Set(schema.required);
            for (const key of Object.keys(shape)) {
              if (!required.has(key)) {
                shape[key] = shape[key].optional();
              }
            }
          } else {
            for (const key of Object.keys(shape)) {
              shape[key] = shape[key].optional();
            }
          }
          let zodSchema;
          if (schema.additionalProperties !== false) {
            zodSchema = objectType(shape).passthrough();
          } else {
            zodSchema = objectType(shape);
          }
          return addMetadata(zodSchema, schema);
        }
        return addMetadata(objectType({}), schema);
      case "array": {
        let arraySchema;
        if (schema.items) {
          arraySchema = arrayType(convertJsonSchemaToZod(schema.items));
        } else {
          arraySchema = arrayType(anyType());
        }
        if (schema.minItems !== void 0) {
          arraySchema = arraySchema.min(schema.minItems);
        }
        if (schema.maxItems !== void 0) {
          arraySchema = arraySchema.max(schema.maxItems);
        }
        if (schema.uniqueItems === true) {
          arraySchema = arraySchema.refine(
            (items) => {
              const seen = /* @__PURE__ */ new Set();
              return items.every((item) => {
                if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
                  if (seen.has(item)) return false;
                  seen.add(item);
                  return true;
                }
                const serialized = JSON.stringify(item);
                if (seen.has(serialized)) return false;
                seen.add(serialized);
                return true;
              });
            },
            { message: "Array items must be unique" }
          );
        }
        return addMetadata(arraySchema, schema);
      }
    }
  }
  if (schema.enum) {
    if (schema.enum.length === 0) {
      return addMetadata(neverType(), schema);
    }
    const allStrings = schema.enum.every((val) => typeof val === "string");
    if (allStrings) {
      return addMetadata(enumType(schema.enum), schema);
    } else {
      const options = schema.enum.map((val) => literalType(val));
      if (options.length === 1) {
        return addMetadata(options[0], schema);
      }
      if (options.length >= 2) {
        const unionSchema = unionType([options[0], options[1], ...options.slice(2)]);
        return addMetadata(unionSchema, schema);
      }
    }
  }
  if (schema.anyOf && schema.anyOf.length >= 2) {
    const schemas = schema.anyOf.map(convertJsonSchemaToZod);
    return addMetadata(
      unionType([schemas[0], schemas[1], ...schemas.slice(2)]),
      schema
    );
  }
  if (schema.allOf) {
    return addMetadata(
      schema.allOf.reduce(
        (acc, s) => intersectionType(acc, convertJsonSchemaToZod(s)),
        objectType({})
      ),
      schema
    );
  }
  if (schema.oneOf && schema.oneOf.length >= 2) {
    const schemas = schema.oneOf.map(convertJsonSchemaToZod);
    return addMetadata(
      unionType([schemas[0], schemas[1], ...schemas.slice(2)]),
      schema
    );
  }
  return addMetadata(anyType(), schema);
}

function convertZodSchemaToAISDKSchema(zodSchema, target = "jsonSchema7") {
  const jsonSchemaToUse = zodToJsonSchema$1(zodSchema, target);
  return jsonSchema(jsonSchemaToUse, {
    validate: (value) => {
      const result = zodSchema.safeParse(value);
      return result.success ? { success: true, value: result.data } : { success: false, error: result.error };
    }
  });
}
function isZodType$1(value) {
  return typeof value === "object" && value !== null && "_def" in value && "parse" in value && typeof value.parse === "function" && "safeParse" in value && typeof value.safeParse === "function";
}
function convertSchemaToZod(schema) {
  if (isZodType$1(schema)) {
    return schema;
  } else {
    const jsonSchemaToConvert = "jsonSchema" in schema ? schema.jsonSchema : schema;
    try {
      {
        return convertJsonSchemaToZod(jsonSchemaToConvert);
      }
    } catch (e) {
      const errorMessage = `[Schema Builder] Failed to convert schema parameters to Zod. Original schema: ${JSON.stringify(jsonSchemaToConvert)}`;
      console.error(errorMessage, e);
      throw new Error(errorMessage + (e instanceof Error ? `
${e.stack}` : "\nUnknown error object"));
    }
  }
}
function applyCompatLayer({
  schema,
  compatLayers,
  mode
}) {
  let zodSchema;
  if (!isZodType$1(schema)) {
    zodSchema = convertSchemaToZod(schema);
  } else {
    zodSchema = schema;
  }
  for (const compat of compatLayers) {
    if (compat.shouldApply()) {
      return mode === "jsonSchema" ? compat.processToJSONSchema(zodSchema) : compat.processToAISDKSchema(zodSchema);
    }
  }
  {
    return convertZodSchemaToAISDKSchema(zodSchema);
  }
}

// src/schema-compatibility-v3.ts
var ALL_STRING_CHECKS = ["regex", "emoji", "email", "url", "uuid", "cuid", "min", "max"];
var ALL_NUMBER_CHECKS = [
  "min",
  // gte internally
  "max",
  // lte internally
  "multipleOf"
];
var ALL_ARRAY_CHECKS = ["min", "max", "length"];
var UNSUPPORTED_ZOD_TYPES = ["ZodIntersection", "ZodNever", "ZodNull", "ZodTuple", "ZodUndefined"];
var SUPPORTED_ZOD_TYPES = [
  "ZodObject",
  "ZodArray",
  "ZodUnion",
  "ZodString",
  "ZodNumber",
  "ZodDate",
  "ZodAny",
  "ZodDefault"
];
var SchemaCompatLayer = class {
  model;
  parent;
  /**
   * Creates a new schema compatibility instance.
   *
   * @param model - The language model this compatibility layer applies to
   */
  constructor(model, parent) {
    this.model = model;
    this.parent = parent;
  }
  /**
   * Gets the language model associated with this compatibility layer.
   *
   * @returns The language model instance
   */
  getModel() {
    return this.model;
  }
  getUnsupportedZodTypes() {
    return UNSUPPORTED_ZOD_TYPES;
  }
  /**
   * Type guard for optional Zod types
   */
  isOptional(v) {
    return v instanceof ZodOptional;
  }
  /**
   * Type guard for object Zod types
   */
  isObj(v) {
    return v instanceof ZodObject;
  }
  /**
   * Type guard for null Zod types
   */
  isNull(v) {
    return v instanceof ZodNull;
  }
  /**
   * Type guard for array Zod types
   */
  isArr(v) {
    return v instanceof ZodArray;
  }
  /**
   * Type guard for union Zod types
   */
  isUnion(v) {
    return v instanceof ZodUnion;
  }
  /**
   * Type guard for string Zod types
   */
  isString(v) {
    return v instanceof ZodString;
  }
  /**
   * Type guard for number Zod types
   */
  isNumber(v) {
    return v instanceof ZodNumber;
  }
  /**
   * Type guard for date Zod types
   */
  isDate(v) {
    return v instanceof ZodDate;
  }
  /**
   * Type guard for default Zod types
   */
  isDefault(v) {
    return v instanceof ZodDefault;
  }
  /**
   * Determines whether this compatibility layer should be applied for the current model.
   *
   * @returns True if this compatibility layer should be used, false otherwise
   * @abstract
   */
  shouldApply() {
    return this.parent.shouldApply();
  }
  /**
   * Returns the JSON Schema target format for this provider.
   *
   * @returns The schema target format, or undefined to use the default 'jsonSchema7'
   * @abstract
   */
  getSchemaTarget() {
    return this.parent.getSchemaTarget();
  }
  /**
   * Processes a specific Zod type according to the provider's requirements.
   *
   * @param value - The Zod type to process
   * @returns The processed Zod type
   * @abstract
   */
  processZodType(value) {
    return this.parent.processZodType(value);
  }
  /**
   * Default handler for Zod object types. Recursively processes all properties in the object.
   *
   * @param value - The Zod object to process
   * @returns The processed Zod object
   */
  defaultZodObjectHandler(value, options = { passthrough: true }) {
    const processedShape = Object.entries(value.shape).reduce((acc, [key, propValue]) => {
      acc[key] = this.processZodType(propValue);
      return acc;
    }, {});
    let result = objectType(processedShape);
    if (value._def.unknownKeys === "strict") {
      result = result.strict();
    }
    if (value._def.catchall && !(value._def.catchall instanceof ZodNever)) {
      result = result.catchall(value._def.catchall);
    }
    if (value.description) {
      result = result.describe(value.description);
    }
    if (options.passthrough && value._def.unknownKeys === "passthrough") {
      result = result.passthrough();
    }
    return result;
  }
  /**
   * Merges validation constraints into a parameter description.
   *
   * This helper method converts validation constraints that may not be supported
   * by a provider into human-readable descriptions.
   *
   * @param description - The existing parameter description
   * @param constraints - The validation constraints to merge
   * @returns The updated description with constraints, or undefined if no constraints
   */
  mergeParameterDescription(description, constraints) {
    if (constraints.length > 0) {
      return (description ? description + "\n" : "") + `constraints: ${constraints.join(`, `)}`;
    } else {
      return description;
    }
  }
  /**
   * Default handler for unsupported Zod types. Throws an error for specified unsupported types.
   *
   * @param value - The Zod type to check
   * @param throwOnTypes - Array of type names to throw errors for
   * @returns The original value if not in the throw list
   * @throws Error if the type is in the unsupported list
   */
  defaultUnsupportedZodTypeHandler(value, throwOnTypes = UNSUPPORTED_ZOD_TYPES) {
    if (throwOnTypes.includes(value._def?.typeName)) {
      throw new Error(`${this.model.modelId} does not support zod type: ${value._def?.typeName}`);
    }
    return value;
  }
  /**
   * Default handler for Zod array types. Processes array constraints according to provider support.
   *
   * @param value - The Zod array to process
   * @param handleChecks - Array constraints to convert to descriptions vs keep as validation
   * @returns The processed Zod array
   */
  defaultZodArrayHandler(value, handleChecks = ALL_ARRAY_CHECKS) {
    const zodArrayDef = value._def;
    const processedType = this.processZodType(zodArrayDef.type);
    let result = arrayType(processedType);
    const constraints = [];
    if (zodArrayDef.minLength?.value !== void 0) {
      if (handleChecks.includes("min")) {
        constraints.push(`minimum length ${zodArrayDef.minLength.value}`);
      } else {
        result = result.min(zodArrayDef.minLength.value);
      }
    }
    if (zodArrayDef.maxLength?.value !== void 0) {
      if (handleChecks.includes("max")) {
        constraints.push(`maximum length ${zodArrayDef.maxLength.value}`);
      } else {
        result = result.max(zodArrayDef.maxLength.value);
      }
    }
    if (zodArrayDef.exactLength?.value !== void 0) {
      if (handleChecks.includes("length")) {
        constraints.push(`exact length ${zodArrayDef.exactLength.value}`);
      } else {
        result = result.length(zodArrayDef.exactLength.value);
      }
    }
    const description = this.mergeParameterDescription(value.description, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod union types. Processes all union options.
   *
   * @param value - The Zod union to process
   * @returns The processed Zod union
   * @throws Error if union has fewer than 2 options
   */
  defaultZodUnionHandler(value) {
    const processedOptions = value._def.options.map((option) => this.processZodType(option));
    if (processedOptions.length < 2) throw new Error("Union must have at least 2 options");
    let result = unionType(processedOptions);
    if (value.description) {
      result = result.describe(value.description);
    }
    return result;
  }
  /**
   * Default handler for Zod string types. Processes string validation constraints.
   *
   * @param value - The Zod string to process
   * @param handleChecks - String constraints to convert to descriptions vs keep as validation
   * @returns The processed Zod string
   */
  defaultZodStringHandler(value, handleChecks = ALL_STRING_CHECKS) {
    const constraints = [];
    const checks = value._def.checks || [];
    const newChecks = [];
    for (const check of checks) {
      if ("kind" in check) {
        if (handleChecks.includes(check.kind)) {
          switch (check.kind) {
            case "regex": {
              constraints.push(`input must match this regex ${check.regex.source}`);
              break;
            }
            case "emoji":
            case "email":
            case "url":
            case "uuid":
            case "cuid": {
              constraints.push(`a valid ${check.kind}`);
              break;
            }
            case "min":
            case "max": {
              constraints.push(`${check.kind}imum length ${check.value}`);
              break;
            }
          }
        } else {
          newChecks.push(check);
        }
      }
    }
    let result = stringType();
    for (const check of newChecks) {
      result = result._addCheck(check);
    }
    const description = this.mergeParameterDescription(value.description, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod number types. Processes number validation constraints.
   *
   * @param value - The Zod number to process
   * @param handleChecks - Number constraints to convert to descriptions vs keep as validation
   * @returns The processed Zod number
   */
  defaultZodNumberHandler(value, handleChecks = ALL_NUMBER_CHECKS) {
    const constraints = [];
    const checks = value._def.checks || [];
    const newChecks = [];
    for (const check of checks) {
      if ("kind" in check) {
        if (handleChecks.includes(check.kind)) {
          switch (check.kind) {
            case "min":
              if (check.inclusive) {
                constraints.push(`greater than or equal to ${check.value}`);
              } else {
                constraints.push(`greater than ${check.value}`);
              }
              break;
            case "max":
              if (check.inclusive) {
                constraints.push(`lower than or equal to ${check.value}`);
              } else {
                constraints.push(`lower than ${check.value}`);
              }
              break;
            case "multipleOf": {
              constraints.push(`multiple of ${check.value}`);
              break;
            }
          }
        } else {
          newChecks.push(check);
        }
      }
    }
    let result = numberType();
    for (const check of newChecks) {
      switch (check.kind) {
        case "int":
          result = result.int();
          break;
        case "finite":
          result = result.finite();
          break;
        default:
          result = result._addCheck(check);
      }
    }
    const description = this.mergeParameterDescription(value.description, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod date types. Converts dates to ISO strings with constraint descriptions.
   *
   * @param value - The Zod date to process
   * @returns A Zod string schema representing the date in ISO format
   */
  defaultZodDateHandler(value) {
    const constraints = [];
    const checks = value._def.checks || [];
    for (const check of checks) {
      if ("kind" in check) {
        switch (check.kind) {
          case "min":
            const minDate = new Date(check.value);
            if (!isNaN(minDate.getTime())) {
              constraints.push(`Date must be newer than ${minDate.toISOString()} (ISO)`);
            }
            break;
          case "max":
            const maxDate = new Date(check.value);
            if (!isNaN(maxDate.getTime())) {
              constraints.push(`Date must be older than ${maxDate.toISOString()} (ISO)`);
            }
            break;
        }
      }
    }
    constraints.push(`Date format is date-time`);
    let result = stringType().describe("date-time");
    const description = this.mergeParameterDescription(value.description, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod optional types. Processes the inner type and maintains optionality.
   *
   * @param value - The Zod optional to process
   * @param handleTypes - Types that should be processed vs passed through
   * @returns The processed Zod optional
   */
  defaultZodOptionalHandler(value, handleTypes = SUPPORTED_ZOD_TYPES) {
    if (handleTypes.includes(value._def.innerType._def.typeName)) {
      return this.processZodType(value._def.innerType).optional();
    } else {
      return value;
    }
  }
  /**
   * Processes a Zod object schema and converts it to an AI SDK Schema.
   *
   * @param zodSchema - The Zod object schema to process
   * @returns An AI SDK Schema with provider-specific compatibility applied
   */
  processToAISDKSchema(zodSchema) {
    const processedSchema = this.processZodType(zodSchema);
    return convertZodSchemaToAISDKSchema(processedSchema, this.getSchemaTarget());
  }
  /**
   * Processes a Zod object schema and converts it to a JSON Schema.
   *
   * @param zodSchema - The Zod object schema to process
   * @returns A JSONSchema7 object with provider-specific compatibility applied
   */
  processToJSONSchema(zodSchema) {
    return this.processToAISDKSchema(zodSchema).jsonSchema;
  }
};
var ALL_STRING_CHECKS2 = [
  "regex",
  "emoji",
  "email",
  "url",
  "uuid",
  "cuid",
  "min_length",
  "max_length",
  "string_format"
];
var ALL_NUMBER_CHECKS2 = ["greater_than", "less_than", "multiple_of"];
var ALL_ARRAY_CHECKS2 = ["min", "max", "length"];
var UNSUPPORTED_ZOD_TYPES2 = ["ZodIntersection", "ZodNever", "ZodNull", "ZodTuple", "ZodUndefined"];
var SUPPORTED_ZOD_TYPES2 = [
  "ZodObject",
  "ZodArray",
  "ZodUnion",
  "ZodString",
  "ZodNumber",
  "ZodDate",
  "ZodAny",
  "ZodDefault"
];
var SchemaCompatLayer2 = class {
  model;
  parent;
  /**
   * Creates a new schema compatibility instance.
   *
   * @param model - The language model this compatibility layer applies to
   */
  constructor(model, parent) {
    this.model = model;
    this.parent = parent;
  }
  /**
   * Gets the language model associated with this compatibility layer.
   *
   * @returns The language model instance
   */
  getModel() {
    return this.model;
  }
  getUnsupportedZodTypes() {
    return UNSUPPORTED_ZOD_TYPES2;
  }
  /**
   * Type guard for optional Zod types
   */
  isOptional(v) {
    return v instanceof ZodOptional$1;
  }
  /**
   * Type guard for object Zod types
   */
  isObj(v) {
    return v instanceof ZodObject$1;
  }
  /**
   * Type guard for null Zod types
   */
  isNull(v) {
    return v instanceof ZodNull$1;
  }
  /**
   * Type guard for array Zod types
   */
  isArr(v) {
    return v instanceof ZodArray$1;
  }
  /**
   * Type guard for union Zod types
   */
  isUnion(v) {
    return v instanceof ZodUnion$1;
  }
  /**
   * Type guard for string Zod types
   */
  isString(v) {
    return v instanceof ZodString$1;
  }
  /**
   * Type guard for number Zod types
   */
  isNumber(v) {
    return v instanceof ZodNumber$1;
  }
  /**
   * Type guard for date Zod types
   */
  isDate(v) {
    return v instanceof ZodDate$1;
  }
  /**
   * Type guard for default Zod types
   */
  isDefault(v) {
    return v instanceof ZodDefault$1;
  }
  /**
   * Determines whether this compatibility layer should be applied for the current model.
   *
   * @returns True if this compatibility layer should be used, false otherwise
   * @abstract
   */
  shouldApply() {
    return this.parent.shouldApply();
  }
  /**
   * Returns the JSON Schema target format for this provider.
   *
   * @returns The schema target format, or undefined to use the default 'jsonSchema7'
   * @abstract
   */
  getSchemaTarget() {
    return this.parent.getSchemaTarget();
  }
  /**
   * Processes a specific Zod type according to the provider's requirements.
   *
   * @param value - The Zod type to process
   * @returns The processed Zod type
   * @abstract
   */
  processZodType(value) {
    return this.parent.processZodType(value);
  }
  /**
   * Default handler for Zod object types. Recursively processes all properties in the object.
   *
   * @param value - The Zod object to process
   * @returns The processed Zod object
   */
  defaultZodObjectHandler(value, options = { passthrough: true }) {
    const processedShape = Object.entries(value.shape).reduce((acc, [key, propValue]) => {
      acc[key] = this.processZodType(propValue);
      return acc;
    }, {});
    let result = object$1(processedShape);
    if (value._zod.def.catchall instanceof ZodNever$1) {
      result = strictObject(processedShape);
    }
    if (value._zod.def.catchall && !(value._zod.def.catchall instanceof ZodNever$1)) {
      result = result.catchall(value._zod.def.catchall);
    }
    if (value.description) {
      result = result.describe(value.description);
    }
    if (options.passthrough && value._zod.def.catchall instanceof ZodUnknown) {
      result = looseObject(processedShape);
    }
    return result;
  }
  /**
   * Merges validation constraints into a parameter description.
   *
   * This helper method converts validation constraints that may not be supported
   * by a provider into human-readable descriptions.
   *
   * @param description - The existing parameter description
   * @param constraints - The validation constraints to merge
   * @returns The updated description with constraints, or undefined if no constraints
   */
  mergeParameterDescription(description, constraints) {
    if (constraints.length > 0) {
      return (description ? description + "\n" : "") + `constraints: ${constraints.join(`, `)}`;
    } else {
      return description;
    }
  }
  /**
   * Default handler for unsupported Zod types. Throws an error for specified unsupported types.
   *
   * @param value - The Zod type to check
   * @param throwOnTypes - Array of type names to throw errors for
   * @returns The original value if not in the throw list
   * @throws Error if the type is in the unsupported list
   */
  defaultUnsupportedZodTypeHandler(value, throwOnTypes = UNSUPPORTED_ZOD_TYPES2) {
    if (throwOnTypes.includes(value.constructor.name)) {
      throw new Error(`${this.model.modelId} does not support zod type: ${value.constructor.name}`);
    }
    return value;
  }
  /**
   * Default handler for Zod array types. Processes array constraints according to provider support.
   *
   * @param value - The Zod array to process
   * @param handleChecks - Array constraints to convert to descriptions vs keep as validation
   * @returns The processed Zod array
   */
  defaultZodArrayHandler(value, handleChecks = ALL_ARRAY_CHECKS2) {
    const zodArrayDef = value._zod.def;
    const processedType = this.processZodType(zodArrayDef.element);
    let result = array(processedType);
    const constraints = [];
    if (zodArrayDef.checks) {
      for (const check of zodArrayDef.checks) {
        if (check._zod.def.check === "min_length") {
          if (handleChecks.includes("min")) {
            constraints.push(`minimum length ${check._zod.def.minimum}`);
          } else {
            result = result.min(check._zod.def.minimum);
          }
        }
        if (check._zod.def.check === "max_length") {
          if (handleChecks.includes("max")) {
            constraints.push(`maximum length ${check._zod.def.maximum}`);
          } else {
            result = result.max(check._zod.def.maximum);
          }
        }
        if (check._zod.def.check === "length_equals") {
          if (handleChecks.includes("length")) {
            constraints.push(`exact length ${check._zod.def.length}`);
          } else {
            result = result.length(check._zod.def.length);
          }
        }
      }
    }
    const metaDescription = value.meta()?.description;
    const legacyDescription = value.description;
    const description = this.mergeParameterDescription(metaDescription || legacyDescription, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod union types. Processes all union options.
   *
   * @param value - The Zod union to process
   * @returns The processed Zod union
   * @throws Error if union has fewer than 2 options
   */
  defaultZodUnionHandler(value) {
    const processedOptions = value._zod.def.options.map((option) => this.processZodType(option));
    if (processedOptions.length < 2) throw new Error("Union must have at least 2 options");
    let result = union(processedOptions);
    if (value.description) {
      result = result.describe(value.description);
    }
    return result;
  }
  /**
   * Default handler for Zod string types. Processes string validation constraints.
   *
   * @param value - The Zod string to process
   * @param handleChecks - String constraints to convert to descriptions vs keep as validation
   * @returns The processed Zod string
   */
  defaultZodStringHandler(value, handleChecks = ALL_STRING_CHECKS2) {
    const constraints = [];
    const checks = value._zod.def.checks || [];
    const newChecks = [];
    if (checks) {
      for (const check of checks) {
        if (handleChecks.includes(check._zod.def.check)) {
          switch (check._zod.def.check) {
            case "min_length":
              constraints.push(`minimum length ${check._zod.def.minimum}`);
              break;
            case "max_length":
              constraints.push(`maximum length ${check._zod.def.maximum}`);
              break;
            case "string_format":
              {
                switch (check._zod.def.format) {
                  case "email":
                  case "url":
                  case "emoji":
                  case "uuid":
                  case "cuid":
                    constraints.push(`a valid ${check._zod.def.format}`);
                    break;
                  case "regex":
                    constraints.push(`input must match this regex ${check._zod.def.pattern}`);
                    break;
                }
              }
              break;
          }
        } else {
          newChecks.push(check);
        }
      }
    }
    let result = string();
    for (const check of newChecks) {
      result = result.check(check);
    }
    const metaDescription = value.meta()?.description;
    const legacyDescription = value.description;
    const description = this.mergeParameterDescription(metaDescription || legacyDescription, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod number types. Processes number validation constraints.
   *
   * @param value - The Zod number to process
   * @param handleChecks - Number constraints to convert to descriptions vs keep as validation
   * @returns The processed Zod number
   */
  defaultZodNumberHandler(value, handleChecks = ALL_NUMBER_CHECKS2) {
    const constraints = [];
    const checks = value._zod.def.checks || [];
    const newChecks = [];
    if (checks) {
      for (const check of checks) {
        if (handleChecks.includes(check._zod.def.check)) {
          switch (check._zod.def.check) {
            case "greater_than":
              if (check._zod.def.inclusive) {
                constraints.push(`greater than or equal to ${check._zod.def.value}`);
              } else {
                constraints.push(`greater than ${check._zod.def.value}`);
              }
              break;
            case "less_than":
              if (check._zod.def.inclusive) {
                constraints.push(`lower than or equal to ${check._zod.def.value}`);
              } else {
                constraints.push(`lower than ${check._zod.def.value}`);
              }
              break;
            case "multiple_of": {
              constraints.push(`multiple of ${check._zod.def.value}`);
              break;
            }
          }
        } else {
          newChecks.push(check);
        }
      }
    }
    let result = number();
    for (const check of newChecks) {
      switch (check._zod.def.check) {
        case "number_format": {
          switch (check._zod.def.format) {
            case "safeint":
              result = result.int();
              break;
          }
          break;
        }
        default:
          result = result.check(check);
      }
    }
    const description = this.mergeParameterDescription(value.description, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod date types. Converts dates to ISO strings with constraint descriptions.
   *
   * @param value - The Zod date to process
   * @returns A Zod string schema representing the date in ISO format
   */
  defaultZodDateHandler(value) {
    const constraints = [];
    const checks = value._zod.def.checks || [];
    if (checks) {
      for (const check of checks) {
        switch (check._zod.def.check) {
          case "less_than":
            const minDate = new Date(check._zod.def.value);
            if (!isNaN(minDate.getTime())) {
              constraints.push(`Date must be newer than ${minDate.toISOString()} (ISO)`);
            }
            break;
          case "greater_than":
            const maxDate = new Date(check._zod.def.value);
            if (!isNaN(maxDate.getTime())) {
              constraints.push(`Date must be older than ${maxDate.toISOString()} (ISO)`);
            }
            break;
        }
      }
    }
    constraints.push(`Date format is date-time`);
    let result = string().describe("date-time");
    const description = this.mergeParameterDescription(value.description, constraints);
    if (description) {
      result = result.describe(description);
    }
    return result;
  }
  /**
   * Default handler for Zod optional types. Processes the inner type and maintains optionality.
   *
   * @param value - The Zod optional to process
   * @param handleTypes - Types that should be processed vs passed through
   * @returns The processed Zod optional
   */
  defaultZodOptionalHandler(value, handleTypes = SUPPORTED_ZOD_TYPES2) {
    if (handleTypes.includes(value.constructor.name)) {
      return this.processZodType(value._zod.def.innerType).optional();
    } else {
      return value;
    }
  }
  /**
   * Processes a Zod object schema and converts it to an AI SDK Schema.
   *
   * @param zodSchema - The Zod object schema to process
   * @returns An AI SDK Schema with provider-specific compatibility applied
   */
  processToAISDKSchema(zodSchema) {
    const processedSchema = this.processZodType(zodSchema);
    return convertZodSchemaToAISDKSchema(processedSchema, this.getSchemaTarget());
  }
  /**
   * Processes a Zod object schema and converts it to a JSON Schema.
   *
   * @param zodSchema - The Zod object schema to process
   * @returns A JSONSchema7 object with provider-specific compatibility applied
   */
  processToJSONSchema(zodSchema) {
    return this.processToAISDKSchema(zodSchema).jsonSchema;
  }
};

// src/schema-compatibility.ts
var SchemaCompatLayer3 = class {
  model;
  v3Layer;
  v4Layer;
  /**
   * Creates a new schema compatibility instance.
   *
   * @param model - The language model this compatibility layer applies to
   */
  constructor(model) {
    this.model = model;
    this.v3Layer = new SchemaCompatLayer(model, this);
    this.v4Layer = new SchemaCompatLayer2(model, this);
  }
  /**
   * Gets the language model associated with this compatibility layer.
   *
   * @returns The language model instance
   */
  getModel() {
    return this.model;
  }
  getUnsupportedZodTypes(v) {
    if ("_zod" in v) {
      return this.v4Layer.getUnsupportedZodTypes();
    } else {
      return this.v3Layer.getUnsupportedZodTypes();
    }
  }
  isOptional(v) {
    if ("_zod" in v) {
      return this.v4Layer.isOptional(v);
    } else {
      return this.v3Layer.isOptional(v);
    }
  }
  isObj(v) {
    if ("_zod" in v) {
      return this.v4Layer.isObj(v);
    } else {
      return this.v3Layer.isObj(v);
    }
  }
  isNull(v) {
    if ("_zod" in v) {
      return this.v4Layer.isNull(v);
    } else {
      return this.v3Layer.isNull(v);
    }
  }
  isArr(v) {
    if ("_zod" in v) {
      return this.v4Layer.isArr(v);
    } else {
      return this.v3Layer.isArr(v);
    }
  }
  isUnion(v) {
    if ("_zod" in v) {
      return this.v4Layer.isUnion(v);
    } else {
      return this.v3Layer.isUnion(v);
    }
  }
  isString(v) {
    if ("_zod" in v) {
      return this.v4Layer.isString(v);
    } else {
      return this.v3Layer.isString(v);
    }
  }
  isNumber(v) {
    if ("_zod" in v) {
      return this.v4Layer.isNumber(v);
    } else {
      return this.v3Layer.isNumber(v);
    }
  }
  isDate(v) {
    if ("_zod" in v) {
      return this.v4Layer.isDate(v);
    } else {
      return this.v3Layer.isDate(v);
    }
  }
  isDefault(v) {
    if ("_zod" in v) {
      return this.v4Layer.isDefault(v);
    } else {
      return this.v3Layer.isDefault(v);
    }
  }
  defaultZodObjectHandler(value, options = { passthrough: true }) {
    if ("_zod" in value) {
      return this.v4Layer.defaultZodObjectHandler(value, options);
    } else {
      return this.v3Layer.defaultZodObjectHandler(value, options);
    }
  }
  /**
   * Merges validation constraints into a parameter description.
   *
   * This helper method converts validation constraints that may not be supported
   * by a provider into human-readable descriptions.
   *
   * @param description - The existing parameter description
   * @param constraints - The validation constraints to merge
   * @returns The updated description with constraints, or undefined if no constraints
   */
  mergeParameterDescription(description, constraints) {
    return this.v3Layer.mergeParameterDescription(description, constraints);
  }
  /**
   * Default handler for unsupported Zod types. Throws an error for specified unsupported types.
   *
   * @param value - The Zod type to check
   * @param throwOnTypes - Array of type names to throw errors for
   * @returns The original value if not in the throw list
   * @throws Error if the type is in the unsupported list
   */
  defaultUnsupportedZodTypeHandler(value, throwOnTypes) {
    if ("_zod" in value) {
      return this.v4Layer.defaultUnsupportedZodTypeHandler(
        // @ts-expect-error - fix later
        value,
        throwOnTypes ?? UNSUPPORTED_ZOD_TYPES2
      );
    } else {
      return this.v3Layer.defaultUnsupportedZodTypeHandler(
        value,
        throwOnTypes ?? UNSUPPORTED_ZOD_TYPES
      );
    }
  }
  defaultZodArrayHandler(value, handleChecks = ALL_ARRAY_CHECKS) {
    if ("_zod" in value) {
      return this.v4Layer.defaultZodArrayHandler(value, handleChecks);
    } else {
      return this.v3Layer.defaultZodArrayHandler(value, handleChecks);
    }
  }
  defaultZodUnionHandler(value) {
    if ("_zod" in value) {
      return this.v4Layer.defaultZodUnionHandler(value);
    } else {
      return this.v3Layer.defaultZodUnionHandler(value);
    }
  }
  defaultZodStringHandler(value, handleChecks = ALL_STRING_CHECKS) {
    if ("_zod" in value) {
      return this.v4Layer.defaultZodStringHandler(value);
    } else {
      return this.v3Layer.defaultZodStringHandler(value, handleChecks);
    }
  }
  defaultZodNumberHandler(value, handleChecks = ALL_NUMBER_CHECKS) {
    if ("_zod" in value) {
      return this.v4Layer.defaultZodNumberHandler(value);
    } else {
      return this.v3Layer.defaultZodNumberHandler(value, handleChecks);
    }
  }
  defaultZodDateHandler(value) {
    if ("_zod" in value) {
      return this.v4Layer.defaultZodDateHandler(value);
    } else {
      return this.v3Layer.defaultZodDateHandler(value);
    }
  }
  defaultZodOptionalHandler(value, handleTypes) {
    if ("_zod" in value) {
      return this.v4Layer.defaultZodOptionalHandler(value, handleTypes ?? SUPPORTED_ZOD_TYPES2);
    } else {
      return this.v3Layer.defaultZodOptionalHandler(value, handleTypes ?? SUPPORTED_ZOD_TYPES);
    }
  }
  /**
   * Processes a Zod object schema and converts it to an AI SDK Schema.
   *
   * @param zodSchema - The Zod object schema to process
   * @returns An AI SDK Schema with provider-specific compatibility applied
   */
  processToAISDKSchema(zodSchema) {
    const processedSchema = this.processZodType(zodSchema);
    return convertZodSchemaToAISDKSchema(processedSchema, this.getSchemaTarget());
  }
  /**
   * Processes a Zod object schema and converts it to a JSON Schema.
   *
   * @param zodSchema - The Zod object schema to process
   * @returns A JSONSchema7 object with provider-specific compatibility applied
   */
  processToJSONSchema(zodSchema) {
    return this.processToAISDKSchema(zodSchema).jsonSchema;
  }
};

// src/zodTypes.ts
function isOptional2(z10) {
  return (v) => v instanceof z10["ZodOptional"];
}
function isObj2(z10) {
  return (v) => v instanceof z10["ZodObject"];
}
function isNull(z10) {
  return (v) => v instanceof z10["ZodNull"];
}
function isArr2(z10) {
  return (v) => v instanceof z10["ZodArray"];
}
function isUnion2(z10) {
  return (v) => v instanceof z10["ZodUnion"];
}
function isString2(z10) {
  return (v) => v instanceof z10["ZodString"];
}
function isNumber2(z10) {
  return (v) => v instanceof z10["ZodNumber"];
}
function isDate(z10) {
  return (v) => v instanceof z10["ZodDate"];
}
function isDefault(z10) {
  return (v) => v instanceof z10["ZodDefault"];
}

// src/provider-compats/anthropic.ts
var AnthropicSchemaCompatLayer = class extends SchemaCompatLayer3 {
  constructor(model) {
    super(model);
  }
  getSchemaTarget() {
    return "jsonSchema7";
  }
  shouldApply() {
    return this.getModel().modelId.includes("claude");
  }
  processZodType(value) {
    if (isOptional2(z)(value)) {
      const handleTypes = [
        "ZodObject",
        "ZodArray",
        "ZodUnion",
        "ZodNever",
        "ZodUndefined",
        "ZodTuple"
      ];
      if (this.getModel().modelId.includes("claude-3.5-haiku")) handleTypes.push("ZodString");
      return this.defaultZodOptionalHandler(value, handleTypes);
    } else if (isObj2(z)(value)) {
      return this.defaultZodObjectHandler(value);
    } else if (isArr2(z)(value)) {
      return this.defaultZodArrayHandler(value, []);
    } else if (isUnion2(z)(value)) {
      return this.defaultZodUnionHandler(value);
    } else if (isString2(z)(value)) {
      if (this.getModel().modelId.includes("claude-3.5-haiku")) {
        return this.defaultZodStringHandler(value, ["max", "min"]);
      } else {
        return value;
      }
    }
    return this.defaultUnsupportedZodTypeHandler(value, [
      "ZodNever",
      "ZodTuple",
      "ZodUndefined"
    ]);
  }
};
var DeepSeekSchemaCompatLayer = class extends SchemaCompatLayer3 {
  constructor(model) {
    super(model);
  }
  getSchemaTarget() {
    return "jsonSchema7";
  }
  shouldApply() {
    return this.getModel().modelId.includes("deepseek") && !this.getModel().modelId.includes("r1");
  }
  processZodType(value) {
    if (isOptional2(z)(value)) {
      return this.defaultZodOptionalHandler(value, ["ZodObject", "ZodArray", "ZodUnion", "ZodString", "ZodNumber"]);
    } else if (isObj2(z)(value)) {
      return this.defaultZodObjectHandler(value);
    } else if (isArr2(z)(value)) {
      return this.defaultZodArrayHandler(value, ["min", "max"]);
    } else if (isUnion2(z)(value)) {
      return this.defaultZodUnionHandler(value);
    } else if (isString2(z)(value)) {
      return this.defaultZodStringHandler(value);
    }
    return value;
  }
};
var GoogleSchemaCompatLayer = class extends SchemaCompatLayer3 {
  constructor(model) {
    super(model);
  }
  getSchemaTarget() {
    return "jsonSchema7";
  }
  shouldApply() {
    return this.getModel().provider.includes("google") || this.getModel().modelId.includes("google");
  }
  processZodType(value) {
    if (isOptional2(z)(value)) {
      return this.defaultZodOptionalHandler(value, ["ZodObject", "ZodArray", "ZodUnion", "ZodString", "ZodNumber"]);
    } else if (isNull(z)(value)) {
      return anyType().refine((v) => v === null, { message: "must be null" }).describe(value.description || "must be null");
    } else if (isObj2(z)(value)) {
      return this.defaultZodObjectHandler(value);
    } else if (isArr2(z)(value)) {
      return this.defaultZodArrayHandler(value, []);
    } else if (isUnion2(z)(value)) {
      return this.defaultZodUnionHandler(value);
    } else if (isString2(z)(value)) {
      return this.defaultZodStringHandler(value);
    } else if (isNumber2(z)(value)) {
      return this.defaultZodNumberHandler(value);
    }
    return this.defaultUnsupportedZodTypeHandler(value);
  }
};
var MetaSchemaCompatLayer = class extends SchemaCompatLayer3 {
  constructor(model) {
    super(model);
  }
  getSchemaTarget() {
    return "jsonSchema7";
  }
  shouldApply() {
    return this.getModel().modelId.includes("meta");
  }
  processZodType(value) {
    if (isOptional2(z)(value)) {
      return this.defaultZodOptionalHandler(value, ["ZodObject", "ZodArray", "ZodUnion", "ZodString", "ZodNumber"]);
    } else if (isObj2(z)(value)) {
      return this.defaultZodObjectHandler(value);
    } else if (isArr2(z)(value)) {
      return this.defaultZodArrayHandler(value, ["min", "max"]);
    } else if (isUnion2(z)(value)) {
      return this.defaultZodUnionHandler(value);
    } else if (isNumber2(z)(value)) {
      return this.defaultZodNumberHandler(value);
    } else if (isString2(z)(value)) {
      return this.defaultZodStringHandler(value);
    }
    return value;
  }
};
var OpenAISchemaCompatLayer = class extends SchemaCompatLayer3 {
  constructor(model) {
    super(model);
  }
  getSchemaTarget() {
    return `jsonSchema7`;
  }
  shouldApply() {
    if (!this.getModel().supportsStructuredOutputs && (this.getModel().provider.includes(`openai`) || this.getModel().modelId.includes(`openai`))) {
      return true;
    }
    return false;
  }
  processZodType(value) {
    if (isOptional2(z)(value)) {
      return this.defaultZodOptionalHandler(value, [
        "ZodObject",
        "ZodArray",
        "ZodUnion",
        "ZodString",
        "ZodNever",
        "ZodUndefined",
        "ZodTuple"
      ]);
    } else if (isObj2(z)(value)) {
      return this.defaultZodObjectHandler(value);
    } else if (isUnion2(z)(value)) {
      return this.defaultZodUnionHandler(value);
    } else if (isArr2(z)(value)) {
      return this.defaultZodArrayHandler(value);
    } else if (isString2(z)(value)) {
      const model = this.getModel();
      const checks = ["emoji"];
      if (model.modelId.includes("gpt-4o-mini")) {
        return this.defaultZodStringHandler(value, ["emoji", "regex"]);
      }
      return this.defaultZodStringHandler(value, checks);
    }
    return this.defaultUnsupportedZodTypeHandler(value, [
      "ZodNever",
      "ZodUndefined",
      "ZodTuple"
    ]);
  }
};
var OpenAIReasoningSchemaCompatLayer = class extends SchemaCompatLayer3 {
  constructor(model) {
    super(model);
  }
  getSchemaTarget() {
    return `openApi3`;
  }
  isReasoningModel() {
    return this.getModel().modelId.includes(`o3`) || this.getModel().modelId.includes(`o4`) || this.getModel().modelId.includes(`o1`);
  }
  shouldApply() {
    if ((this.getModel().supportsStructuredOutputs || this.isReasoningModel()) && (this.getModel().provider.includes(`openai`) || this.getModel().modelId.includes(`openai`))) {
      return true;
    }
    return false;
  }
  processZodType(value) {
    if (isOptional2(z)(value)) {
      const innerZodType = this.processZodType(value._def.innerType);
      return innerZodType.nullable();
    } else if (isObj2(z)(value)) {
      return this.defaultZodObjectHandler(value, { passthrough: false });
    } else if (isArr2(z)(value)) {
      return this.defaultZodArrayHandler(value);
    } else if (isUnion2(z)(value)) {
      return this.defaultZodUnionHandler(value);
    } else if (isDefault(z)(value)) {
      const defaultDef = value._def;
      const innerType = defaultDef.innerType;
      const defaultValue = typeof defaultDef.defaultValue === "function" ? defaultDef.defaultValue() : defaultDef.defaultValue;
      const constraints = [];
      if (defaultValue !== void 0) {
        constraints.push(`the default value is ${defaultValue}`);
      }
      const description = this.mergeParameterDescription(value.description, constraints);
      let result = this.processZodType(innerType);
      if (description) {
        result = result.describe(description);
      }
      return result;
    } else if (isNumber2(z)(value)) {
      return this.defaultZodNumberHandler(value);
    } else if (isString2(z)(value)) {
      return this.defaultZodStringHandler(value);
    } else if (isDate(z)(value)) {
      return this.defaultZodDateHandler(value);
    } else if (value.constructor.name === "ZodAny") {
      return stringType().describe(
        (value.description ?? "") + `
Argument was an "any" type, but you (the LLM) do not support "any", so it was cast to a "string" type`
      );
    }
    return this.defaultUnsupportedZodTypeHandler(value);
  }
};

// src/ai-tracing/types.ts
var AISpanType = /* @__PURE__ */ ((AISpanType2) => {
  AISpanType2["AGENT_RUN"] = "agent_run";
  AISpanType2["GENERIC"] = "generic";
  AISpanType2["MODEL_GENERATION"] = "model_generation";
  AISpanType2["MODEL_STEP"] = "model_step";
  AISpanType2["MODEL_CHUNK"] = "model_chunk";
  AISpanType2["MCP_TOOL_CALL"] = "mcp_tool_call";
  AISpanType2["PROCESSOR_RUN"] = "processor_run";
  AISpanType2["TOOL_CALL"] = "tool_call";
  AISpanType2["WORKFLOW_RUN"] = "workflow_run";
  AISpanType2["WORKFLOW_STEP"] = "workflow_step";
  AISpanType2["WORKFLOW_CONDITIONAL"] = "workflow_conditional";
  AISpanType2["WORKFLOW_CONDITIONAL_EVAL"] = "workflow_conditional_eval";
  AISpanType2["WORKFLOW_PARALLEL"] = "workflow_parallel";
  AISpanType2["WORKFLOW_LOOP"] = "workflow_loop";
  AISpanType2["WORKFLOW_SLEEP"] = "workflow_sleep";
  AISpanType2["WORKFLOW_WAIT_EVENT"] = "workflow_wait_event";
  return AISpanType2;
})(AISpanType || {});

// src/ai-tracing/spans/base.ts
function isSpanInternal(spanType, flags) {
  if (flags === void 0 || flags === 0 /* NONE */) {
    return false;
  }
  switch (spanType) {
    // Workflow-related spans
    case "workflow_run" /* WORKFLOW_RUN */:
    case "workflow_step" /* WORKFLOW_STEP */:
    case "workflow_conditional" /* WORKFLOW_CONDITIONAL */:
    case "workflow_conditional_eval" /* WORKFLOW_CONDITIONAL_EVAL */:
    case "workflow_parallel" /* WORKFLOW_PARALLEL */:
    case "workflow_loop" /* WORKFLOW_LOOP */:
    case "workflow_sleep" /* WORKFLOW_SLEEP */:
    case "workflow_wait_event" /* WORKFLOW_WAIT_EVENT */:
      return (flags & 1 /* WORKFLOW */) !== 0;
    // Agent-related spans
    case "agent_run" /* AGENT_RUN */:
      return (flags & 2 /* AGENT */) !== 0;
    // Tool-related spans
    case "tool_call" /* TOOL_CALL */:
    case "mcp_tool_call" /* MCP_TOOL_CALL */:
      return (flags & 4 /* TOOL */) !== 0;
    // Model-related spans
    case "model_generation" /* MODEL_GENERATION */:
    case "model_step" /* MODEL_STEP */:
    case "model_chunk" /* MODEL_CHUNK */:
      return (flags & 8 /* MODEL */) !== 0;
    // Default: never internal
    default:
      return false;
  }
}
var BaseAISpan = class {
  name;
  type;
  attributes;
  parent;
  startTime;
  endTime;
  isEvent;
  isInternal;
  aiTracing;
  input;
  output;
  errorInfo;
  metadata;
  traceState;
  /** Parent span ID (for root spans that are children of external spans) */
  parentSpanId;
  constructor(options, aiTracing) {
    this.name = options.name;
    this.type = options.type;
    this.attributes = deepClean(options.attributes) || {};
    this.metadata = deepClean(options.metadata);
    this.parent = options.parent;
    this.startTime = /* @__PURE__ */ new Date();
    this.aiTracing = aiTracing;
    this.isEvent = options.isEvent ?? false;
    this.isInternal = isSpanInternal(this.type, options.tracingPolicy?.internal);
    this.traceState = options.traceState;
    if (this.isEvent) {
      this.output = deepClean(options.output);
    } else {
      this.input = deepClean(options.input);
    }
  }
  createChildSpan(options) {
    return this.aiTracing.startSpan({ ...options, parent: this, isEvent: false });
  }
  createEventSpan(options) {
    return this.aiTracing.startSpan({ ...options, parent: this, isEvent: true });
  }
  /** Returns `TRUE` if the span is the root span of a trace */
  get isRootSpan() {
    return !this.parent;
  }
  /** Get the closest parent spanId that isn't an internal span */
  getParentSpanId(includeInternalSpans) {
    if (!this.parent) {
      return this.parentSpanId;
    }
    if (includeInternalSpans) return this.parent.id;
    if (this.parent.isInternal) return this.parent.getParentSpanId(includeInternalSpans);
    return this.parent.id;
  }
  /** Find the closest parent span of a specific type by walking up the parent chain */
  findParent(spanType) {
    let current = this.parent;
    while (current) {
      if (current.type === spanType) {
        return current;
      }
      current = current.parent;
    }
    return void 0;
  }
  /** Returns a lightweight span ready for export */
  exportSpan(includeInternalSpans) {
    return {
      id: this.id,
      traceId: this.traceId,
      name: this.name,
      type: this.type,
      attributes: this.attributes,
      metadata: this.metadata,
      startTime: this.startTime,
      endTime: this.endTime,
      input: this.input,
      output: this.output,
      errorInfo: this.errorInfo,
      isEvent: this.isEvent,
      isRootSpan: this.isRootSpan,
      parentSpanId: this.getParentSpanId(includeInternalSpans)
    };
  }
};
var DEFAULT_KEYS_TO_STRIP = /* @__PURE__ */ new Set([
  "logger",
  "experimental_providerMetadata",
  "providerMetadata",
  "steps",
  "tracingContext"
]);
function deepClean(value, options = {}, _seen = /* @__PURE__ */ new WeakSet(), _depth = 0) {
  const { keysToStrip = DEFAULT_KEYS_TO_STRIP, maxDepth = 10 } = options;
  if (_depth > maxDepth) {
    return "[MaxDepth]";
  }
  if (value === null || typeof value !== "object") {
    try {
      JSON.stringify(value);
      return value;
    } catch (error) {
      return `[${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  if (_seen.has(value)) {
    return "[Circular]";
  }
  _seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => deepClean(item, options, _seen, _depth + 1));
  }
  const cleaned = {};
  for (const [key, val] of Object.entries(value)) {
    if (keysToStrip.has(key)) {
      continue;
    }
    try {
      cleaned[key] = deepClean(val, options, _seen, _depth + 1);
    } catch (error) {
      cleaned[key] = `[${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  return cleaned;
}

// src/ai-tracing/spans/default.ts
var DefaultAISpan = class extends BaseAISpan {
  id;
  traceId;
  constructor(options, aiTracing) {
    super(options, aiTracing);
    this.id = generateSpanId();
    if (options.parent) {
      this.traceId = options.parent.traceId;
    } else if (options.traceId) {
      if (isValidTraceId(options.traceId)) {
        this.traceId = options.traceId;
      } else {
        console.error(
          `[Mastra Tracing] Invalid traceId: must be 1-32 hexadecimal characters, got "${options.traceId}". Generating new trace ID.`
        );
        this.traceId = generateTraceId();
      }
    } else {
      this.traceId = generateTraceId();
    }
    if (!options.parent && options.parentSpanId) {
      if (isValidSpanId(options.parentSpanId)) {
        this.parentSpanId = options.parentSpanId;
      } else {
        console.error(
          `[Mastra Tracing] Invalid parentSpanId: must be 1-16 hexadecimal characters, got "${options.parentSpanId}". Ignoring parent span ID.`
        );
      }
    }
  }
  end(options) {
    if (this.isEvent) {
      return;
    }
    this.endTime = /* @__PURE__ */ new Date();
    if (options?.output !== void 0) {
      this.output = deepClean(options.output);
    }
    if (options?.attributes) {
      this.attributes = { ...this.attributes, ...deepClean(options.attributes) };
    }
    if (options?.metadata) {
      this.metadata = { ...this.metadata, ...deepClean(options.metadata) };
    }
  }
  error(options) {
    if (this.isEvent) {
      return;
    }
    const { error, endSpan = true, attributes, metadata } = options;
    this.errorInfo = error instanceof MastraError ? {
      id: error.id,
      details: error.details,
      category: error.category,
      domain: error.domain,
      message: error.message
    } : {
      message: error.message
    };
    if (attributes) {
      this.attributes = { ...this.attributes, ...deepClean(attributes) };
    }
    if (metadata) {
      this.metadata = { ...this.metadata, ...deepClean(metadata) };
    }
    if (endSpan) {
      this.end();
    } else {
      this.update({});
    }
  }
  update(options) {
    if (this.isEvent) {
      return;
    }
    if (options.input !== void 0) {
      this.input = deepClean(options.input);
    }
    if (options.output !== void 0) {
      this.output = deepClean(options.output);
    }
    if (options.attributes) {
      this.attributes = { ...this.attributes, ...deepClean(options.attributes) };
    }
    if (options.metadata) {
      this.metadata = { ...this.metadata, ...deepClean(options.metadata) };
    }
  }
  get isValid() {
    return true;
  }
  async export() {
    return JSON.stringify({
      spanId: this.id,
      traceId: this.traceId,
      startTime: this.startTime,
      endTime: this.endTime,
      attributes: this.attributes,
      metadata: this.metadata
    });
  }
};
function generateSpanId() {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 8; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function generateTraceId() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function isValidTraceId(traceId) {
  return /^[0-9a-f]{1,32}$/i.test(traceId);
}
function isValidSpanId(spanId) {
  return /^[0-9a-f]{1,16}$/i.test(spanId);
}

// src/ai-tracing/spans/no-op.ts
var NoOpAISpan = class extends BaseAISpan {
  id;
  traceId;
  constructor(options, aiTracing) {
    super(options, aiTracing);
    this.id = "no-op";
    this.traceId = "no-op-trace";
  }
  end(_options) {
  }
  error(_options) {
  }
  update(_options) {
  }
  get isValid() {
    return false;
  }
};

// src/ai-tracing/exporters/base.ts
var BaseExporter = class {
  /** Mastra logger instance */
  logger;
  /** Whether this exporter is disabled */
  isDisabled = false;
  /**
   * Initialize the base exporter with logger
   */
  constructor(config = {}) {
    const logLevel = this.resolveLogLevel(config.logLevel);
    this.logger = config.logger ?? new ConsoleLogger({ level: logLevel, name: this.constructor.name });
  }
  /**
   * Set the logger for the exporter (called by Mastra/AITracing during initialization)
   */
  __setLogger(logger) {
    this.logger = logger;
    this.logger.debug(`Logger updated for exporter [name=${this.name}]`);
  }
  /**
   * Convert string log level to LogLevel enum
   */
  resolveLogLevel(logLevel) {
    if (!logLevel) {
      return LogLevel.INFO;
    }
    if (typeof logLevel === "number") {
      return logLevel;
    }
    const logLevelMap = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR
    };
    return logLevelMap[logLevel] ?? LogLevel.INFO;
  }
  /**
   * Mark the exporter as disabled and log a message
   *
   * @param reason - Reason why the exporter is disabled
   */
  setDisabled(reason) {
    this.isDisabled = true;
    this.logger.warn(`${this.name} disabled: ${reason}`);
  }
  /**
   * Export a tracing event
   *
   * This method checks if the exporter is disabled before calling _exportEvent.
   * Subclasses should implement _exportEvent instead of overriding this method.
   */
  async exportEvent(event) {
    if (this.isDisabled) {
      return;
    }
    await this._exportEvent(event);
  }
  /**
   * Shutdown the exporter and clean up resources
   *
   * Default implementation just logs. Override to add custom cleanup.
   */
  async shutdown() {
    this.logger.info(`${this.name} shutdown complete`);
  }
};
var CoreToolBuilder = class extends MastraBase {
  originalTool;
  options;
  logType;
  constructor(input) {
    super({ name: "CoreToolBuilder" });
    this.originalTool = input.originalTool;
    this.options = input.options;
    this.logType = input.logType;
  }
  // Helper to get parameters based on tool type
  getParameters = () => {
    if (isVercelTool(this.originalTool)) {
      let schema2 = this.originalTool.parameters ?? ("inputSchema" in this.originalTool ? this.originalTool.inputSchema : void 0) ?? objectType({});
      if (typeof schema2 === "function") {
        schema2 = schema2();
      }
      return schema2;
    }
    let schema = this.originalTool.inputSchema ?? objectType({});
    if (typeof schema === "function") {
      schema = schema();
    }
    return schema;
  };
  getOutputSchema = () => {
    if ("outputSchema" in this.originalTool) {
      let schema = this.originalTool.outputSchema;
      if (typeof schema === "function") {
        schema = schema();
      }
      return schema;
    }
    return null;
  };
  // For provider-defined tools, we need to include all required properties
  buildProviderTool(tool) {
    if ("type" in tool && tool.type === "provider-defined" && "id" in tool && typeof tool.id === "string" && tool.id.includes(".")) {
      const parameters = this.getParameters();
      const outputSchema = this.getOutputSchema();
      return {
        type: "provider-defined",
        id: tool.id,
        args: "args" in this.originalTool ? this.originalTool.args : {},
        description: tool.description,
        parameters: parameters.jsonSchema ? parameters : convertZodSchemaToAISDKSchema(parameters),
        ...outputSchema ? { outputSchema: outputSchema.jsonSchema ? outputSchema : convertZodSchemaToAISDKSchema(outputSchema) } : {},
        execute: this.originalTool.execute ? this.createExecute(
          this.originalTool,
          { ...this.options, description: this.originalTool.description },
          this.logType
        ) : void 0
      };
    }
    return void 0;
  }
  createLogMessageOptions({ agentName, toolName, type }) {
    if (!agentName) {
      return {
        start: `Executing tool ${toolName}`,
        error: `Failed tool execution`
      };
    }
    const prefix = `[Agent:${agentName}]`;
    const toolType = type === "toolset" ? "toolset" : "tool";
    return {
      start: `${prefix} - Executing ${toolType} ${toolName}`,
      error: `${prefix} - Failed ${toolType} execution`
    };
  }
  createExecute(tool, options, logType, processedSchema) {
    const { logger, mastra: _mastra, memory: _memory, runtimeContext, model, ...rest } = options;
    const logModelObject = {
      modelId: model?.modelId,
      provider: model?.provider,
      specificationVersion: model?.specificationVersion
    };
    const { start, error } = this.createLogMessageOptions({
      agentName: options.agentName,
      toolName: options.name,
      type: logType
    });
    const execFunction = async (args, execOptions) => {
      const tracingContext = execOptions.tracingContext || options.tracingContext;
      const toolSpan = tracingContext?.currentSpan?.createChildSpan({
        type: "tool_call" /* TOOL_CALL */,
        name: `tool: '${options.name}'`,
        input: args,
        attributes: {
          toolId: options.name,
          toolDescription: options.description,
          toolType: logType || "tool"
        },
        tracingPolicy: options.tracingPolicy
      });
      try {
        let result;
        if (isVercelTool(tool)) {
          result = await tool?.execute?.(args, execOptions);
        } else {
          const wrappedMastra = options.mastra ? wrapMastra(options.mastra, { currentSpan: toolSpan }) : options.mastra;
          result = await tool?.execute?.(
            {
              context: args,
              threadId: options.threadId,
              resourceId: options.resourceId,
              mastra: wrappedMastra,
              memory: options.memory,
              runId: options.runId,
              runtimeContext: options.runtimeContext ?? new RuntimeContext(),
              writer: new ToolStream(
                {
                  prefix: "tool",
                  callId: execOptions.toolCallId,
                  name: options.name,
                  runId: options.runId
                },
                options.writableStream || execOptions.writableStream
              ),
              tracingContext: { currentSpan: toolSpan }
            },
            execOptions
          );
        }
        toolSpan?.end({ output: result });
        return result ?? void 0;
      } catch (error2) {
        toolSpan?.error({ error: error2 });
        throw error2;
      }
    };
    return async (args, execOptions) => {
      let logger2 = options.logger || this.logger;
      try {
        logger2.debug(start, { ...rest, model: logModelObject, args });
        const parameters = processedSchema || this.getParameters();
        const { data, error: error2 } = validateToolInput(parameters, args, options.name);
        if (error2) {
          logger2.warn(`Tool input validation failed for '${options.name}'`, {
            toolName: options.name,
            errors: error2.validationErrors,
            args
          });
          return error2;
        }
        args = data;
        return await new Promise((resolve, reject) => {
          setImmediate(async () => {
            try {
              const result = await execFunction(args, execOptions);
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      } catch (err) {
        const mastraError = new MastraError(
          {
            id: "TOOL_EXECUTION_FAILED",
            domain: "TOOL" /* TOOL */,
            category: "USER" /* USER */,
            details: {
              errorMessage: String(error),
              argsJson: JSON.stringify(args),
              model: model?.modelId ?? ""
            }
          },
          err
        );
        logger2.trackException(mastraError);
        logger2.error(error, { ...rest, model: logModelObject, error: mastraError, args });
        return mastraError;
      }
    };
  }
  buildV5() {
    const builtTool = this.build();
    if (!builtTool.parameters) {
      throw new Error("Tool parameters are required");
    }
    const base = {
      ...builtTool,
      inputSchema: builtTool.parameters,
      onInputStart: "onInputStart" in this.originalTool ? this.originalTool.onInputStart : void 0,
      onInputDelta: "onInputDelta" in this.originalTool ? this.originalTool.onInputDelta : void 0,
      onInputAvailable: "onInputAvailable" in this.originalTool ? this.originalTool.onInputAvailable : void 0
    };
    if (builtTool.type === "provider-defined") {
      const { execute, parameters, ...rest } = base;
      const name = builtTool.id.split(".")[1] || builtTool.id;
      return {
        ...rest,
        type: builtTool.type,
        id: builtTool.id,
        name,
        args: builtTool.args
      };
    }
    return base;
  }
  build() {
    const providerTool = this.buildProviderTool(this.originalTool);
    if (providerTool) {
      return providerTool;
    }
    const model = this.options.model;
    const schemaCompatLayers = [];
    if (model) {
      const supportsStructuredOutputs = model.specificationVersion !== "v2" ? model.supportsStructuredOutputs ?? false : false;
      const modelInfo = {
        modelId: model.modelId,
        supportsStructuredOutputs,
        provider: model.provider
      };
      schemaCompatLayers.push(
        new OpenAIReasoningSchemaCompatLayer(modelInfo),
        new OpenAISchemaCompatLayer(modelInfo),
        new GoogleSchemaCompatLayer(modelInfo),
        new AnthropicSchemaCompatLayer(modelInfo),
        new DeepSeekSchemaCompatLayer(modelInfo),
        new MetaSchemaCompatLayer(modelInfo)
      );
    }
    let processedZodSchema;
    let processedSchema;
    const originalSchema = this.getParameters();
    const applicableLayer = schemaCompatLayers.find((layer) => layer.shouldApply());
    if (applicableLayer && originalSchema) {
      processedZodSchema = applicableLayer.processZodType(originalSchema);
      processedSchema = applyCompatLayer({
        schema: originalSchema,
        compatLayers: schemaCompatLayers,
        mode: "aiSdkSchema"
      });
    } else {
      processedZodSchema = originalSchema;
      processedSchema = applyCompatLayer({
        schema: originalSchema,
        compatLayers: schemaCompatLayers,
        mode: "aiSdkSchema"
      });
    }
    let processedOutputSchema;
    if (this.getOutputSchema()) {
      processedOutputSchema = applyCompatLayer({
        schema: this.getOutputSchema(),
        compatLayers: schemaCompatLayers,
        mode: "aiSdkSchema"
      });
    }
    const definition = {
      type: "function",
      description: this.originalTool.description,
      parameters: this.getParameters(),
      outputSchema: this.getOutputSchema(),
      requireApproval: this.options.requireApproval,
      execute: this.originalTool.execute ? this.createExecute(
        this.originalTool,
        { ...this.options, description: this.originalTool.description },
        this.logType,
        processedZodSchema
        // Pass the processed Zod schema for validation
      ) : void 0
    };
    return {
      ...definition,
      id: "id" in this.originalTool ? this.originalTool.id : void 0,
      parameters: processedSchema,
      outputSchema: processedOutputSchema
    };
  }
};

// src/utils.ts
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function deepMerge(target, source) {
  const output = { ...target };
  if (!source) return output;
  Object.keys(source).forEach((key) => {
    const targetValue = output[key];
    const sourceValue = source[key];
    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      output[key] = sourceValue;
    } else if (sourceValue instanceof Object && targetValue instanceof Object && !Array.isArray(sourceValue) && !Array.isArray(targetValue)) {
      output[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== void 0) {
      output[key] = sourceValue;
    }
  });
  return output;
}
function generateEmptyFromSchema(schema) {
  try {
    const parsedSchema = JSON.parse(schema);
    if (!parsedSchema || parsedSchema.type !== "object" || !parsedSchema.properties) return {};
    const obj = {};
    const TYPE_DEFAULTS = {
      string: "",
      array: [],
      object: {},
      number: 0,
      integer: 0,
      boolean: false
    };
    for (const [key, prop] of Object.entries(parsedSchema.properties)) {
      obj[key] = TYPE_DEFAULTS[prop.type] ?? null;
    }
    return obj;
  } catch {
    return {};
  }
}
function resolveSerializedZodOutput(schema) {
  return Function("z", `"use strict";return (${schema});`)(z);
}
function isZodType(value) {
  return typeof value === "object" && value !== null && "_def" in value && "parse" in value && typeof value.parse === "function" && "safeParse" in value && typeof value.safeParse === "function";
}
function createDeterministicId(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}
function setVercelToolProperties(tool) {
  const inputSchema = "inputSchema" in tool ? tool.inputSchema : convertVercelToolParameters(tool);
  const toolId = !("id" in tool) ? tool.description ? `tool-${createDeterministicId(tool.description)}` : `tool-${Math.random().toString(36).substring(2, 9)}` : tool.id;
  return {
    ...tool,
    id: toolId,
    inputSchema
  };
}
function ensureToolProperties(tools) {
  const toolsWithProperties = Object.keys(tools).reduce((acc, key) => {
    const tool = tools?.[key];
    if (tool) {
      if (isVercelTool(tool)) {
        acc[key] = setVercelToolProperties(tool);
      } else {
        acc[key] = tool;
      }
    }
    return acc;
  }, {});
  return toolsWithProperties;
}
function convertVercelToolParameters(tool) {
  let schema = tool.parameters ?? objectType({});
  if (typeof schema === "function") {
    schema = schema();
  }
  return isZodType(schema) ? schema : resolveSerializedZodOutput(jsonSchemaToZod(schema));
}
function makeCoreTool(originalTool, options, logType) {
  return new CoreToolBuilder({ originalTool, options, logType }).build();
}
function createMastraProxy({ mastra, logger }) {
  return new Proxy(mastra, {
    get(target, prop) {
      const hasProp = Reflect.has(target, prop);
      if (hasProp) {
        const value = Reflect.get(target, prop);
        const isFunction = typeof value === "function";
        if (isFunction) {
          return value.bind(target);
        }
        return value;
      }
      if (prop === "logger") {
        logger.warn(`Please use 'getLogger' instead, logger is deprecated`);
        return Reflect.apply(target.getLogger, target, []);
      }
      if (prop === "telemetry") {
        logger.warn(`Please use 'getTelemetry' instead, telemetry is deprecated`);
        return Reflect.apply(target.getTelemetry, target, []);
      }
      if (prop === "storage") {
        logger.warn(`Please use 'getStorage' instead, storage is deprecated`);
        return Reflect.get(target, "storage");
      }
      if (prop === "agents") {
        logger.warn(`Please use 'getAgents' instead, agents is deprecated`);
        return Reflect.apply(target.getAgents, target, []);
      }
      if (prop === "tts") {
        logger.warn(`Please use 'getTTS' instead, tts is deprecated`);
        return Reflect.apply(target.getTTS, target, []);
      }
      if (prop === "vectors") {
        logger.warn(`Please use 'getVectors' instead, vectors is deprecated`);
        return Reflect.apply(target.getVectors, target, []);
      }
      if (prop === "memory") {
        logger.warn(`Please use 'getMemory' instead, memory is deprecated`);
        return Reflect.get(target, "memory");
      }
      return Reflect.get(target, prop);
    }
  });
}
function checkEvalStorageFields(traceObject, logger) {
  const missingFields = [];
  if (!traceObject.input) missingFields.push("input");
  if (!traceObject.output) missingFields.push("output");
  if (!traceObject.agentName) missingFields.push("agent_name");
  if (!traceObject.metricName) missingFields.push("metric_name");
  if (!traceObject.instructions) missingFields.push("instructions");
  if (!traceObject.globalRunId) missingFields.push("global_run_id");
  if (!traceObject.runId) missingFields.push("run_id");
  if (missingFields.length > 0) {
    if (logger) {
      logger.warn("Skipping evaluation storage due to missing required fields", {
        missingFields,
        runId: traceObject.runId,
        agentName: traceObject.agentName
      });
    } else {
      console.warn("Skipping evaluation storage due to missing required fields", {
        missingFields,
        runId: traceObject.runId,
        agentName: traceObject.agentName
      });
    }
    return false;
  }
  return true;
}
var SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function parseSqlIdentifier(name, kind = "identifier") {
  if (!SQL_IDENTIFIER_PATTERN.test(name) || name.length > 63) {
    throw new Error(
      `Invalid ${kind}: ${name}. Must start with a letter or underscore, contain only letters, numbers, or underscores, and be at most 63 characters long.`
    );
  }
  return name;
}
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let retryCount = 0;
  let lastError = null;
  while (retryCount < maxRetries) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`Request failed with status: ${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      retryCount++;
      if (retryCount >= maxRetries) {
        break;
      }
      const delay2 = Math.min(1e3 * Math.pow(2, retryCount) * 1e3, 1e4);
      await new Promise((resolve) => setTimeout(resolve, delay2));
    }
  }
  throw lastError || new Error("Request failed after multiple retry attempts");
}

// src/ai-tracing/exporters/cloud.ts
var CloudExporter = class extends BaseExporter {
  name = "mastra-cloud-ai-tracing-exporter";
  config;
  buffer;
  flushTimer = null;
  constructor(config = {}) {
    super(config);
    const accessToken = config.accessToken ?? process.env.MASTRA_CLOUD_ACCESS_TOKEN;
    if (!accessToken) {
      this.setDisabled(
        "MASTRA_CLOUD_ACCESS_TOKEN environment variable not set. \u{1F680} Sign up for Mastra Cloud at https://cloud.mastra.ai to see your AI traces online and obtain your access token."
      );
    }
    const endpoint = config.endpoint ?? process.env.MASTRA_CLOUD_AI_TRACES_ENDPOINT ?? "https://api.mastra.ai/ai/spans/publish";
    this.config = {
      logger: this.logger,
      logLevel: config.logLevel ?? LogLevel.INFO,
      maxBatchSize: config.maxBatchSize ?? 1e3,
      maxBatchWaitMs: config.maxBatchWaitMs ?? 5e3,
      maxRetries: config.maxRetries ?? 3,
      accessToken: accessToken || "",
      endpoint
    };
    this.buffer = {
      spans: [],
      totalSize: 0
    };
  }
  async _exportEvent(event) {
    if (event.type !== "span_ended" /* SPAN_ENDED */) {
      return;
    }
    this.addToBuffer(event);
    if (this.shouldFlush()) {
      this.flush().catch((error) => {
        this.logger.error("Batch flush failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    } else if (this.buffer.totalSize === 1) {
      this.scheduleFlush();
    }
  }
  addToBuffer(event) {
    if (this.buffer.totalSize === 0) {
      this.buffer.firstEventTime = /* @__PURE__ */ new Date();
    }
    const spanRecord = this.formatSpan(event.exportedSpan);
    this.buffer.spans.push(spanRecord);
    this.buffer.totalSize++;
  }
  formatSpan(span) {
    const spanRecord = {
      traceId: span.traceId,
      spanId: span.id,
      parentSpanId: span.parentSpanId ?? null,
      name: span.name,
      spanType: span.type,
      attributes: span.attributes ?? null,
      metadata: span.metadata ?? null,
      startedAt: span.startTime,
      endedAt: span.endTime ?? null,
      input: span.input ?? null,
      output: span.output ?? null,
      error: span.errorInfo,
      isEvent: span.isEvent,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: null
    };
    return spanRecord;
  }
  shouldFlush() {
    if (this.buffer.totalSize >= this.config.maxBatchSize) {
      return true;
    }
    if (this.buffer.firstEventTime && this.buffer.totalSize > 0) {
      const elapsed = Date.now() - this.buffer.firstEventTime.getTime();
      if (elapsed >= this.config.maxBatchWaitMs) {
        return true;
      }
    }
    return false;
  }
  scheduleFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flush().catch((error) => {
        const mastraError = new MastraError(
          {
            id: `CLOUD_AI_TRACING_FAILED_TO_SCHEDULE_FLUSH`,
            domain: "MASTRA_OBSERVABILITY" /* MASTRA_OBSERVABILITY */,
            category: "USER" /* USER */
          },
          error
        );
        this.logger.trackException(mastraError);
        this.logger.error("Scheduled flush failed", mastraError);
      });
    }, this.config.maxBatchWaitMs);
  }
  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.totalSize === 0) {
      return;
    }
    const startTime = Date.now();
    const spansCopy = [...this.buffer.spans];
    const flushReason = this.buffer.totalSize >= this.config.maxBatchSize ? "size" : "time";
    this.resetBuffer();
    try {
      await this.batchUpload(spansCopy);
      const elapsed = Date.now() - startTime;
      this.logger.debug("Batch flushed successfully", {
        batchSize: spansCopy.length,
        flushReason,
        durationMs: elapsed
      });
    } catch (error) {
      const mastraError = new MastraError(
        {
          id: `CLOUD_AI_TRACING_FAILED_TO_BATCH_UPLOAD`,
          domain: "MASTRA_OBSERVABILITY" /* MASTRA_OBSERVABILITY */,
          category: "USER" /* USER */,
          details: {
            droppedBatchSize: spansCopy.length
          }
        },
        error
      );
      this.logger.trackException(mastraError);
      this.logger.error("Batch upload failed after all retries, dropping batch", mastraError);
    }
  }
  /**
   * Uploads spans to cloud API using fetchWithRetry for all retry logic
   */
  async batchUpload(spans) {
    const headers = {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json"
    };
    const options = {
      method: "POST",
      headers,
      body: JSON.stringify({ spans })
    };
    await fetchWithRetry(this.config.endpoint, options, this.config.maxRetries);
  }
  resetBuffer() {
    this.buffer.spans = [];
    this.buffer.firstEventTime = void 0;
    this.buffer.totalSize = 0;
  }
  async shutdown() {
    if (this.isDisabled) {
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.totalSize > 0) {
      this.logger.info("Flushing remaining events on shutdown", {
        remainingEvents: this.buffer.totalSize
      });
      try {
        await this.flush();
      } catch (error) {
        const mastraError = new MastraError(
          {
            id: `CLOUD_AI_TRACING_FAILED_TO_FLUSH_REMAINING_EVENTS_DURING_SHUTDOWN`,
            domain: "MASTRA_OBSERVABILITY" /* MASTRA_OBSERVABILITY */,
            category: "USER" /* USER */,
            details: {
              remainingEvents: this.buffer.totalSize
            }
          },
          error
        );
        this.logger.trackException(mastraError);
        this.logger.error("Failed to flush remaining events during shutdown", mastraError);
      }
    }
    this.logger.info("CloudExporter shutdown complete");
  }
};

// src/ai-tracing/exporters/default.ts
function resolveStrategy(userConfig, storage, logger) {
  if (userConfig.strategy && userConfig.strategy !== "auto") {
    const hints = storage.aiTracingStrategy;
    if (hints.supported.includes(userConfig.strategy)) {
      return userConfig.strategy;
    }
    logger.warn("User-specified AI tracing strategy not supported by storage adapter, falling back to auto-selection", {
      userStrategy: userConfig.strategy,
      storageAdapter: storage.constructor.name,
      supportedStrategies: hints.supported,
      fallbackStrategy: hints.preferred
    });
  }
  return storage.aiTracingStrategy.preferred;
}
var DefaultExporter = class {
  name = "tracing-default-exporter";
  logger;
  mastra = null;
  config;
  resolvedStrategy;
  buffer;
  flushTimer = null;
  // Track all spans that have been created, persists across flushes
  allCreatedSpans = /* @__PURE__ */ new Set();
  constructor(config = {}, logger) {
    if (logger) {
      this.logger = logger;
    } else {
      this.logger = new ConsoleLogger({ level: LogLevel.INFO });
    }
    this.config = {
      maxBatchSize: config.maxBatchSize ?? 1e3,
      maxBufferSize: config.maxBufferSize ?? 1e4,
      maxBatchWaitMs: config.maxBatchWaitMs ?? 5e3,
      maxRetries: config.maxRetries ?? 4,
      retryDelayMs: config.retryDelayMs ?? 500,
      strategy: config.strategy ?? "auto"
    };
    this.buffer = {
      creates: [],
      updates: [],
      insertOnly: [],
      seenSpans: /* @__PURE__ */ new Set(),
      spanSequences: /* @__PURE__ */ new Map(),
      completedSpans: /* @__PURE__ */ new Set(),
      outOfOrderCount: 0,
      totalSize: 0
    };
    this.resolvedStrategy = "batch-with-updates";
  }
  strategyInitialized = false;
  /**
   * Register the Mastra instance (called after Mastra construction is complete)
   */
  __registerMastra(mastra) {
    this.mastra = mastra;
  }
  /**
   * Initialize the exporter (called after all dependencies are ready)
   */
  init(_config) {
    if (!this.mastra) {
      throw new Error("DefaultExporter: init() called before __registerMastra()");
    }
    const storage = this.mastra.getStorage();
    if (!storage) {
      this.logger.warn("DefaultExporter disabled: Storage not available. Traces will not be persisted.");
      return;
    }
    this.initializeStrategy(storage);
  }
  /**
   * Initialize the resolved strategy once storage is available
   */
  initializeStrategy(storage) {
    if (this.strategyInitialized) return;
    this.resolvedStrategy = resolveStrategy(this.config, storage, this.logger);
    this.strategyInitialized = true;
    this.logger.debug("AI tracing exporter initialized", {
      strategy: this.resolvedStrategy,
      source: this.config.strategy !== "auto" ? "user" : "auto",
      storageAdapter: storage.constructor.name,
      maxBatchSize: this.config.maxBatchSize,
      maxBatchWaitMs: this.config.maxBatchWaitMs
    });
  }
  /**
   * Builds a unique span key for tracking
   */
  buildSpanKey(traceId, spanId) {
    return `${traceId}:${spanId}`;
  }
  /**
   * Gets the next sequence number for a span
   */
  getNextSequence(spanKey) {
    const current = this.buffer.spanSequences.get(spanKey) || 0;
    const next = current + 1;
    this.buffer.spanSequences.set(spanKey, next);
    return next;
  }
  /**
   * Handles out-of-order span updates by logging and skipping
   */
  handleOutOfOrderUpdate(event) {
    this.logger.warn("Out-of-order span update detected - skipping event", {
      spanId: event.exportedSpan.id,
      traceId: event.exportedSpan.traceId,
      spanName: event.exportedSpan.name,
      eventType: event.type
    });
  }
  /**
   * Adds an event to the appropriate buffer based on strategy
   */
  addToBuffer(event) {
    const spanKey = this.buildSpanKey(event.exportedSpan.traceId, event.exportedSpan.id);
    if (this.buffer.totalSize === 0) {
      this.buffer.firstEventTime = /* @__PURE__ */ new Date();
    }
    switch (event.type) {
      case "span_started" /* SPAN_STARTED */:
        if (this.resolvedStrategy === "batch-with-updates") {
          const createRecord = this.buildCreateRecord(event.exportedSpan);
          this.buffer.creates.push(createRecord);
          this.buffer.seenSpans.add(spanKey);
          this.allCreatedSpans.add(spanKey);
        }
        break;
      case "span_updated" /* SPAN_UPDATED */:
        if (this.resolvedStrategy === "batch-with-updates") {
          if (this.allCreatedSpans.has(spanKey)) {
            this.buffer.updates.push({
              traceId: event.exportedSpan.traceId,
              spanId: event.exportedSpan.id,
              updates: this.buildUpdateRecord(event.exportedSpan),
              sequenceNumber: this.getNextSequence(spanKey)
            });
          } else {
            this.handleOutOfOrderUpdate(event);
            this.buffer.outOfOrderCount++;
          }
        }
        break;
      case "span_ended" /* SPAN_ENDED */:
        if (this.resolvedStrategy === "batch-with-updates") {
          if (this.allCreatedSpans.has(spanKey)) {
            this.buffer.updates.push({
              traceId: event.exportedSpan.traceId,
              spanId: event.exportedSpan.id,
              updates: this.buildUpdateRecord(event.exportedSpan),
              sequenceNumber: this.getNextSequence(spanKey)
            });
            this.buffer.completedSpans.add(spanKey);
          } else if (event.exportedSpan.isEvent) {
            const createRecord = this.buildCreateRecord(event.exportedSpan);
            this.buffer.creates.push(createRecord);
            this.buffer.seenSpans.add(spanKey);
            this.allCreatedSpans.add(spanKey);
            this.buffer.completedSpans.add(spanKey);
          } else {
            this.handleOutOfOrderUpdate(event);
            this.buffer.outOfOrderCount++;
          }
        } else if (this.resolvedStrategy === "insert-only") {
          const createRecord = this.buildCreateRecord(event.exportedSpan);
          this.buffer.insertOnly.push(createRecord);
          this.buffer.completedSpans.add(spanKey);
          this.allCreatedSpans.add(spanKey);
        }
        break;
    }
    this.buffer.totalSize = this.buffer.creates.length + this.buffer.updates.length + this.buffer.insertOnly.length;
  }
  /**
   * Checks if buffer should be flushed based on size or time triggers
   */
  shouldFlush() {
    if (this.buffer.totalSize >= this.config.maxBufferSize) {
      return true;
    }
    if (this.buffer.totalSize >= this.config.maxBatchSize) {
      return true;
    }
    if (this.buffer.firstEventTime && this.buffer.totalSize > 0) {
      const elapsed = Date.now() - this.buffer.firstEventTime.getTime();
      if (elapsed >= this.config.maxBatchWaitMs) {
        return true;
      }
    }
    return false;
  }
  /**
   * Resets the buffer after successful flush
   */
  resetBuffer(completedSpansToCleanup = /* @__PURE__ */ new Set()) {
    this.buffer.creates = [];
    this.buffer.updates = [];
    this.buffer.insertOnly = [];
    this.buffer.seenSpans.clear();
    this.buffer.spanSequences.clear();
    this.buffer.completedSpans.clear();
    this.buffer.outOfOrderCount = 0;
    this.buffer.firstEventTime = void 0;
    this.buffer.totalSize = 0;
    for (const spanKey of completedSpansToCleanup) {
      this.allCreatedSpans.delete(spanKey);
    }
  }
  /**
   * Schedules a flush using setTimeout
   */
  scheduleFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flush().catch((error) => {
        this.logger.error("Scheduled flush failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.config.maxBatchWaitMs);
  }
  /**
   * Serializes span attributes to storage record format
   * Handles all AI span types and their specific attributes
   */
  serializeAttributes(span) {
    if (!span.attributes) {
      return null;
    }
    try {
      return JSON.parse(
        JSON.stringify(span.attributes, (_key, value) => {
          if (value instanceof Date) {
            return value.toISOString();
          }
          if (typeof value === "object" && value !== null) {
            return value;
          }
          return value;
        })
      );
    } catch (error) {
      this.logger.warn("Failed to serialize span attributes, storing as null", {
        spanId: span.id,
        spanType: span.type,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
  buildCreateRecord(span) {
    return {
      traceId: span.traceId,
      spanId: span.id,
      parentSpanId: span.parentSpanId ?? null,
      name: span.name,
      scope: null,
      spanType: span.type,
      attributes: this.serializeAttributes(span),
      metadata: span.metadata ?? null,
      links: null,
      startedAt: span.startTime,
      endedAt: span.endTime ?? null,
      input: span.input,
      output: span.output,
      error: span.errorInfo,
      isEvent: span.isEvent
    };
  }
  buildUpdateRecord(span) {
    return {
      name: span.name,
      scope: null,
      attributes: this.serializeAttributes(span),
      metadata: span.metadata ?? null,
      links: null,
      endedAt: span.endTime ?? null,
      input: span.input,
      output: span.output,
      error: span.errorInfo
    };
  }
  /**
   * Handles realtime strategy - processes each event immediately
   */
  async handleRealtimeEvent(event, storage) {
    const span = event.exportedSpan;
    const spanKey = this.buildSpanKey(span.traceId, span.id);
    if (span.isEvent) {
      if (event.type === "span_ended" /* SPAN_ENDED */) {
        await storage.createAISpan(this.buildCreateRecord(event.exportedSpan));
      } else {
        this.logger.warn(`Tracing event type not implemented for event spans: ${event.type}`);
      }
    } else {
      switch (event.type) {
        case "span_started" /* SPAN_STARTED */:
          await storage.createAISpan(this.buildCreateRecord(event.exportedSpan));
          this.allCreatedSpans.add(spanKey);
          break;
        case "span_updated" /* SPAN_UPDATED */:
          await storage.updateAISpan({
            traceId: span.traceId,
            spanId: span.id,
            updates: this.buildUpdateRecord(span)
          });
          break;
        case "span_ended" /* SPAN_ENDED */:
          await storage.updateAISpan({
            traceId: span.traceId,
            spanId: span.id,
            updates: this.buildUpdateRecord(span)
          });
          this.allCreatedSpans.delete(spanKey);
          break;
        default:
          this.logger.warn(`Tracing event type not implemented for span spans: ${event.type}`);
      }
    }
  }
  /**
   * Handles batch-with-updates strategy - buffers events and processes in batches
   */
  handleBatchWithUpdatesEvent(event) {
    this.addToBuffer(event);
    if (this.shouldFlush()) {
      this.flush().catch((error) => {
        this.logger.error("Batch flush failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    } else if (this.buffer.totalSize === 1) {
      this.scheduleFlush();
    }
  }
  /**
   * Handles insert-only strategy - only processes SPAN_ENDED events in batches
   */
  handleInsertOnlyEvent(event) {
    if (event.type === "span_ended" /* SPAN_ENDED */) {
      this.addToBuffer(event);
      if (this.shouldFlush()) {
        this.flush().catch((error) => {
          this.logger.error("Batch flush failed", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      } else if (this.buffer.totalSize === 1) {
        this.scheduleFlush();
      }
    }
  }
  /**
   * Calculates retry delay using exponential backoff
   */
  calculateRetryDelay(attempt) {
    return this.config.retryDelayMs * Math.pow(2, attempt);
  }
  /**
   * Flushes the current buffer to storage with retry logic
   */
  async flush() {
    if (!this.mastra) {
      this.logger.debug("Cannot flush traces. Mastra instance not registered yet.");
      return;
    }
    const storage = this.mastra.getStorage();
    if (!storage) {
      this.logger.debug("Cannot flush traces. Mastra storage is not initialized");
      return;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.totalSize === 0) {
      return;
    }
    const startTime = Date.now();
    const flushReason = this.buffer.totalSize >= this.config.maxBufferSize ? "overflow" : this.buffer.totalSize >= this.config.maxBatchSize ? "size" : "time";
    const bufferCopy = {
      creates: [...this.buffer.creates],
      updates: [...this.buffer.updates],
      insertOnly: [...this.buffer.insertOnly],
      seenSpans: new Set(this.buffer.seenSpans),
      spanSequences: new Map(this.buffer.spanSequences),
      completedSpans: new Set(this.buffer.completedSpans),
      outOfOrderCount: this.buffer.outOfOrderCount,
      firstEventTime: this.buffer.firstEventTime,
      totalSize: this.buffer.totalSize
    };
    this.resetBuffer();
    await this.flushWithRetries(storage, bufferCopy, 0);
    const elapsed = Date.now() - startTime;
    this.logger.debug("Batch flushed", {
      strategy: this.resolvedStrategy,
      batchSize: bufferCopy.totalSize,
      flushReason,
      durationMs: elapsed,
      outOfOrderCount: bufferCopy.outOfOrderCount > 0 ? bufferCopy.outOfOrderCount : void 0
    });
  }
  /**
   * Attempts to flush with exponential backoff retry logic
   */
  async flushWithRetries(storage, buffer, attempt) {
    try {
      if (this.resolvedStrategy === "batch-with-updates") {
        if (buffer.creates.length > 0) {
          await storage.batchCreateAISpans({ records: buffer.creates });
        }
        if (buffer.updates.length > 0) {
          const sortedUpdates = buffer.updates.sort((a, b) => {
            const spanCompare = this.buildSpanKey(a.traceId, a.spanId).localeCompare(
              this.buildSpanKey(b.traceId, b.spanId)
            );
            if (spanCompare !== 0) return spanCompare;
            return a.sequenceNumber - b.sequenceNumber;
          });
          await storage.batchUpdateAISpans({ records: sortedUpdates });
        }
      } else if (this.resolvedStrategy === "insert-only") {
        if (buffer.insertOnly.length > 0) {
          await storage.batchCreateAISpans({ records: buffer.insertOnly });
        }
      }
      for (const spanKey of buffer.completedSpans) {
        this.allCreatedSpans.delete(spanKey);
      }
    } catch (error) {
      if (attempt < this.config.maxRetries) {
        const retryDelay = this.calculateRetryDelay(attempt);
        this.logger.warn("Batch flush failed, retrying", {
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          nextRetryInMs: retryDelay,
          error: error instanceof Error ? error.message : String(error)
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        return this.flushWithRetries(storage, buffer, attempt + 1);
      } else {
        this.logger.error("Batch flush failed after all retries, dropping batch", {
          finalAttempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          droppedBatchSize: buffer.totalSize,
          error: error instanceof Error ? error.message : String(error)
        });
        for (const spanKey of buffer.completedSpans) {
          this.allCreatedSpans.delete(spanKey);
        }
      }
    }
  }
  async exportEvent(event) {
    if (!this.mastra) {
      this.logger.debug("Cannot export AI tracing event. Mastra instance not registered yet.");
      return;
    }
    const storage = this.mastra.getStorage();
    if (!storage) {
      this.logger.debug("Cannot store traces. Mastra storage is not initialized");
      return;
    }
    if (!this.strategyInitialized) {
      this.initializeStrategy(storage);
    }
    switch (this.resolvedStrategy) {
      case "realtime":
        await this.handleRealtimeEvent(event, storage);
        break;
      case "batch-with-updates":
        this.handleBatchWithUpdatesEvent(event);
        break;
      case "insert-only":
        this.handleInsertOnlyEvent(event);
        break;
    }
  }
  async shutdown() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.totalSize > 0) {
      this.logger.info("Flushing remaining events on shutdown", {
        remainingEvents: this.buffer.totalSize
      });
      try {
        await this.flush();
      } catch (error) {
        this.logger.error("Failed to flush remaining events during shutdown", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.logger.info("DefaultExporter shutdown complete");
  }
};

// src/ai-tracing/span_processors/sensitive-data-filter.ts
var SensitiveDataFilter = class {
  name = "sensitive-data-filter";
  sensitiveFields;
  redactionToken;
  redactionStyle;
  constructor(options = {}) {
    this.sensitiveFields = (options.sensitiveFields || [
      "password",
      "token",
      "secret",
      "key",
      "apikey",
      "auth",
      "authorization",
      "bearer",
      "bearertoken",
      "jwt",
      "credential",
      "clientsecret",
      "privatekey",
      "refresh",
      "ssn"
    ]).map((f) => this.normalizeKey(f));
    this.redactionToken = options.redactionToken ?? "[REDACTED]";
    this.redactionStyle = options.redactionStyle ?? "full";
  }
  /**
   * Process a span by filtering sensitive data across its key fields.
   * Fields processed: attributes, metadata, input, output, errorInfo.
   *
   * @param span - The input span to filter
   * @returns A new span with sensitive values redacted
   */
  process(span) {
    span.attributes = this.tryFilter(span.attributes);
    span.metadata = this.tryFilter(span.metadata);
    span.input = this.tryFilter(span.input);
    span.output = this.tryFilter(span.output);
    span.errorInfo = this.tryFilter(span.errorInfo);
    return span;
  }
  /**
   * Recursively filter objects/arrays for sensitive keys.
   * Handles circular references by replacing with a marker.
   */
  deepFilter(obj, seen = /* @__PURE__ */ new WeakSet()) {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }
    if (seen.has(obj)) {
      return "[Circular Reference]";
    }
    seen.add(obj);
    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepFilter(item, seen));
    }
    const filtered = {};
    for (const key of Object.keys(obj)) {
      const normKey = this.normalizeKey(key);
      if (this.isSensitive(normKey)) {
        if (obj[key] && typeof obj[key] === "object") {
          filtered[key] = this.deepFilter(obj[key], seen);
        } else {
          filtered[key] = this.redactValue(obj[key]);
        }
      } else {
        filtered[key] = this.deepFilter(obj[key], seen);
      }
    }
    return filtered;
  }
  tryFilter(value) {
    try {
      return this.deepFilter(value);
    } catch {
      return { error: { processor: this.name } };
    }
  }
  /**
   * Normalize keys by lowercasing and stripping non-alphanumeric characters.
   * Ensures consistent matching for variants like "api-key", "api_key", "Api Key".
   */
  normalizeKey(key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  /**
   * Check whether a normalized key exactly matches any sensitive field.
   * Both key and sensitive fields are normalized by removing all non-alphanumeric
   * characters and converting to lowercase before comparison.
   *
   * Examples:
   * - "api_key", "api-key", "ApiKey" all normalize to "apikey" → MATCHES "apikey"
   * - "promptTokens", "prompt_tokens" normalize to "prompttokens" → DOES NOT MATCH "token"
   */
  isSensitive(normalizedKey) {
    return this.sensitiveFields.some((sensitiveField) => {
      return normalizedKey === sensitiveField;
    });
  }
  /**
   * Redact a sensitive value.
   * - Full style: replaces with a fixed token.
   * - Partial style: shows 3 chars at start and end, hides the middle.
   *
   * Non-string values are converted to strings before partial redaction.
   */
  redactValue(value) {
    if (this.redactionStyle === "full") {
      return this.redactionToken;
    }
    const str = String(value);
    const len = str.length;
    if (len <= 6) {
      return this.redactionToken;
    }
    return str.slice(0, 3) + "\u2026" + str.slice(len - 3);
  }
  async shutdown() {
  }
};

// src/ai-tracing/registry.ts
var AITracingRegistry = class {
  instances = /* @__PURE__ */ new Map();
  defaultInstance;
  configSelector;
  /**
   * Register a tracing instance
   */
  register(name, instance, isDefault = false) {
    if (this.instances.has(name)) {
      throw new Error(`AI Tracing instance '${name}' already registered`);
    }
    this.instances.set(name, instance);
    if (isDefault || !this.defaultInstance) {
      this.defaultInstance = instance;
    }
  }
  /**
   * Get a tracing instance by name
   */
  get(name) {
    return this.instances.get(name);
  }
  /**
   * Get the default tracing instance
   */
  getDefault() {
    return this.defaultInstance;
  }
  /**
   * Set the tracing selector function
   */
  setSelector(selector) {
    this.configSelector = selector;
  }
  /**
   * Get the selected tracing instance based on context
   */
  getSelected(options) {
    if (this.configSelector) {
      const selected = this.configSelector(options, this.instances);
      if (selected && this.instances.has(selected)) {
        return this.instances.get(selected);
      }
    }
    return this.defaultInstance;
  }
  /**
   * Unregister a tracing instance
   */
  unregister(name) {
    return this.instances.delete(name);
  }
  /**
   * Shutdown all instances and clear the registry
   */
  async shutdown() {
    const shutdownPromises = Array.from(this.instances.values()).map((instance) => instance.shutdown());
    await Promise.allSettled(shutdownPromises);
    this.instances.clear();
  }
  /**
   * Clear all instances without shutdown
   */
  clear() {
    this.instances.clear();
    this.defaultInstance = void 0;
    this.configSelector = void 0;
  }
  /**
   * Get all registered instances
   */
  getAll() {
    return new Map(this.instances);
  }
};
var aiTracingRegistry = new AITracingRegistry();
function registerAITracing(name, instance, isDefault = false) {
  aiTracingRegistry.register(name, instance, isDefault);
}
function setSelector(selector) {
  aiTracingRegistry.setSelector(selector);
}
function getSelectedAITracing(options) {
  return aiTracingRegistry.getSelected(options);
}
async function shutdownAITracingRegistry() {
  await aiTracingRegistry.shutdown();
}
function getAllAITracing() {
  return aiTracingRegistry.getAll();
}
function isAITracingInstance(obj) {
  return obj instanceof BaseAITracing;
}
function setupAITracing(config) {
  if (!config) {
    return;
  }
  if (config.default?.enabled && config.configs?.["default"]) {
    throw new Error(
      "Cannot use 'default' as a custom config name when default tracing is enabled. Please rename your custom config to avoid conflicts."
    );
  }
  if (config.default?.enabled) {
    const defaultInstance = new DefaultAITracing({
      serviceName: "mastra",
      name: "default",
      sampling: { type: "always" /* ALWAYS */ },
      exporters: [new DefaultExporter(), new CloudExporter()],
      processors: [new SensitiveDataFilter()]
    });
    registerAITracing("default", defaultInstance, true);
  }
  if (config.configs) {
    const instances = Object.entries(config.configs);
    instances.forEach(([name, tracingDef], index) => {
      const instance = isAITracingInstance(tracingDef) ? tracingDef : new DefaultAITracing({ ...tracingDef, name });
      const isDefault = !config.default?.enabled && index === 0;
      registerAITracing(name, instance, isDefault);
    });
  }
  if (config.configSelector) {
    setSelector(config.configSelector);
  }
}
function selectFields(obj, fields) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }
  const result = {};
  for (const field of fields) {
    const value = getNestedValue(obj, field);
    if (value !== void 0) {
      setNestedValue(result, field, value);
    }
  }
  return result;
}
function getNestedValue(obj, path) {
  return path.split(".").reduce((current, key) => {
    return current && typeof current === "object" ? current[key] : void 0;
  }, obj);
}
function setNestedValue(obj, path, value) {
  const keys = path.split(".");
  const lastKey = keys.pop();
  if (!lastKey) {
    return;
  }
  const target = keys.reduce((current, key) => {
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    return current[key];
  }, obj);
  target[lastKey] = value;
}
function getValidTraceId(span) {
  return span?.isValid ? span.traceId : void 0;
}
function getOrCreateSpan(options) {
  const { type, attributes, tracingContext, runtimeContext, tracingOptions, ...rest } = options;
  const metadata = {
    ...rest.metadata ?? {},
    ...tracingOptions?.metadata ?? {}
  };
  if (tracingContext?.currentSpan) {
    return tracingContext.currentSpan.createChildSpan({
      type,
      attributes,
      ...rest,
      metadata
    });
  }
  const aiTracing = getSelectedAITracing({
    runtimeContext
  });
  return aiTracing?.startSpan({
    type,
    attributes,
    ...rest,
    metadata,
    runtimeContext,
    tracingOptions,
    traceId: tracingOptions?.traceId,
    parentSpanId: tracingOptions?.parentSpanId,
    customSamplerOptions: {
      runtimeContext,
      metadata
    }
  });
}

// src/ai-tracing/tracers/base.ts
var BaseAITracing = class extends MastraBase {
  config;
  constructor(config) {
    super({ component: RegisteredLogger.AI_TRACING, name: config.serviceName });
    this.config = {
      serviceName: config.serviceName,
      name: config.name,
      sampling: config.sampling ?? { type: "always" /* ALWAYS */ },
      exporters: config.exporters ?? [],
      processors: config.processors ?? [],
      includeInternalSpans: config.includeInternalSpans ?? false,
      runtimeContextKeys: config.runtimeContextKeys ?? []
    };
  }
  /**
   * Override setLogger to add AI tracing specific initialization log
   * and propagate logger to exporters
   */
  __setLogger(logger) {
    super.__setLogger(logger);
    this.exporters.forEach((exporter) => {
      if (typeof exporter.__setLogger === "function") {
        exporter.__setLogger(logger);
      }
    });
    this.logger.debug(
      `[AI Tracing] Initialized [service=${this.config.serviceName}] [instance=${this.config.name}] [sampling=${this.config.sampling.type}]`
    );
  }
  // ============================================================================
  // Protected getters for clean config access
  // ============================================================================
  get exporters() {
    return this.config.exporters || [];
  }
  get processors() {
    return this.config.processors || [];
  }
  // ============================================================================
  // Public API - Single type-safe span creation method
  // ============================================================================
  /**
   * Start a new span of a specific AISpanType
   */
  startSpan(options) {
    const { customSamplerOptions, runtimeContext, metadata, tracingOptions, ...rest } = options;
    if (!this.shouldSample(customSamplerOptions)) {
      return new NoOpAISpan({ ...rest, metadata }, this);
    }
    let traceState;
    if (options.parent) {
      traceState = options.parent.traceState;
    } else {
      traceState = this.computeTraceState(tracingOptions);
    }
    const enrichedMetadata = this.extractMetadataFromRuntimeContext(runtimeContext, metadata, traceState);
    const span = this.createSpan({
      ...rest,
      metadata: enrichedMetadata,
      traceState
    });
    if (span.isEvent) {
      this.emitSpanEnded(span);
    } else {
      this.wireSpanLifecycle(span);
      this.emitSpanStarted(span);
    }
    return span;
  }
  // ============================================================================
  // Configuration Management
  // ============================================================================
  /**
   * Get current configuration
   */
  getConfig() {
    return { ...this.config };
  }
  // ============================================================================
  // Plugin Access
  // ============================================================================
  /**
   * Get all exporters
   */
  getExporters() {
    return [...this.exporters];
  }
  /**
   * Get all processors
   */
  getProcessors() {
    return [...this.processors];
  }
  /**
   * Get the logger instance (for exporters and other components)
   */
  getLogger() {
    return this.logger;
  }
  // ============================================================================
  // Span Lifecycle Management
  // ============================================================================
  /**
   * Automatically wires up AI tracing lifecycle events for any span
   * This ensures all spans emit events regardless of implementation
   */
  wireSpanLifecycle(span) {
    if (!this.config.includeInternalSpans && span.isInternal) {
      return;
    }
    const originalEnd = span.end.bind(span);
    const originalUpdate = span.update.bind(span);
    span.end = (options) => {
      if (span.isEvent) {
        this.logger.warn(`End event is not available on event spans`);
        return;
      }
      originalEnd(options);
      this.emitSpanEnded(span);
    };
    span.update = (options) => {
      if (span.isEvent) {
        this.logger.warn(`Update() is not available on event spans`);
        return;
      }
      originalUpdate(options);
      this.emitSpanUpdated(span);
    };
  }
  // ============================================================================
  // Utility Methods
  // ============================================================================
  /**
   * Check if an AI trace should be sampled
   */
  shouldSample(options) {
    const { sampling } = this.config;
    switch (sampling.type) {
      case "always" /* ALWAYS */:
        return true;
      case "never" /* NEVER */:
        return false;
      case "ratio" /* RATIO */:
        if (sampling.probability === void 0 || sampling.probability < 0 || sampling.probability > 1) {
          this.logger.warn(
            `Invalid sampling probability: ${sampling.probability}. Expected value between 0 and 1. Defaulting to no sampling.`
          );
          return false;
        }
        return Math.random() < sampling.probability;
      case "custom" /* CUSTOM */:
        return sampling.sampler(options);
      default:
        throw new Error(`Sampling strategy type not implemented: ${sampling.type}`);
    }
  }
  /**
   * Compute TraceState for a new trace based on configured and per-request keys
   */
  computeTraceState(tracingOptions) {
    const configuredKeys = this.config.runtimeContextKeys ?? [];
    const additionalKeys = tracingOptions?.runtimeContextKeys ?? [];
    const allKeys = [...configuredKeys, ...additionalKeys];
    if (allKeys.length === 0) {
      return void 0;
    }
    return {
      runtimeContextKeys: allKeys
    };
  }
  /**
   * Extract metadata from RuntimeContext using TraceState
   */
  extractMetadataFromRuntimeContext(runtimeContext, explicitMetadata, traceState) {
    if (!runtimeContext || !traceState || traceState.runtimeContextKeys.length === 0) {
      return explicitMetadata;
    }
    const extracted = this.extractKeys(runtimeContext, traceState.runtimeContextKeys);
    if (Object.keys(extracted).length === 0 && !explicitMetadata) {
      return void 0;
    }
    return {
      ...extracted,
      ...explicitMetadata
      // Explicit metadata always wins
    };
  }
  /**
   * Extract specific keys from RuntimeContext
   */
  extractKeys(runtimeContext, keys) {
    const result = {};
    for (const key of keys) {
      const parts = key.split(".");
      const rootKey = parts[0];
      const value = runtimeContext.get(rootKey);
      if (value !== void 0) {
        if (parts.length > 1) {
          const nestedPath = parts.slice(1).join(".");
          const nestedValue = getNestedValue(value, nestedPath);
          if (nestedValue !== void 0) {
            setNestedValue(result, key, nestedValue);
          }
        } else {
          setNestedValue(result, key, value);
        }
      }
    }
    return result;
  }
  /**
   * Process a span through all processors
   */
  processSpan(span) {
    for (const processor of this.processors) {
      if (!span) {
        break;
      }
      try {
        span = processor.process(span);
      } catch (error) {
        this.logger.error(`[AI Tracing] Processor error [name=${processor.name}]`, error);
      }
    }
    return span;
  }
  // ============================================================================
  // Event-driven Export Methods
  // ============================================================================
  getSpanForExport(span) {
    if (!span.isValid) return void 0;
    if (span.isInternal && !this.config.includeInternalSpans) return void 0;
    const processedSpan = this.processSpan(span);
    return processedSpan?.exportSpan(this.config.includeInternalSpans);
  }
  /**
   * Emit a span started event
   */
  emitSpanStarted(span) {
    const exportedSpan = this.getSpanForExport(span);
    if (exportedSpan) {
      this.exportEvent({ type: "span_started" /* SPAN_STARTED */, exportedSpan }).catch((error) => {
        this.logger.error("[AI Tracing] Failed to export span_started event", error);
      });
    }
  }
  /**
   * Emit a span ended event (called automatically when spans end)
   */
  emitSpanEnded(span) {
    const exportedSpan = this.getSpanForExport(span);
    if (exportedSpan) {
      this.exportEvent({ type: "span_ended" /* SPAN_ENDED */, exportedSpan }).catch((error) => {
        this.logger.error("[AI Tracing] Failed to export span_ended event", error);
      });
    }
  }
  /**
   * Emit a span updated event
   */
  emitSpanUpdated(span) {
    const exportedSpan = this.getSpanForExport(span);
    if (exportedSpan) {
      this.exportEvent({ type: "span_updated" /* SPAN_UPDATED */, exportedSpan }).catch((error) => {
        this.logger.error("[AI Tracing] Failed to export span_updated event", error);
      });
    }
  }
  /**
   * Export tracing event through all exporters (realtime mode)
   */
  async exportEvent(event) {
    const exportPromises = this.exporters.map(async (exporter) => {
      try {
        if (exporter.exportEvent) {
          await exporter.exportEvent(event);
          this.logger.debug(`[AI Tracing] Event exported [exporter=${exporter.name}] [type=${event.type}]`);
        }
      } catch (error) {
        this.logger.error(`[AI Tracing] Export error [exporter=${exporter.name}]`, error);
      }
    });
    await Promise.allSettled(exportPromises);
  }
  // ============================================================================
  // Lifecycle Management
  // ============================================================================
  /**
   * Initialize AI tracing (called by Mastra during component registration)
   */
  init() {
    this.logger.debug(`[AI Tracing] Initialization started [name=${this.name}]`);
    this.logger.info(`[AI Tracing] Initialized successfully [name=${this.name}]`);
  }
  /**
   * Shutdown AI tracing and clean up resources
   */
  async shutdown() {
    this.logger.debug(`[AI Tracing] Shutdown started [name=${this.name}]`);
    const shutdownPromises = [...this.exporters.map((e) => e.shutdown()), ...this.processors.map((p) => p.shutdown())];
    await Promise.allSettled(shutdownPromises);
    this.logger.info(`[AI Tracing] Shutdown completed [name=${this.name}]`);
  }
};

// src/ai-tracing/tracers/default.ts
var DefaultAITracing = class extends BaseAITracing {
  constructor(config) {
    super(config);
  }
  createSpan(options) {
    return new DefaultAISpan(options, this);
  }
};

// src/ai-tracing/context.ts
var AGENT_GETTERS = ["getAgent", "getAgentById"];
var AGENT_METHODS_TO_WRAP = ["generate", "stream", "generateLegacy", "streamLegacy"];
var WORKFLOW_GETTERS = ["getWorkflow", "getWorkflowById"];
var WORKFLOW_METHODS_TO_WRAP = ["execute", "createRun", "createRunAsync"];
function isNoOpSpan(span) {
  return span.constructor.name === "NoOpAISpan" || span.__isNoOp === true;
}
function isMastra(mastra) {
  const hasAgentGetters = AGENT_GETTERS.every((method) => typeof mastra?.[method] === "function");
  const hasWorkflowGetters = WORKFLOW_GETTERS.every((method) => typeof mastra?.[method] === "function");
  return hasAgentGetters && hasWorkflowGetters;
}
function wrapMastra(mastra, tracingContext) {
  if (!tracingContext.currentSpan || isNoOpSpan(tracingContext.currentSpan)) {
    return mastra;
  }
  if (!isMastra(mastra)) {
    return mastra;
  }
  try {
    return new Proxy(mastra, {
      get(target, prop) {
        try {
          if (AGENT_GETTERS.includes(prop)) {
            return (...args) => {
              const agent = target[prop](...args);
              return wrapAgent(agent, tracingContext);
            };
          }
          if (WORKFLOW_GETTERS.includes(prop)) {
            return (...args) => {
              const workflow = target[prop](...args);
              return wrapWorkflow(workflow, tracingContext);
            };
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        } catch (error) {
          console.warn("AI Tracing: Failed to wrap method, falling back to original", error);
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    });
  } catch (error) {
    console.warn("AI Tracing: Failed to create proxy, using original Mastra instance", error);
    return mastra;
  }
}
function wrapAgent(agent, tracingContext) {
  if (!tracingContext.currentSpan || isNoOpSpan(tracingContext.currentSpan)) {
    return agent;
  }
  try {
    return new Proxy(agent, {
      get(target, prop) {
        try {
          if (AGENT_METHODS_TO_WRAP.includes(prop)) {
            return (input, options = {}) => {
              return target[prop](input, {
                ...options,
                tracingContext
              });
            };
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        } catch (error) {
          console.warn("AI Tracing: Failed to wrap agent method, falling back to original", error);
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    });
  } catch (error) {
    console.warn("AI Tracing: Failed to create agent proxy, using original instance", error);
    return agent;
  }
}
function wrapWorkflow(workflow, tracingContext) {
  if (!tracingContext.currentSpan || isNoOpSpan(tracingContext.currentSpan)) {
    return workflow;
  }
  try {
    return new Proxy(workflow, {
      get(target, prop) {
        try {
          if (WORKFLOW_METHODS_TO_WRAP.includes(prop)) {
            if (prop === "createRun" || prop === "createRunAsync") {
              return async (options = {}) => {
                const run = await target[prop](options);
                return run ? wrapRun(run, tracingContext) : run;
              };
            }
            return (input, options = {}) => {
              return target[prop](input, {
                ...options,
                tracingContext
              });
            };
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        } catch (error) {
          console.warn("AI Tracing: Failed to wrap workflow method, falling back to original", error);
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    });
  } catch (error) {
    console.warn("AI Tracing: Failed to create workflow proxy, using original instance", error);
    return workflow;
  }
}
function wrapRun(run, tracingContext) {
  if (!tracingContext.currentSpan || isNoOpSpan(tracingContext.currentSpan)) {
    return run;
  }
  try {
    return new Proxy(run, {
      get(target, prop) {
        try {
          if (prop === "start") {
            return (startOptions = {}) => {
              return target.start({
                ...startOptions,
                tracingContext: startOptions.tracingContext ?? tracingContext
              });
            };
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        } catch (error) {
          console.warn("AI Tracing: Failed to wrap run method, falling back to original", error);
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    });
  } catch (error) {
    console.warn("AI Tracing: Failed to create run proxy, using original instance", error);
    return run;
  }
}
var ModelSpanTracker = class {
  #modelSpan;
  #currentStepSpan;
  #currentChunkSpan;
  #accumulator = {};
  #stepIndex = 0;
  #chunkSequence = 0;
  constructor(modelSpan) {
    this.#modelSpan = modelSpan;
  }
  /**
   * Get the tracing context for creating child spans.
   * Returns the current step span if active, otherwise the model span.
   */
  getTracingContext() {
    return {
      currentSpan: this.#currentStepSpan ?? this.#modelSpan
    };
  }
  /**
   * Report an error on the generation span
   */
  reportGenerationError(options) {
    this.#modelSpan?.error(options);
  }
  /**
   * End the generation span
   */
  endGeneration(options) {
    this.#modelSpan?.end(options);
  }
  /**
   * Update the generation span
   */
  updateGeneration(options) {
    this.#modelSpan?.update(options);
  }
  /**
   * Start a new Model execution step
   */
  #startStepSpan(payload) {
    this.#currentStepSpan = this.#modelSpan?.createChildSpan({
      name: `step: ${this.#stepIndex}`,
      type: "model_step" /* MODEL_STEP */,
      attributes: {
        stepIndex: this.#stepIndex,
        ...payload?.messageId ? { messageId: payload.messageId } : {},
        ...payload?.warnings?.length ? { warnings: payload.warnings } : {}
      },
      input: payload?.request
    });
    this.#chunkSequence = 0;
  }
  /**
   * End the current Model execution step with token usage, finish reason, output, and metadata
   */
  #endStepSpan(payload) {
    if (!this.#currentStepSpan) return;
    const output = payload.output;
    const { usage, ...otherOutput } = output;
    const stepResult = payload.stepResult;
    const metadata = payload.metadata;
    const cleanMetadata = metadata ? { ...metadata } : void 0;
    if (cleanMetadata?.request) {
      delete cleanMetadata.request;
    }
    this.#currentStepSpan.end({
      output: otherOutput,
      attributes: {
        usage,
        isContinued: stepResult.isContinued,
        finishReason: stepResult.reason,
        warnings: stepResult.warnings
      },
      metadata: {
        ...cleanMetadata
      }
    });
    this.#currentStepSpan = void 0;
    this.#stepIndex++;
  }
  /**
   * Create a new chunk span (for multi-part chunks like text-start/delta/end)
   */
  #startChunkSpan(chunkType, initialData) {
    if (!this.#currentStepSpan) {
      this.#startStepSpan();
    }
    this.#currentChunkSpan = this.#currentStepSpan?.createChildSpan({
      name: `chunk: '${chunkType}'`,
      type: "model_chunk" /* MODEL_CHUNK */,
      attributes: {
        chunkType,
        sequenceNumber: this.#chunkSequence
      }
    });
    this.#accumulator = initialData || {};
  }
  /**
   * Append string content to a specific field in the accumulator
   */
  #appendToAccumulator(field, text) {
    if (this.#accumulator[field] === void 0) {
      this.#accumulator[field] = text;
    } else {
      this.#accumulator[field] += text;
    }
  }
  /**
   * End the current chunk span.
   * Safe to call multiple times - will no-op if span already ended.
   */
  #endChunkSpan(output) {
    if (!this.#currentChunkSpan) return;
    this.#currentChunkSpan.end({
      output: output !== void 0 ? output : this.#accumulator
    });
    this.#currentChunkSpan = void 0;
    this.#accumulator = {};
    this.#chunkSequence++;
  }
  /**
   * Create an event span (for single chunks like tool-call)
   */
  #createEventSpan(chunkType, output) {
    if (!this.#currentStepSpan) {
      this.#startStepSpan();
    }
    const span = this.#currentStepSpan?.createEventSpan({
      name: `chunk: '${chunkType}'`,
      type: "model_chunk" /* MODEL_CHUNK */,
      attributes: {
        chunkType,
        sequenceNumber: this.#chunkSequence
      },
      output
    });
    if (span) {
      this.#chunkSequence++;
    }
  }
  /**
   * Check if there is currently an active chunk span
   */
  #hasActiveChunkSpan() {
    return !!this.#currentChunkSpan;
  }
  /**
   * Get the current accumulator value
   */
  #getAccumulator() {
    return this.#accumulator;
  }
  /**
   * Handle text chunk spans (text-start/delta/end)
   */
  #handleTextChunk(chunk) {
    switch (chunk.type) {
      case "text-start":
        this.#startChunkSpan("text");
        break;
      case "text-delta":
        this.#appendToAccumulator("text", chunk.payload.text);
        break;
      case "text-end": {
        this.#endChunkSpan();
        break;
      }
    }
  }
  /**
   * Handle reasoning chunk spans (reasoning-start/delta/end)
   */
  #handleReasoningChunk(chunk) {
    switch (chunk.type) {
      case "reasoning-start":
        this.#startChunkSpan("reasoning");
        break;
      case "reasoning-delta":
        this.#appendToAccumulator("text", chunk.payload.text);
        break;
      case "reasoning-end": {
        this.#endChunkSpan();
        break;
      }
    }
  }
  /**
   * Handle tool call chunk spans (tool-call-input-streaming-start/delta/end, tool-call)
   */
  #handleToolCallChunk(chunk) {
    switch (chunk.type) {
      case "tool-call-input-streaming-start":
        this.#startChunkSpan("tool-call", {
          toolName: chunk.payload.toolName,
          toolCallId: chunk.payload.toolCallId
        });
        break;
      case "tool-call-delta":
        this.#appendToAccumulator("toolInput", chunk.payload.argsTextDelta);
        break;
      case "tool-call-input-streaming-end":
      case "tool-call": {
        const acc = this.#getAccumulator();
        let toolInput;
        try {
          toolInput = acc.toolInput ? JSON.parse(acc.toolInput) : {};
        } catch {
          toolInput = acc.toolInput;
        }
        this.#endChunkSpan({
          toolName: acc.toolName,
          toolCallId: acc.toolCallId,
          toolInput
        });
        break;
      }
    }
  }
  /**
   * Handle object chunk spans (object, object-result)
   */
  #handleObjectChunk(chunk) {
    switch (chunk.type) {
      case "object":
        if (!this.#hasActiveChunkSpan()) {
          this.#startChunkSpan("object");
        }
        break;
      case "object-result":
        this.#endChunkSpan(chunk.object);
        break;
    }
  }
  /**
   * Wraps a stream with model tracing transform to track MODEL_STEP and MODEL_CHUNK spans.
   *
   * This should be added to the stream pipeline to automatically
   * create MODEL_STEP and MODEL_CHUNK spans for each semantic unit in the stream.
   */
  wrapStream(stream) {
    return stream.pipeThrough(
      new TransformStream$1({
        transform: (chunk, controller) => {
          controller.enqueue(chunk);
          switch (chunk.type) {
            case "text-start":
            case "text-delta":
            case "text-end":
              this.#handleTextChunk(chunk);
              break;
            case "tool-call-input-streaming-start":
            case "tool-call-delta":
            case "tool-call-input-streaming-end":
            case "tool-call":
              this.#handleToolCallChunk(chunk);
              break;
            case "reasoning-start":
            case "reasoning-delta":
            case "reasoning-end":
              this.#handleReasoningChunk(chunk);
              break;
            case "object":
            case "object-result":
              this.#handleObjectChunk(chunk);
              break;
            case "step-start":
              this.#startStepSpan(chunk.payload);
              break;
            case "step-finish":
              this.#endStepSpan(chunk.payload);
              break;
            case "raw":
            // Skip raw chunks as they're redundant
            case "start":
            case "finish":
              break;
            // Default: auto-create event span for all other chunk types
            default: {
              let outputPayload = chunk.payload;
              if (outputPayload && typeof outputPayload === "object" && "data" in outputPayload) {
                const typedPayload = outputPayload;
                outputPayload = { ...typedPayload };
                if (typedPayload.data) {
                  outputPayload.size = typeof typedPayload.data === "string" ? typedPayload.data.length : typedPayload.data instanceof Uint8Array ? typedPayload.data.length : void 0;
                  delete outputPayload.data;
                }
              }
              this.#createEventSpan(chunk.type, outputPayload);
              break;
            }
          }
        }
      })
    );
  }
};

export { AISpanType as A, DeepSeekSchemaCompatLayer as D, GoogleSchemaCompatLayer as G, MetaSchemaCompatLayer as M, OpenAIReasoningSchemaCompatLayer as O, ToolStream as T, shutdownAITracingRegistry as a, OpenAISchemaCompatLayer as b, AnthropicSchemaCompatLayer as c, deepMerge as d, applyCompatLayer as e, fetchWithRetry as f, getAllAITracing as g, delay as h, isZodType as i, ensureToolProperties as j, createMastraProxy as k, getOrCreateSpan as l, makeCoreTool as m, getValidTraceId as n, selectFields as o, parseSqlIdentifier as p, ModelSpanTracker as q, generateEmptyFromSchema as r, setupAITracing as s, checkEvalStorageFields as t, wrapMastra as w };
