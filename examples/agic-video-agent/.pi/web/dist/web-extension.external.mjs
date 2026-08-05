var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// .pi/web/web.config.tsx
import { defineWebExtension as defineWebExtension3 } from "@blksails/pi-web-kit";

// ../../packages/canvas-ui/src/pane-contract.ts
var CANVAS_OPEN_ATTACHMENTS_EVENT = "pi.canvas.open-attachments";

// ../../packages/canvas-ui/src/pane-module.ts
var canvasPaneModule = {
  id: "canvas",
  title: "\u753B\u5E03",
  icon: "palette",
  entry: new URL("./pane-guest.tsx", import.meta.url),
  canvasStyles: true,
  capabilities: {
    surfaceKeys: ["surface:canvas"],
    surfaceCommands: [
      {
        domain: "canvas",
        actions: [
          "sync",
          "register",
          "edit",
          "inpaint",
          "reference",
          "variants",
          "outpaint",
          "reframe",
          "delete"
        ]
      }
    ],
    events: { subscribe: [CANVAS_OPEN_ATTACHMENTS_EVENT] },
    attachments: "read-write",
    conversation: "submit"
  }
};

// ../../packages/canvas-ui/src/conversation-image-action.ts
var canvasConversationImageAction = {
  id: "canvas:open",
  label: "\u5728\u753B\u5E03\u4E2D\u6253\u5F00",
  icon: "palette",
  order: 10,
  when: ({ asset }) => asset.attachmentId !== void 0,
  run: ({ asset, publishPaneEvent }) => {
    if (asset.attachmentId === void 0) return;
    publishPaneEvent(CANVAS_OPEN_ATTACHMENTS_EVENT, {
      attachmentIds: [asset.attachmentId]
    });
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../../packages/panes-kit/src/protocol-version.ts
var UNLIMITED_PANE_COUNT = Number.MAX_SAFE_INTEGER;

// ../../packages/panes-kit/src/contract.ts
var NonEmptyIdSchema = external_exports.string().min(1).max(128);
var PaneRouteGrantSchema = external_exports.object({
  name: NonEmptyIdSchema,
  methods: external_exports.array(external_exports.enum(["GET", "POST"])).min(1),
  maxRequestBytes: external_exports.number().int().positive().max(16 * 1024 * 1024).optional(),
  maxResponseBytes: external_exports.number().int().positive().max(32 * 1024 * 1024).optional()
});
var PaneSurfaceCommandGrantSchema = external_exports.object({
  domain: NonEmptyIdSchema,
  actions: external_exports.array(NonEmptyIdSchema).min(1)
});
var PaneCapabilitiesSchema = external_exports.object({
  routes: external_exports.array(PaneRouteGrantSchema).default([]),
  surfaceKeys: external_exports.array(NonEmptyIdSchema).default([]),
  surfaceCommands: external_exports.array(PaneSurfaceCommandGrantSchema).default([]),
  events: external_exports.object({
    publish: external_exports.array(NonEmptyIdSchema).default([]),
    subscribe: external_exports.array(NonEmptyIdSchema).default([])
  }).default({}),
  attachments: external_exports.enum(["none", "read", "read-write"]).default("none"),
  conversation: external_exports.enum(["none", "submit"]).default("none"),
  downloads: external_exports.boolean().default(false),
  /**
   * 会话级共享状态的逐键授权(spec panes-only-right-panel Req 2)。
   *
   * ★ **读与写分成两张表**,而不是一张表加一个布尔。写是显著更强的权力(它改的是 agent 也在
   * 读的同一份状态),不该被读授权顺带捎上 —— 「订阅这个键」和「能改这个键」是两个决定。
   *
   * 与 `surfaceKeys` 的关系:`surfaceKeys` 搬运的是 **agent 权威快照**(只读、由 agent 发布);
   * 这里搬运的是**会话级共享 KV**(人与 agent 双向读写)。两者事实源不同,故不合并。
   */
  state: external_exports.object({
    read: external_exports.array(NonEmptyIdSchema).default([]),
    write: external_exports.array(NonEmptyIdSchema).default([])
  }).default({})
});
var PaneDocumentSchema = external_exports.discriminatedUnion("kind", [
  external_exports.object({ kind: external_exports.literal("inline"), srcDoc: external_exports.string() }),
  external_exports.object({ kind: external_exports.literal("html"), src: external_exports.string().min(1) })
]);
var PaneDefinitionSchema = external_exports.object({
  id: NonEmptyIdSchema,
  title: external_exports.string().min(1).max(160),
  icon: external_exports.string().max(32).optional(),
  document: PaneDocumentSchema,
  capabilities: PaneCapabilitiesSchema,
  allowMultiple: external_exports.boolean().default(false),
  maxInstances: external_exports.number().int().min(1).max(UNLIMITED_PANE_COUNT).default(1),
  lifecycle: external_exports.object({
    keepAlive: external_exports.boolean().default(true),
    suspendWhenHidden: external_exports.boolean().default(false)
  }).default({})
});
var PanesDefinitionSchema = external_exports.object({
  id: NonEmptyIdSchema,
  panes: external_exports.array(PaneDefinitionSchema).min(1),
  /** 显式空数组表示仅注册 Pane，不在进入 Agent 时自动打开任何 Pane。 */
  initialPaneIds: external_exports.array(NonEmptyIdSchema).optional(),
  maxOpenPanes: external_exports.number().int().min(1).max(UNLIMITED_PANE_COUNT).default(16)
});
var RequestBaseSchema = external_exports.object({
  type: external_exports.literal("pane:request"),
  requestId: NonEmptyIdSchema
});
var PaneGuestRequestSchema = external_exports.discriminatedUnion("operation", [
  RequestBaseSchema.extend({
    operation: external_exports.literal("route.query"),
    route: NonEmptyIdSchema,
    query: external_exports.record(external_exports.string(), external_exports.string()).optional()
  }),
  RequestBaseSchema.extend({
    operation: external_exports.literal("route.mutate"),
    route: NonEmptyIdSchema,
    body: external_exports.unknown()
  }),
  RequestBaseSchema.extend({
    operation: external_exports.literal("surface.run"),
    domain: NonEmptyIdSchema,
    action: NonEmptyIdSchema,
    args: external_exports.unknown().optional()
  }),
  RequestBaseSchema.extend({
    operation: external_exports.literal("event.publish"),
    topic: NonEmptyIdSchema,
    payload: external_exports.unknown().optional()
  }),
  RequestBaseSchema.extend({
    operation: external_exports.literal("attachment.put"),
    name: external_exports.string().min(1).max(255),
    mimeType: external_exports.string().max(255),
    // 结构化克隆/跨 realm 中继后 instanceof 失真,以 brand 判别。
    bytes: external_exports.custom((value) => Object.prototype.toString.call(value) === "[object ArrayBuffer]")
  }),
  RequestBaseSchema.extend({
    operation: external_exports.literal("conversation.submit"),
    text: external_exports.string().min(1).max(1e5),
    attachmentIds: external_exports.array(external_exports.string().min(1).max(256)).max(64).optional()
  }),
  RequestBaseSchema.extend({
    operation: external_exports.literal("conversation.stage"),
    text: external_exports.string().max(1e5),
    attachmentIds: external_exports.array(external_exports.string().min(1).max(256)).max(64).optional()
  }),
  // 共享状态的**写回**。读与订阅不走上行请求 —— 它们由宿主按授权键主动推 `pane:state`
  // (与 `pane:surface` 同构),故此处只有写。
  RequestBaseSchema.extend({
    operation: external_exports.literal("state.set"),
    key: NonEmptyIdSchema,
    value: external_exports.unknown()
  }),
  RequestBaseSchema.extend({
    operation: external_exports.literal("state.delete"),
    key: NonEmptyIdSchema
  })
]);
var PaneErrorCodeSchema = external_exports.enum([
  "INVALID_MESSAGE",
  "STALE_INSTANCE",
  "CAPABILITY_DENIED",
  "PAYLOAD_TOO_LARGE",
  "REVISION_CONFLICT",
  "ROUTE_FAILED",
  "ATTACHMENT_FAILED",
  "HOST_UNAVAILABLE",
  "REQUEST_TIMEOUT"
]);
function definePaneDefinition(input) {
  return PaneDefinitionSchema.parse(input);
}
function definePanes(input) {
  const definition = PanesDefinitionSchema.parse(input);
  const ids = /* @__PURE__ */ new Set();
  for (const pane of definition.panes) {
    if (ids.has(pane.id)) throw new Error(`Duplicate pane id: ${pane.id}`);
    ids.add(pane.id);
    if (!pane.allowMultiple && pane.maxInstances !== 1) {
      throw new Error(`Pane ${pane.id} sets maxInstances > 1 without allowMultiple`);
    }
  }
  const initialPaneIds = definition.initialPaneIds ?? [definition.panes[0].id];
  if (initialPaneIds.length > definition.maxOpenPanes) throw new Error("Initial panes exceed maxOpenPanes");
  const initialCounts = /* @__PURE__ */ new Map();
  for (const paneId of initialPaneIds) {
    if (!ids.has(paneId)) throw new Error(`Unknown initial pane id: ${paneId}`);
    const pane = definition.panes.find((candidate) => candidate.id === paneId);
    const count = (initialCounts.get(paneId) ?? 0) + 1;
    initialCounts.set(paneId, count);
    if (!pane.allowMultiple && count > 1 || count > pane.maxInstances) {
      throw new Error(`Initial pane ${paneId} exceeds its instance limit`);
    }
  }
  return definition;
}

// ../../packages/panes-kit/src/workspace-intent.ts
var PI_PANES_WORKSPACE_INTENT_EVENT = "pi-panes-workspace-intent";
var PI_PANES_PANEL_OPEN_EVENT = "pi-panes-panel-open";
function requestPaneWorkspaceIntent(intent, target = window) {
  target.dispatchEvent(
    new CustomEvent(PI_PANES_WORKSPACE_INTENT_EVENT, { detail: intent })
  );
}
function requestPanesPanelOpen(target = window) {
  target.dispatchEvent(new Event(PI_PANES_PANEL_OPEN_EVENT));
}
function openOrActivatePaneFromHost(paneId, target = window) {
  requestPanesPanelOpen(target);
  requestPaneWorkspaceIntent({ type: "open-or-activate", paneId }, target);
}

// packages/materials-pane/src/events.ts
var CANVAS_OPEN_ATTACHMENTS_EVENT2 = "pi.canvas.open-attachments";
var SESSION_LOCATE_EVENT = "pi.session.locate";

// packages/materials-pane/src/module.ts
var materialsPaneModule = {
  id: "materials",
  title: "\u7D20\u6750",
  icon: "images",
  entry: new URL("./guest.tsx", import.meta.url),
  capabilities: {
    routes: [
      { name: "assets-list", methods: ["GET"] },
      { name: "materials-library", methods: ["GET", "POST"] },
      { name: "material-status", methods: ["GET"] }
    ],
    surfaceKeys: ["surface:materials"],
    surfaceCommands: [
      {
        domain: "materials",
        actions: [
          "select",
          "set-filter",
          "create-folder",
          "rename-folder",
          "move-folder",
          "delete-folder",
          "move-items",
          "rename-item"
        ]
      }
    ],
    events: { publish: [CANVAS_OPEN_ATTACHMENTS_EVENT2, SESSION_LOCATE_EVENT] },
    attachments: "read-write",
    conversation: "submit",
    downloads: true
  }
};

// packages/search-pane/src/module.ts
var searchPaneModule = {
  id: "search",
  title: "\u641C\u56FE",
  icon: "search",
  entry: new URL("./guest.tsx", import.meta.url),
  capabilities: {
    routes: [{ name: "creative-search", methods: ["POST"] }]
  }
};

// video-studio/module.ts
var VIDEO_STUDIO_PANE_ID = "video-studio";
var videoStudioPaneModule = {
  id: VIDEO_STUDIO_PANE_ID,
  title: "\u89C6\u9891\u5DE5\u4F5C\u5BA4",
  icon: "clapperboard",
  entry: new URL("./guest.tsx", import.meta.url),
  capabilities: {
    routes: [{ name: "video-studio-state", methods: ["GET"] }],
    surfaceKeys: ["surface:video-studio"],
    surfaceCommands: [
      {
        domain: "video-studio",
        actions: [
          "create-plan",
          "update-brief",
          "update-shot",
          "queue-shot",
          "queue-all",
          "pause-shot",
          "resume-shot",
          "retry-shot",
          "rollback-shot",
          "select-video",
          "select-prompt",
          "delete-prompt-history",
          "delete-video-history",
          "add-to-timeline",
          "remove-from-timeline",
          "set-audio-track",
          "trim-audio-track",
          "clear-audio-track",
          "clear-timeline",
          "request-export",
          "sync"
        ]
      }
    ],
    conversation: "submit"
  }
};

// panes/modules.ts
var AIGC_PANES_ID = "agic-video-panes";
var aigcPaneModules = [
  searchPaneModule,
  materialsPaneModule,
  canvasPaneModule,
  videoStudioPaneModule
];

// panes/agent-config.ts
var AIGC_AGENT_PANEL_CONFIG = {
  panelRatio: "centered",
  // 右侧素材库保持紧凑；仍可经分隔条扩展。
  panelWidth: 620,
  minPanelWidth: 320,
  maxPanelWidth: 960,
  maxPanelWidthRatio: 0.7
};
var AIGC_PANES_CONFIG = {
  interactionMode: "advanced",
  allowTabReorder: true,
  showCommandPalette: true,
  eventTargets: { [CANVAS_OPEN_ATTACHMENTS_EVENT]: "canvas" }
};

// panes/logs-pane-document.ts
var LOGS_PANE_ID = "logs";

// ../../packages/canvas-ui/src/use-canvas-view.ts
import { useCallback, useMemo, useSyncExternalStore } from "react";
function defaultViewState() {
  return { density: "overview", page: 0, group: "time", selected: [], chain: [] };
}
var VIEW_KEY = "pi-web:canvas:view";
var OPEN_KEY = "pi-web:canvas:open";
function readLocal(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeLocal(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function createOpenStore() {
  let open = readLocal(OPEN_KEY, false);
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    getSnapshot: () => open,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (open === next) return;
      open = next;
      writeLocal(OPEN_KEY, open);
      emit();
    },
    toggle: () => {
      open = !open;
      writeLocal(OPEN_KEY, open);
      emit();
    }
  };
}
var canvasOpenStore = createOpenStore();
function createFocusStore() {
  let focus = null;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => focus,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (focus === next) return;
      focus = next;
      for (const l of listeners) l();
    }
  };
}
var canvasFocusStore = createFocusStore();
var SERVER_OPEN = () => false;
function useCanvasOpen() {
  const open = useSyncExternalStore(
    canvasOpenStore.subscribe,
    canvasOpenStore.getSnapshot,
    SERVER_OPEN
  );
  return {
    open,
    setOpen: useCallback((next) => canvasOpenStore.set(next), []),
    toggle: useCallback(() => canvasOpenStore.toggle(), [])
  };
}
function createViewStore() {
  let state = { ...defaultViewState(), ...readLocal(VIEW_KEY, {}) };
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (patch) => {
      state = patch(state);
      writeLocal(VIEW_KEY, state);
      for (const l of listeners) l();
    }
  };
}
var canvasViewStore = createViewStore();

// ../../packages/canvas-ui/src/canvas-launcher.tsx
import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var DOMAIN = "canvas";
var STATE_KEY = `surface:${DOMAIN}`;
function CanvasLauncher({
  enabled,
  workspacePaneId
}) {
  const on = enabled ?? true;
  const { open, toggle } = useCanvasOpen();
  if (!on) return null;
  const panesMode = workspacePaneId !== void 0 && workspacePaneId.length > 0;
  return /* @__PURE__ */ jsxs(
    "button",
    {
      type: "button",
      "data-canvas-launcher": true,
      ...panesMode ? { "data-canvas-launcher-panes": "", "aria-label": "\u6253\u5F00\u753B\u5E03" } : { "aria-expanded": open },
      onClick: () => {
        if (panesMode) openOrActivatePaneFromHost(workspacePaneId);
        else toggle();
      },
      className: "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-[hsl(var(--accent))]",
      children: [
        /* @__PURE__ */ jsx("span", { "aria-hidden": true, children: "\u{1F5BC}\uFE0F" }),
        /* @__PURE__ */ jsx("span", { children: "Canvas \u753B\u5ECA" })
      ]
    }
  );
}

// .pi/web/canvas-panes-launcher.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
function AigcCanvasPanesLauncher(props) {
  return /* @__PURE__ */ jsx2(CanvasLauncher, { ...props, workspacePaneId: canvasPaneModule.id });
}

// .pi/web/image-renderer.tsx
import * as React3 from "react";
import { defineWebExtension } from "@blksails/pi-web-kit";

// .pi/web/tool-card.tsx
import * as React2 from "react";

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/createLucideIcon.js
import { forwardRef as forwardRef2, createElement as createElement2 } from "react";

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/Icon.js
import { forwardRef, createElement } from "react";

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/defaultAttributes.js
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/Icon.js
var Icon = forwardRef(
  ({
    color = "currentColor",
    size = 24,
    strokeWidth = 2,
    absoluteStrokeWidth,
    className = "",
    children,
    iconNode,
    ...rest
  }, ref) => {
    return createElement(
      "svg",
      {
        ref,
        ...defaultAttributes,
        width: size,
        height: size,
        stroke: color,
        strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: mergeClasses("lucide", className),
        ...rest
      },
      [
        ...iconNode.map(([tag, attrs]) => createElement(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/createLucideIcon.js
var createLucideIcon = (iconName, iconNode) => {
  const Component = forwardRef2(
    ({ className, ...props }, ref) => createElement2(Icon, {
      ref,
      iconNode,
      className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
      ...props
    })
  );
  Component.displayName = `${iconName}`;
  return Component;
};

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/audio-lines.js
var AudioLines = createLucideIcon("AudioLines", [
  ["path", { d: "M2 10v3", key: "1fnikh" }],
  ["path", { d: "M6 6v11", key: "11sgs0" }],
  ["path", { d: "M10 3v18", key: "yhl04a" }],
  ["path", { d: "M14 8v7", key: "3a1oy3" }],
  ["path", { d: "M18 5v13", key: "123xd1" }],
  ["path", { d: "M22 10v3", key: "154ddg" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/chevron-down.js
var ChevronDown = createLucideIcon("ChevronDown", [
  ["path", { d: "m6 9 6 6 6-6", key: "qrunsl" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/chevron-left.js
var ChevronLeft = createLucideIcon("ChevronLeft", [
  ["path", { d: "m15 18-6-6 6-6", key: "1wnfg3" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/chevron-right.js
var ChevronRight = createLucideIcon("ChevronRight", [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/clapperboard.js
var Clapperboard = createLucideIcon("Clapperboard", [
  [
    "path",
    { d: "M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z", key: "1tn4o7" }
  ],
  ["path", { d: "m6.2 5.3 3.1 3.9", key: "iuk76l" }],
  ["path", { d: "m12.4 3.4 3.1 4", key: "6hsd6n" }],
  ["path", { d: "M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", key: "ltgou9" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/combine.js
var Combine = createLucideIcon("Combine", [
  ["path", { d: "M10 18H5a3 3 0 0 1-3-3v-1", key: "ru65g8" }],
  ["path", { d: "M14 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2", key: "e30een" }],
  ["path", { d: "M20 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2", key: "2ahx8o" }],
  ["path", { d: "m7 21 3-3-3-3", key: "127cv2" }],
  ["rect", { x: "14", y: "14", width: "8", height: "8", rx: "2", key: "1b0bso" }],
  ["rect", { x: "2", y: "2", width: "8", height: "8", rx: "2", key: "1x09vl" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/download.js
var Download = createLucideIcon("Download", [
  ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", key: "ih7n3h" }],
  ["polyline", { points: "7 10 12 15 17 10", key: "2ggqvy" }],
  ["line", { x1: "12", x2: "12", y1: "15", y2: "3", key: "1vk2je" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/file-video.js
var FileVideo = createLucideIcon("FileVideo", [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", key: "1rqfz7" }],
  ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4", key: "tnqrlb" }],
  ["path", { d: "m10 11 5 3-5 3v-6Z", key: "7ntvm4" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/film.js
var Film = createLucideIcon("Film", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["path", { d: "M7 3v18", key: "bbkbws" }],
  ["path", { d: "M3 7.5h4", key: "zfgn84" }],
  ["path", { d: "M3 12h18", key: "1i2n21" }],
  ["path", { d: "M3 16.5h4", key: "1230mu" }],
  ["path", { d: "M17 3v18", key: "in4fa5" }],
  ["path", { d: "M17 7.5h4", key: "myr1c1" }],
  ["path", { d: "M17 16.5h4", key: "go4c1d" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/flip-horizontal-2.js
var FlipHorizontal2 = createLucideIcon("FlipHorizontal2", [
  ["path", { d: "m3 7 5 5-5 5V7", key: "couhi7" }],
  ["path", { d: "m21 7-5 5 5 5V7", key: "6ouia7" }],
  ["path", { d: "M12 20v2", key: "1lh1kg" }],
  ["path", { d: "M12 14v2", key: "8jcxud" }],
  ["path", { d: "M12 8v2", key: "1woqiv" }],
  ["path", { d: "M12 2v2", key: "tus03m" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/flip-vertical-2.js
var FlipVertical2 = createLucideIcon("FlipVertical2", [
  ["path", { d: "m17 3-5 5-5-5h10", key: "1ftt6x" }],
  ["path", { d: "m17 21-5-5-5 5h10", key: "1m0wmu" }],
  ["path", { d: "M4 12H2", key: "rhcxmi" }],
  ["path", { d: "M10 12H8", key: "s88cx1" }],
  ["path", { d: "M16 12h-2", key: "10asgb" }],
  ["path", { d: "M22 12h-2", key: "14jgyd" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/image-down.js
var ImageDown = createLucideIcon("ImageDown", [
  [
    "path",
    {
      d: "M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21",
      key: "9csbqa"
    }
  ],
  ["path", { d: "m14 19 3 3v-5.5", key: "9ldu5r" }],
  ["path", { d: "m17 22 3-3", key: "1nkfve" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/image-plus.js
var ImagePlus = createLucideIcon("ImagePlus", [
  ["path", { d: "M16 5h6", key: "1vod17" }],
  ["path", { d: "M19 2v6", key: "4bpg5p" }],
  ["path", { d: "M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5", key: "1ue2ih" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/image.js
var Image = createLucideIcon("Image", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", ry: "2", key: "1m3agn" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21", key: "1xmnt7" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/layers.js
var Layers = createLucideIcon("Layers", [
  [
    "path",
    {
      d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
      key: "zw3jo"
    }
  ],
  [
    "path",
    {
      d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
      key: "1wduqc"
    }
  ],
  [
    "path",
    {
      d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
      key: "kqbvx6"
    }
  ]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/maximize.js
var Maximize = createLucideIcon("Maximize", [
  ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3", key: "1dcmit" }],
  ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3", key: "1e4gt3" }],
  ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3", key: "wsl5sc" }],
  ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3", key: "18trek" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/mic.js
var Mic = createLucideIcon("Mic", [
  ["path", { d: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", key: "131961" }],
  ["path", { d: "M19 10v2a7 7 0 0 1-14 0v-2", key: "1vc78b" }],
  ["line", { x1: "12", x2: "12", y1: "19", y2: "22", key: "x3vr5v" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/music.js
var Music = createLucideIcon("Music", [
  ["path", { d: "M9 18V5l12-2v13", key: "1jmyc2" }],
  ["circle", { cx: "6", cy: "18", r: "3", key: "fqmcym" }],
  ["circle", { cx: "18", cy: "16", r: "3", key: "1hluhg" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/paperclip.js
var Paperclip = createLucideIcon("Paperclip", [
  ["path", { d: "M13.234 20.252 21 12.3", key: "1cbrk9" }],
  [
    "path",
    {
      d: "m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486",
      key: "1pkts6"
    }
  ]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/pencil.js
var Pencil = createLucideIcon("Pencil", [
  [
    "path",
    {
      d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      key: "1a8usu"
    }
  ],
  ["path", { d: "m15 5 4 4", key: "1mk7zo" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/pin.js
var Pin = createLucideIcon("Pin", [
  ["path", { d: "M12 17v5", key: "bb1du9" }],
  [
    "path",
    {
      d: "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z",
      key: "1nkz8b"
    }
  ]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/plus.js
var Plus = createLucideIcon("Plus", [
  ["path", { d: "M5 12h14", key: "1ays0h" }],
  ["path", { d: "M12 5v14", key: "s699le" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/rotate-ccw.js
var RotateCcw = createLucideIcon("RotateCcw", [
  ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", key: "1357e3" }],
  ["path", { d: "M3 3v5h5", key: "1xhq8a" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/rotate-cw.js
var RotateCw = createLucideIcon("RotateCw", [
  ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", key: "1p45f6" }],
  ["path", { d: "M21 3v5h-5", key: "1q7to0" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/scissors.js
var Scissors = createLucideIcon("Scissors", [
  ["circle", { cx: "6", cy: "6", r: "3", key: "1lh9wr" }],
  ["path", { d: "M8.12 8.12 12 12", key: "1alkpv" }],
  ["path", { d: "M20 4 8.12 15.88", key: "xgtan2" }],
  ["circle", { cx: "6", cy: "18", r: "3", key: "fqmcym" }],
  ["path", { d: "M14.8 14.8 20 20", key: "ptml3r" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/sparkles.js
var Sparkles = createLucideIcon("Sparkles", [
  [
    "path",
    {
      d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
      key: "4pj2yx"
    }
  ],
  ["path", { d: "M20 3v4", key: "1olli1" }],
  ["path", { d: "M22 5h-4", key: "1gvqau" }],
  ["path", { d: "M4 17v2", key: "vumght" }],
  ["path", { d: "M5 18H3", key: "zchphs" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/square-user.js
var SquareUser = createLucideIcon("SquareUser", [
  ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2", key: "afitv7" }],
  ["circle", { cx: "12", cy: "10", r: "3", key: "ilqhr7" }],
  ["path", { d: "M7 21v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2", key: "1m6ac2" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/wand-sparkles.js
var WandSparkles = createLucideIcon("WandSparkles", [
  [
    "path",
    {
      d: "m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",
      key: "ul74o6"
    }
  ],
  ["path", { d: "m14 7 3 3", key: "1r5n42" }],
  ["path", { d: "M5 6v4", key: "ilb8ba" }],
  ["path", { d: "M19 14v4", key: "blhpug" }],
  ["path", { d: "M10 2v2", key: "7u0qdc" }],
  ["path", { d: "M7 8H3", key: "zfb6yr" }],
  ["path", { d: "M21 16h-4", key: "1cnmox" }],
  ["path", { d: "M11 3H9", key: "1obp7u" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/x.js
var X = createLucideIcon("X", [
  ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
  ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/zoom-in.js
var ZoomIn = createLucideIcon("ZoomIn", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["line", { x1: "21", x2: "16.65", y1: "21", y2: "16.65", key: "13gj7c" }],
  ["line", { x1: "11", x2: "11", y1: "8", y2: "14", key: "1vmskp" }],
  ["line", { x1: "8", x2: "14", y1: "11", y2: "11", key: "durymu" }]
]);

// ../../node_modules/.pnpm/lucide-react@0.470.0_react@19.2.7/node_modules/lucide-react/dist/esm/icons/zoom-out.js
var ZoomOut = createLucideIcon("ZoomOut", [
  ["circle", { cx: "11", cy: "11", r: "8", key: "4ej97u" }],
  ["line", { x1: "21", x2: "16.65", y1: "21", y2: "16.65", key: "13gj7c" }],
  ["line", { x1: "8", x2: "14", y1: "11", y2: "11", key: "durymu" }]
]);

// .pi/web/cls.ts
var PREFIX = "pw-aigc-studio-";
function c(...names) {
  return names.filter((n) => typeof n === "string" && n !== "").map((n) => PREFIX + n).join(" ");
}

// .pi/web/tool-card.tsx
import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
var PHASE_LABEL = {
  start: "Running",
  update: "Streaming",
  end: "Completed",
  error: "Error"
};
function phaseOf(part) {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "start";
    case "output-error":
      return "error";
    case "output-available":
      return part.preliminary === true ? "update" : "end";
    default:
      return "start";
  }
}
function nameOf(part) {
  if (part.type === "dynamic-tool") return typeof part.toolName === "string" ? part.toolName : "tool";
  return typeof part.type === "string" ? part.type.slice("tool-".length) : "tool";
}
function ToolShell({
  part,
  testId,
  children
}) {
  const phase = phaseOf(part);
  const name = nameOf(part);
  const isError = phase === "error";
  const contentId = React2.useId();
  const [override, setOverride] = React2.useState(null);
  const open = override ?? phase !== "start";
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className: "overflow-hidden rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]",
      "data-pi-tool": true,
      "data-pi-tool-phase": phase,
      "data-pi-tool-name": name,
      ...testId !== void 0 ? { "data-testid": testId } : {},
      children: [
        /* @__PURE__ */ jsxs2(
          "button",
          {
            type: "button",
            "aria-expanded": open,
            "aria-controls": contentId,
            onClick: () => setOverride(!open),
            className: "flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
            children: [
              /* @__PURE__ */ jsx3("span", { "aria-hidden": "true", className: "text-[hsl(var(--muted-foreground))]", children: open ? /* @__PURE__ */ jsx3(ChevronDown, { size: 15 }) : /* @__PURE__ */ jsx3(ChevronRight, { size: 15 }) }),
              /* @__PURE__ */ jsx3("span", { className: "font-medium", "data-pi-tool-name-label": true, children: name }),
              /* @__PURE__ */ jsx3(
                "span",
                {
                  className: isError ? "ml-auto inline-flex items-center gap-1 rounded-full bg-[hsl(var(--destructive))] px-2 py-0.5 text-xs text-[hsl(var(--destructive-foreground))]" : "ml-auto inline-flex items-center gap-1 rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-xs text-[hsl(var(--secondary-foreground))]",
                  "data-pi-tool-status": true,
                  children: PHASE_LABEL[phase]
                }
              )
            ]
          }
        ),
        open ? /* @__PURE__ */ jsx3(
          "div",
          {
            id: contentId,
            className: isError ? "border-t border-[hsl(var(--border))] px-3 py-2 text-[hsl(var(--destructive))]" : "border-t border-[hsl(var(--border))] px-3 py-2",
            "data-pi-tool-detail": true,
            children
          }
        ) : null
      ]
    }
  );
}
function JsonBlock({ value }) {
  return /* @__PURE__ */ jsx3("pre", { className: "overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius)] bg-[hsl(var(--muted))] p-2 text-xs", children: /* @__PURE__ */ jsx3("code", { className: "language-json", children: JSON.stringify(value, null, 2) }) });
}
var IMG_MD_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
function attIdFromUrl(url) {
  return /\/attachments\/(att_[^/?#]+)/.exec(url)?.[1];
}
function kindFromMime(mime, url) {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  const lower = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(mp4|webm|mov)$/.test(lower)) return "video";
  if (/\.(mp3|wav|aac|m4a|ogg)$/.test(lower)) return "audio";
  return "image";
}
function joinTextParts(parts) {
  return parts.map((c2) => c2 && typeof c2 === "object" && "text" in c2 ? String(c2.text ?? "") : "").join("\n");
}
function extractText(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return joinTextParts(output);
  if (output && typeof output === "object") {
    const o = output;
    if (o.content !== void 0) return extractText(o.content);
  }
  return "";
}
function plainText(output) {
  return extractText(output).replace(IMG_MD_RE, "").replace(/\n{2,}/g, "\n").trim();
}
function contentOf(output) {
  if (output && typeof output === "object" && !Array.isArray(output) && "content" in output) {
    return output.content;
  }
  return output;
}
function extractAssets(output) {
  if (output && typeof output === "object") {
    const details = output.details;
    if (details && Array.isArray(details.assets)) {
      const out2 = [];
      for (const a of details.assets) {
        const x = a;
        if (typeof x.displayUrl !== "string") continue;
        const mime = typeof x.mimeType === "string" ? x.mimeType : "";
        out2.push({
          name: typeof x.name === "string" ? x.name : "",
          src: x.displayUrl,
          mimeType: mime,
          attId: typeof x.attachmentId === "string" && x.attachmentId ? x.attachmentId : attIdFromUrl(x.displayUrl),
          kind: kindFromMime(mime, x.displayUrl)
        });
      }
      if (out2.length > 0) return out2;
    }
  }
  const text = extractText(output);
  const out = [];
  IMG_MD_RE.lastIndex = 0;
  let m;
  while ((m = IMG_MD_RE.exec(text)) !== null) {
    const src = (m[2] ?? "").trim();
    if (src === "") continue;
    out.push({ name: m[1] ?? "", src, mimeType: "", attId: attIdFromUrl(src), kind: kindFromMime("", src) });
  }
  return out;
}
function openInCanvas(attId) {
  if (attId === void 0) return;
  document.dispatchEvent(new CustomEvent("aigc-open-canvas-asset", { detail: { attachmentId: attId } }));
}
async function downloadOne(src, name) {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name !== "" ? name : "media";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    window.open(src, "_blank", "noreferrer");
  }
}
function MediaCell({ asset }) {
  return /* @__PURE__ */ jsxs2("div", { className: c("imgcard-cell"), children: [
    asset.kind === "video" ? /* @__PURE__ */ jsx3(
      "video",
      {
        src: asset.src,
        controls: true,
        preload: "metadata",
        style: { maxWidth: "100%", borderRadius: 6, display: "block" }
      }
    ) : asset.kind === "audio" ? /* @__PURE__ */ jsx3("audio", { src: asset.src, controls: true, preload: "metadata", style: { width: "100%" } }) : /* @__PURE__ */ jsx3(
      "img",
      {
        src: asset.src,
        alt: asset.name,
        loading: "lazy",
        decoding: "async",
        title: asset.attId !== void 0 ? "\u70B9\u51FB\u5728\u753B\u5E03\u6253\u5F00" : asset.name,
        onClick: () => openInCanvas(asset.attId),
        style: {
          maxWidth: "100%",
          borderRadius: 6,
          display: "block",
          cursor: asset.attId ? "pointer" : "default"
        },
        ...asset.attId !== void 0 ? { "data-att-id": asset.attId } : {}
      }
    ),
    /* @__PURE__ */ jsxs2("div", { className: c("imgcard-acts"), children: [
      asset.kind === "image" && asset.attId !== void 0 ? /* @__PURE__ */ jsx3("button", { type: "button", onClick: () => openInCanvas(asset.attId), title: "\u5728\u753B\u5E03\u6253\u5F00", children: "\u753B\u5E03" }) : null,
      /* @__PURE__ */ jsx3("button", { type: "button", onClick: () => void downloadOne(asset.src, asset.name), title: "\u4E0B\u8F7D", children: "\u4E0B\u8F7D" })
    ] }),
    asset.name !== "" ? /* @__PURE__ */ jsx3("span", { className: c("imgcard-name"), title: asset.name, children: asset.name }) : null
  ] });
}
function MediaGrid({ assets }) {
  return /* @__PURE__ */ jsx3("div", { className: c("imgcard"), children: /* @__PURE__ */ jsx3("div", { className: c("imgcard-grid"), children: assets.map((a, i) => /* @__PURE__ */ jsx3(MediaCell, { asset: a }, `${i}-${a.src.slice(-24)}`)) }) });
}

// .pi/web/image-renderer.tsx
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
function tabStyle(active) {
  return {
    fontSize: 11,
    lineHeight: 1.4,
    padding: "2px 10px",
    borderRadius: 6,
    border: "1px solid #d4d4d8",
    background: active ? "#18181b" : "transparent",
    color: active ? "#fff" : "#71717a",
    cursor: "pointer"
  };
}
function AigcImageRenderer({ part }) {
  const [view, setView] = React3.useState("image");
  const phase = phaseOf(part);
  const assets = React3.useMemo(
    () => phase === "end" || phase === "update" ? extractAssets(part.output) : [],
    [part.output, phase]
  );
  const text = plainText(part.output);
  const errText = typeof part.errorText === "string" ? part.errorText : "";
  return /* @__PURE__ */ jsx4(ToolShell, { part, testId: "aigc-tool-card", children: phase === "error" ? /* @__PURE__ */ jsx4("div", { className: "text-xs", children: errText || text || "\u5931\u8D25" }) : /* @__PURE__ */ jsxs3("div", { className: "space-y-2", children: [
    /* @__PURE__ */ jsxs3("div", { style: { display: "flex", gap: 4, justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ jsx4(
        "button",
        {
          type: "button",
          "data-testid": "aigc-view-image",
          "aria-pressed": view === "image",
          onClick: () => setView("image"),
          style: tabStyle(view === "image"),
          children: "\u56FE\u7247"
        }
      ),
      /* @__PURE__ */ jsx4(
        "button",
        {
          type: "button",
          "data-testid": "aigc-view-json",
          "aria-pressed": view === "json",
          onClick: () => setView("json"),
          style: tabStyle(view === "json"),
          children: "JSON"
        }
      )
    ] }),
    view === "json" ? /* @__PURE__ */ jsx4(JsonBlock, { value: { input: part.input, output: contentOf(part.output) } }) : assets.length > 0 ? /* @__PURE__ */ jsx4(MediaGrid, { assets }) : text !== "" ? /* @__PURE__ */ jsx4("div", { className: "text-xs text-[hsl(var(--foreground))]", children: text }) : null
  ] }) });
}
var imageRendererExtension = defineWebExtension({
  manifestId: "aigc-image-renderer",
  capabilities: ["renderers"],
  renderers: {
    tools: {
      image_generation: AigcImageRenderer,
      image_edit: AigcImageRenderer
    }
  }
});

// .pi/web/media-renderer.tsx
import * as React4 from "react";
import { defineWebExtension as defineWebExtension2 } from "@blksails/pi-web-kit";
import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
function AigcMediaRenderer({ part }) {
  const phase = phaseOf(part);
  const assets = React4.useMemo(
    () => phase === "end" || phase === "update" ? extractAssets(part.output) : [],
    [part.output, phase]
  );
  const text = plainText(part.output);
  const errText = typeof part.errorText === "string" ? part.errorText : "";
  const details = part.output?.details;
  return /* @__PURE__ */ jsx5(ToolShell, { part, testId: "aigc-media-card", children: phase === "error" ? /* @__PURE__ */ jsx5("div", { className: "text-xs", children: errText || text || "\u5931\u8D25" }) : /* @__PURE__ */ jsxs4("div", { className: "space-y-2", children: [
    assets.length > 0 ? /* @__PURE__ */ jsx5(MediaGrid, { assets }) : text !== "" ? /* @__PURE__ */ jsx5("div", { className: "text-xs text-[hsl(var(--foreground))]", children: text }) : null,
    details !== void 0 ? /* @__PURE__ */ jsxs4("details", { className: "text-[11px]", children: [
      /* @__PURE__ */ jsx5("summary", { className: "cursor-pointer select-none text-[hsl(var(--muted-foreground))]", children: "\u8BE6\u60C5" }),
      /* @__PURE__ */ jsx5("pre", { className: "mt-1 overflow-x-auto rounded bg-[hsl(var(--muted))] p-2 font-mono text-[10px]", children: JSON.stringify(details, null, 2) })
    ] }) : null
  ] }) });
}
var MEDIA_TOOL_NAMES = [
  "text_to_video",
  "image_to_video",
  "multimodal_reference_video",
  "video_edit",
  "digital_human_video",
  "text_to_speech",
  "audio_extract",
  "video_concat",
  "video_clip",
  "video_to_gif",
  "video_extract_frame",
  "video_with_audio",
  "video_transcode"
];
var toolRenderers = {};
for (const name of MEDIA_TOOL_NAMES) toolRenderers[name] = AigcMediaRenderer;
var mediaRendererExtension = defineWebExtension2({
  manifestId: "aigc-media-renderer",
  capabilities: ["renderers"],
  renderers: {
    tools: toolRenderers
  }
});

// .pi/web/prompt-toolbar.tsx
import * as React5 from "react";
import { createPortal } from "react-dom";
import { Fragment, jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
var SECTIONS = [
  {
    key: "image",
    label: "\u56FE\u7247",
    tools: [
      { name: "image_generation", label: "\u6587\u751F\u56FE", icon: ImagePlus, params: ["model", "size", "count"] },
      { name: "image_edit", label: "\u56FE\u50CF\u7F16\u8F91", icon: WandSparkles, params: ["model", "size", "count"] }
    ]
  },
  {
    key: "video",
    label: "\u89C6\u9891\u751F\u6210",
    tools: [
      { name: "text_to_video", label: "\u6587\u751F\u89C6\u9891", icon: Clapperboard },
      { name: "image_to_video", label: "\u56FE\u751F\u89C6\u9891", icon: Film },
      { name: "multimodal_reference_video", label: "\u591A\u6A21\u6001\u53C2\u8003\u751F\u89C6\u9891", icon: Layers },
      { name: "video_edit", label: "\u89C6\u9891\u7F16\u8F91", icon: Scissors },
      { name: "digital_human_video", label: "\u6570\u5B57\u4EBA\u5BF9\u53E3\u578B", icon: SquareUser },
      { name: "text_to_speech", label: "\u6587\u672C\u8F6C\u8BED\u97F3", icon: Mic }
    ]
  },
  {
    key: "media",
    label: "\u591A\u5A92\u4F53\u5904\u7406",
    tools: [
      { name: "video_concat", label: "\u89C6\u9891\u62FC\u63A5", icon: Combine },
      { name: "video_clip", label: "\u89C6\u9891\u622A\u7247", icon: Scissors },
      { name: "video_to_gif", label: "\u89C6\u9891\u8F6C GIF", icon: Image },
      { name: "video_extract_frame", label: "\u622A\u53D6\u9759\u5E27", icon: ImageDown },
      { name: "video_with_audio", label: "\u89C6\u9891\u5957\u97F3\u8F68", icon: Music },
      { name: "video_transcode", label: "\u89C6\u9891\u8F6C\u7801", icon: FileVideo },
      { name: "audio_extract", label: "\u97F3\u8F68\u63D0\u53D6", icon: AudioLines }
    ]
  }
];
var ALL_TOOLS = SECTIONS.flatMap((s) => s.tools);
var toolByName = new Map(ALL_TOOLS.map((t) => [t.name, t]));
var MAX_PINS = 5;
var PINS_LS_KEY = "pi-web.aigc.toolpins";
var DEFAULT_PINS = ["image_generation", "image_edit", "text_to_video"];
var DEFAULT_SKILLS = [
  { name: "creative-nine-grid-pro", label: "\u4E5D\u5BAB\u683C\u521B\u4F5C", description: "\u4E5D\u5BAB\u683C\u5B9A\u4F4D\u4E0E\u6392\u7248" }
];
var FALLBACK_MODELS = ["gpt-image-2", "qwen-image-2.0"];
var FALLBACK_SIZES = ["1024x1024", "1536x1024", "1024x1536", "auto"];
var COUNTS = [1, 2, 4];
var PROVIDER_COLORS = {
  NewAPI: "#f59e0b",
  sufy: "#f97316",
  OpenRouter: "#6366f1",
  Cloudflare: "#f97316"
};
function modelDisplay(label) {
  const [name, provider] = label.split(/\s+·\s+/, 2);
  return { name: name ?? label, ...provider !== void 0 ? { provider } : {} };
}
function asSkills(raw) {
  if (!Array.isArray(raw)) return DEFAULT_SKILLS;
  const skills = raw.filter((item) => {
    if (typeof item !== "object" || item === null) return false;
    const value = item;
    return typeof value.name === "string" && typeof value.label === "string";
  });
  return skills.length > 0 ? skills : DEFAULT_SKILLS;
}
var PROMPT_TOOLBAR_CSS = `
[data-pi-attachments-add]{display:none!important}
[data-aigc-prompt-toolbar]{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.pw-aigc-studio-qp{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:1px solid hsl(var(--border));border-radius:999px;background:hsl(var(--background));color:hsl(var(--muted-foreground));font-size:12px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.pw-aigc-studio-qp:hover{background:hsl(var(--muted));color:hsl(var(--foreground))}
.pw-aigc-studio-qp.pw-aigc-studio-on{border-color:transparent;background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
.pw-aigc-studio-skill{background:hsl(var(--background));color:hsl(var(--foreground))}
.pw-aigc-studio-skill-pop{min-width:220px}
.pw-aigc-studio-skill-pop button{display:flex;align-items:flex-start;gap:8px;width:100%;padding:8px 9px;border-radius:7px;font-size:12.5px;text-align:left}
.pw-aigc-studio-skill-pop button:hover:not(:disabled),.pw-aigc-studio-skill-pop button.pw-aigc-studio-on{background:hsl(var(--muted));color:hsl(var(--foreground))}
.pw-aigc-studio-skill-pop button b{display:block;font-weight:600}
.pw-aigc-studio-skill-pop button small{display:block;margin-top:2px;color:hsl(var(--muted-foreground));font-size:10.5px}
.pw-aigc-studio-tool-plus{order:-1;padding:0 7px}
.pw-aigc-studio-intent-x{display:inline-flex;margin-left:2px;padding:0;border:0;background:none;color:inherit;cursor:pointer;opacity:.75}
.pw-aigc-studio-pop-backdrop{position:fixed;inset:0;z-index:70}
.pw-aigc-studio-pop{position:fixed;z-index:71;display:flex;flex-direction:column;gap:1px;min-width:132px;padding:4px;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--popover));color:hsl(var(--popover-foreground));box-shadow:0 10px 30px rgb(0 0 0/.18)}
.pw-aigc-studio-pop button{border:0;background:none;color:inherit;cursor:pointer}
.pw-aigc-studio-pop button:hover:not(:disabled){background:hsl(var(--muted))}
.pw-aigc-studio-menu-sec,.pw-aigc-studio-pop-title{padding:6px 9px 2px;color:hsl(var(--muted-foreground));font-size:10.5px;letter-spacing:.04em}
.pw-aigc-studio-menu-item{display:flex;align-items:center}
.pw-aigc-studio-menu-row{display:inline-flex;flex:1;align-items:center;gap:8px;min-width:0;padding:6px 9px;border-radius:7px;font-size:12.5px;text-align:left}
.pw-aigc-studio-menu-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-aigc-studio-menu-pin{flex:none;margin-right:4px;padding:4px;border-radius:5px;color:hsl(var(--muted-foreground));opacity:0}
.pw-aigc-studio-menu-item:hover .pw-aigc-studio-menu-pin,.pw-aigc-studio-menu-pin.pw-aigc-studio-on{opacity:1}
.pw-aigc-studio-pill-pop{max-height:320px;overflow-y:auto}
.pw-aigc-studio-pill-pop button{display:flex;width:100%;align-items:center;justify-content:flex-start;padding:8px 10px;border-radius:7px;font-size:13px;line-height:1.3;text-align:left;white-space:nowrap}
.pw-aigc-studio-pill-pop button:hover:not(:disabled){background:hsl(var(--muted));color:hsl(var(--foreground))}
.pw-aigc-studio-pill-pop button.pw-aigc-studio-on{background:hsl(var(--accent));color:hsl(var(--accent-foreground));font-weight:600}
.pw-aigc-studio-pill-pop .pw-aigc-studio-hint{margin-left:auto;padding-left:12px;color:hsl(var(--muted-foreground));font-size:10.5px}
.pw-aigc-studio-model-badge{display:grid;flex:none;width:16px;height:16px;place-items:center;border-radius:4px;color:#fff;font-size:9px;font-weight:700;line-height:1}
.pw-aigc-studio-model-name{min-width:0;overflow:hidden;text-overflow:ellipsis}
`;
function useStateKey(state, key) {
  const subscribe = React5.useCallback((cb) => state.subscribe(key, cb), [state, key]);
  const getSnapshot = React5.useCallback(() => state.get(key), [state, key]);
  return React5.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
function asStrings(raw, fallback) {
  return Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === "string") ? raw : fallback;
}
function sizeShort(size) {
  if (size === void 0 || size === "") return "\u8DDF\u968F";
  if (size === "auto") return "\u81EA\u9002\u5E94";
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
  if (m === null) return size;
  return m[1] === m[2] ? `${m[1]}\xB2` : `${m[1]}\xD7${m[2]}`;
}
function triggerUpload() {
  document.querySelector("[data-pi-attachments-input]")?.click();
}
function useFitPos(x, y) {
  const ref = React5.useRef(null);
  const [pos, setPos] = React5.useState({ left: x, top: y });
  React5.useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return void 0;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      const pad = 8;
      setPos({
        left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)),
        top: y + height > window.innerHeight - pad ? Math.max(pad, window.innerHeight - height - pad) : y
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [x, y]);
  return { ref, style: { left: pos.left, top: pos.top } };
}
function Pop({
  anchor,
  onClose,
  width,
  className,
  children
}) {
  const fit = useFitPos(anchor.x, anchor.y);
  return createPortal(
    /* @__PURE__ */ jsxs5(Fragment, { children: [
      /* @__PURE__ */ jsx6("div", { className: c("pop-backdrop"), onClick: onClose }),
      /* @__PURE__ */ jsx6(
        "div",
        {
          ref: fit.ref,
          className: className !== void 0 ? `${c("pop")} ${className}` : c("pop"),
          style: { ...fit.style, minWidth: width },
          onClick: (e) => e.stopPropagation(),
          children
        }
      )
    ] }),
    document.body
  );
}
function AigcPromptToolbar(props) {
  const { state } = props;
  const [composerToolbar, setComposerToolbar] = React5.useState(null);
  const [menu, setMenu] = React5.useState(null);
  const [skillMenu, setSkillMenu] = React5.useState(null);
  const [param, setParam] = React5.useState(null);
  const [targeted, setTargeted] = React5.useState(null);
  const [pins, setPins] = React5.useState(DEFAULT_PINS);
  React5.useEffect(() => {
    setComposerToolbar(document.querySelector("[data-pi-prompt-input-toolbar]"));
  }, []);
  React5.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINS_LS_KEY);
      if (raw !== null) {
        const arr = JSON.parse(raw).filter((n) => toolByName.has(n));
        if (arr.length > 0) setPins(arr);
      }
    } catch {
    }
  }, []);
  const noopState = React5.useMemo(
    () => ({ get: () => void 0, set: async () => {
    }, delete: async () => {
    }, subscribe: () => () => {
    } }),
    []
  );
  const st = state ?? noopState;
  const models = asStrings(useStateKey(st, "aigc.models"), FALLBACK_MODELS);
  const sizes = asStrings(useStateKey(st, "aigc.sizes"), FALLBACK_SIZES);
  const labelsRaw = useStateKey(st, "aigc.modelLabels");
  const labels = typeof labelsRaw === "object" && labelsRaw !== null ? labelsRaw : {};
  const model = useStateKey(st, "aigc.model");
  const size = useStateKey(st, "aigc.size");
  const countRaw = useStateKey(st, "aigc.count");
  const count = typeof countRaw === "number" ? countRaw : 1;
  const skills = asSkills(useStateKey(st, "aigc.skills"));
  const activeSkill = useStateKey(st, "aigc.skill");
  const activeSkillName = typeof activeSkill === "string" ? activeSkill : "";
  const activeSkillDef = skills.find((skill) => skill.name === activeSkillName);
  const setSticky = React5.useCallback(
    (key, val) => {
      void st.set(key, val);
      try {
        localStorage.setItem(`pi-web.${key}`, JSON.stringify(val));
      } catch {
      }
    },
    [st]
  );
  const togglePin = React5.useCallback((name) => {
    setPins((prev) => {
      const has = prev.includes(name);
      const next = has ? prev.filter((n) => n !== name) : prev.length >= MAX_PINS ? prev : [...prev, name];
      try {
        localStorage.setItem(PINS_LS_KEY, JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }, []);
  const pickTool = React5.useCallback(
    (name) => {
      setTargeted(name);
      void st.set("aigc.targetedTool", name);
      setMenu(null);
    },
    [st]
  );
  const clearTarget = React5.useCallback(() => {
    setTargeted(null);
    void st.set("aigc.targetedTool", "");
  }, [st]);
  if (state === void 0) return null;
  const targetedTool = targeted !== null ? toolByName.get(targeted) : void 0;
  const modelLabel = typeof model === "string" && model !== "" ? labels[model] ?? model : "\u9ED8\u8BA4";
  const idlePills = (pins.length > 0 ? pins : DEFAULT_PINS).map((n) => toolByName.get(n)).filter((t) => t !== void 0).slice(0, MAX_PINS);
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4 });
  };
  const openSkillMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSkillMenu({ x: r.left, y: r.bottom + 4 });
  };
  const selectSkill = (name) => {
    void st.set("aigc.skill", name);
    setSkillMenu(null);
  };
  const openParam = (kind, e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setParam({ kind, x: r.left, y: r.bottom + 4 });
  };
  const plusButton = /* @__PURE__ */ jsx6(
    "button",
    {
      type: "button",
      className: c("qp", "tool-plus"),
      "aria-label": "\u5DE5\u5177\u4E0E\u6DFB\u52A0\u9644\u4EF6",
      title: "\u5DE5\u5177 / \u6DFB\u52A0\u9644\u4EF6",
      onClick: openMenu,
      children: /* @__PURE__ */ jsx6(Plus, { size: 14 })
    }
  );
  return /* @__PURE__ */ jsxs5("span", { className: c("ptb"), "data-aigc-prompt-toolbar": true, children: [
    /* @__PURE__ */ jsx6("style", { children: PROMPT_TOOLBAR_CSS }),
    composerToolbar !== null ? createPortal(plusButton, composerToolbar) : plusButton,
    /* @__PURE__ */ jsxs5(
      "button",
      {
        type: "button",
        className: c("qp", "skill", activeSkillDef !== void 0 ? "on" : void 0),
        "aria-label": "\u6280\u80FD\u7BA1\u7406",
        "aria-expanded": skillMenu !== null,
        onClick: openSkillMenu,
        children: [
          /* @__PURE__ */ jsx6(Sparkles, { size: 13 }),
          " ",
          activeSkillDef?.label ?? "\u6280\u80FD\u7BA1\u7406",
          " ",
          /* @__PURE__ */ jsx6(ChevronDown, { size: 12 })
        ]
      }
    ),
    targetedTool !== void 0 ? /* @__PURE__ */ jsxs5(Fragment, { children: [
      /* @__PURE__ */ jsxs5("span", { className: c("qp", "on", "intent"), children: [
        /* @__PURE__ */ jsx6(targetedTool.icon, { size: 13 }),
        /* @__PURE__ */ jsx6("b", { children: targetedTool.label }),
        /* @__PURE__ */ jsx6("button", { type: "button", className: c("intent-x"), title: "\u53D6\u6D88\u9009\u4E2D", onClick: clearTarget, children: /* @__PURE__ */ jsx6(X, { size: 12 }) })
      ] }),
      targetedTool.params?.includes("model") === true ? /* @__PURE__ */ jsxs5(
        "button",
        {
          type: "button",
          className: c("qp"),
          onClick: (e) => openParam("model", e),
          title: typeof model === "string" ? model : "\u9ED8\u8BA4\u6A21\u578B",
          children: [
            "\u6A21\u578B ",
            /* @__PURE__ */ jsx6("b", { children: modelLabel }),
            " ",
            /* @__PURE__ */ jsx6(ChevronDown, { size: 12, className: c("chev") })
          ]
        }
      ) : null,
      targetedTool.params?.includes("size") === true ? /* @__PURE__ */ jsxs5("button", { type: "button", className: c("qp"), onClick: (e) => openParam("size", e), children: [
        "\u5C3A\u5BF8 ",
        /* @__PURE__ */ jsx6("b", { children: sizeShort(typeof size === "string" ? size : void 0) }),
        " ",
        /* @__PURE__ */ jsx6(ChevronDown, { size: 12, className: c("chev") })
      ] }) : null,
      targetedTool.params?.includes("count") === true ? /* @__PURE__ */ jsxs5("button", { type: "button", className: c("qp"), onClick: (e) => openParam("count", e), children: [
        "\u6570\u91CF ",
        /* @__PURE__ */ jsx6("b", { children: count }),
        " ",
        /* @__PURE__ */ jsx6(ChevronDown, { size: 12, className: c("chev") })
      ] }) : null
    ] }) : (
      // 空闲态:已固定 / 默认工具的快捷 pill
      idlePills.map((t) => /* @__PURE__ */ jsxs5("button", { type: "button", className: c("qp"), onClick: () => pickTool(t.name), children: [
        /* @__PURE__ */ jsx6(t.icon, { size: 13 }),
        " ",
        t.label
      ] }, t.name))
    ),
    skillMenu !== null ? /* @__PURE__ */ jsxs5(Pop, { anchor: skillMenu, width: 240, className: c("skill-pop"), onClose: () => setSkillMenu(null), children: [
      /* @__PURE__ */ jsx6("div", { className: c("pop-title"), children: "\u6280\u80FD \xB7 \u70B9\u9009\u542F\u7528" }),
      skills.map((skill) => /* @__PURE__ */ jsxs5(
        "button",
        {
          type: "button",
          className: activeSkillName === skill.name ? c("on") : void 0,
          onClick: () => selectSkill(skill.name),
          children: [
            /* @__PURE__ */ jsx6(Sparkles, { size: 14 }),
            /* @__PURE__ */ jsxs5("span", { children: [
              /* @__PURE__ */ jsx6("b", { children: skill.label }),
              skill.description !== void 0 ? /* @__PURE__ */ jsx6("small", { children: skill.description }) : null
            ] })
          ]
        },
        skill.name
      ))
    ] }) : null,
    menu !== null ? /* @__PURE__ */ jsxs5(Pop, { anchor: menu, width: 230, onClose: () => setMenu(null), children: [
      /* @__PURE__ */ jsxs5(
        "button",
        {
          type: "button",
          className: c("menu-row"),
          onClick: () => {
            triggerUpload();
            setMenu(null);
          },
          children: [
            /* @__PURE__ */ jsx6(Paperclip, { size: 14 }),
            " ",
            /* @__PURE__ */ jsx6("span", { children: "\u6DFB\u52A0\u9644\u4EF6" })
          ]
        }
      ),
      SECTIONS.map((sec) => /* @__PURE__ */ jsxs5("div", { children: [
        /* @__PURE__ */ jsx6("div", { className: c("menu-sec"), children: sec.label }),
        sec.tools.map((t) => {
          const pinned = pins.includes(t.name);
          const canPin = pinned || pins.length < MAX_PINS;
          return /* @__PURE__ */ jsxs5("div", { className: c("menu-item"), children: [
            /* @__PURE__ */ jsxs5("button", { type: "button", className: c("menu-row"), onClick: () => pickTool(t.name), children: [
              /* @__PURE__ */ jsx6(t.icon, { size: 14 }),
              " ",
              /* @__PURE__ */ jsx6("span", { children: t.label })
            ] }),
            /* @__PURE__ */ jsx6(
              "button",
              {
                type: "button",
                className: pinned ? c("menu-pin", "on") : c("menu-pin"),
                title: pinned ? "\u53D6\u6D88\u56FA\u5B9A" : canPin ? "\u56FA\u5B9A\u5230\u5FEB\u6377\u680F" : `\u6700\u591A\u56FA\u5B9A ${MAX_PINS} \u4E2A`,
                disabled: !canPin,
                onClick: (e) => {
                  e.stopPropagation();
                  togglePin(t.name);
                },
                children: /* @__PURE__ */ jsx6(Pin, { size: 12, fill: pinned ? "currentColor" : "none" })
              }
            )
          ] }, t.name);
        })
      ] }, sec.key))
    ] }) : null,
    param !== null ? /* @__PURE__ */ jsx6(Pop, { anchor: param, width: param.kind === "model" ? 292 : 210, className: c("pill-pop"), onClose: () => setParam(null), children: param.kind === "model" ? /* @__PURE__ */ jsxs5(Fragment, { children: [
      /* @__PURE__ */ jsx6("div", { className: c("pop-title"), children: "\u56FE\u50CF\u6A21\u578B" }),
      models.map((m) => {
        const display = modelDisplay(labels[m] ?? m);
        return /* @__PURE__ */ jsxs5(
          "button",
          {
            type: "button",
            className: model === m ? c("on") : void 0,
            title: labels[m] ?? m,
            onClick: () => {
              setSticky("aigc.model", m);
              setParam(null);
            },
            children: [
              /* @__PURE__ */ jsx6(
                "span",
                {
                  className: c("model-badge"),
                  style: { background: PROVIDER_COLORS[display.provider ?? ""] ?? "#64748b" },
                  "aria-hidden": true,
                  children: (display.provider ?? display.name).slice(0, 1).toUpperCase()
                }
              ),
              /* @__PURE__ */ jsx6("span", { className: c("model-name"), children: display.name })
            ]
          },
          m
        );
      })
    ] }) : param.kind === "size" ? /* @__PURE__ */ jsxs5(Fragment, { children: [
      /* @__PURE__ */ jsx6("div", { className: c("pop-title"), children: "\u8F93\u51FA\u5C3A\u5BF8" }),
      sizes.map((s) => /* @__PURE__ */ jsxs5(
        "button",
        {
          type: "button",
          className: size === s ? c("on") : void 0,
          onClick: () => {
            setSticky("aigc.size", s);
            setParam(null);
          },
          children: [
            sizeShort(s),
            " ",
            /* @__PURE__ */ jsx6("span", { className: c("hint"), children: s })
          ]
        },
        s
      ))
    ] }) : /* @__PURE__ */ jsxs5(Fragment, { children: [
      /* @__PURE__ */ jsx6("div", { className: c("pop-title"), children: "\u751F\u6210\u6570\u91CF" }),
      COUNTS.map((n) => /* @__PURE__ */ jsxs5(
        "button",
        {
          type: "button",
          className: count === n ? c("on") : void 0,
          onClick: () => {
            setSticky("aigc.count", n);
            setParam(null);
          },
          children: [
            "\xD7",
            n
          ]
        },
        n
      ))
    ] }) }) : null
  ] });
}

// .pi/web/media-preview-host.tsx
import * as React6 from "react";
import { createPortal as createPortal2 } from "react-dom";
import { Fragment as Fragment2, jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
var MEDIA_PREVIEW_EVENT = "aigc-media-preview";
var PREVIEW_IMG_SELECTOR = "[data-pi-response] img, [data-pi-tool-images] img";
var MESSAGES_SELECTOR = "[data-pi-chat-messages]";
var ZOOM_MIN = 0.2;
var ZOOM_MAX = 8;
function attachmentIdFromUrl(url) {
  return /\/attachments\/(att_[^/?#]+)/.exec(url)?.[1];
}
async function downloadImage(url, name) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name !== "" ? name : "image";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noreferrer");
  }
}
var srcOf = (el) => el.currentSrc !== "" ? el.currentSrc : el.src;
function MediaLightbox({
  items,
  index,
  onIndex,
  onClose
}) {
  const cur = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const [scale, setScale] = React6.useState(1);
  const [rot, setRot] = React6.useState(0);
  const [flipH, setFlipH] = React6.useState(false);
  const [flipV, setFlipV] = React6.useState(false);
  const [pan, setPan] = React6.useState({ x: 0, y: 0 });
  const [dims, setDims] = React6.useState(null);
  const drag = React6.useRef(null);
  const reset = React6.useCallback(() => {
    setScale(1);
    setRot(0);
    setFlipH(false);
    setFlipV(false);
    setPan({ x: 0, y: 0 });
  }, []);
  React6.useEffect(() => reset(), [cur?.url, reset]);
  React6.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) onIndex(index - 1);
      else if (e.key === "ArrowRight" && hasNext) onIndex(index + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onIndex, onClose]);
  if (cur === void 0) return null;
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale * (flipH ? -1 : 1)}, ${scale * (flipV ? -1 : 1)}) rotate(${rot}deg)`;
  return createPortal2(
    /* @__PURE__ */ jsxs6("div", { className: c("ilb"), role: "dialog", "aria-modal": "true", onClick: onClose, children: [
      /* @__PURE__ */ jsx7("button", { type: "button", className: c("ilb-x"), "aria-label": "\u5173\u95ED\u9884\u89C8", onClick: onClose, children: /* @__PURE__ */ jsx7(X, { size: 18 }) }),
      hasPrev ? /* @__PURE__ */ jsx7(
        "button",
        {
          type: "button",
          className: `${c("ilb-nav")} ${c("left")}`,
          "aria-label": "\u4E0A\u4E00\u5F20",
          onClick: (e) => {
            e.stopPropagation();
            onIndex(index - 1);
          },
          children: /* @__PURE__ */ jsx7(ChevronLeft, { size: 26 })
        }
      ) : null,
      hasNext ? /* @__PURE__ */ jsx7(
        "button",
        {
          type: "button",
          className: `${c("ilb-nav")} ${c("right")}`,
          "aria-label": "\u4E0B\u4E00\u5F20",
          onClick: (e) => {
            e.stopPropagation();
            onIndex(index + 1);
          },
          children: /* @__PURE__ */ jsx7(ChevronRight, { size: 26 })
        }
      ) : null,
      /* @__PURE__ */ jsx7(
        "div",
        {
          className: c("ilb-stage"),
          onClick: (e) => e.stopPropagation(),
          onWheel: (e) => {
            setScale(
              (s) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
            );
          },
          children: /* @__PURE__ */ jsx7(
            "img",
            {
              className: c("ilb-img"),
              src: cur.url,
              alt: cur.name ?? "",
              draggable: false,
              referrerPolicy: "no-referrer",
              style: { transform, cursor: scale > 1 ? "grab" : "default" },
              onPointerDown: (e) => {
                if (scale <= 1) return;
                e.target.setPointerCapture?.(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
              },
              onPointerMove: (e) => {
                const d = drag.current;
                if (d === null) return;
                setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
              },
              onPointerUp: () => {
                drag.current = null;
              },
              onLoad: (e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          )
        }
      ),
      /* @__PURE__ */ jsxs6("div", { className: c("ilb-tools"), onClick: (e) => e.stopPropagation(), children: [
        /* @__PURE__ */ jsx7(
          "button",
          {
            type: "button",
            title: "\u7F29\u5C0F",
            onClick: () => setScale((s) => Math.max(ZOOM_MIN, s / 1.2)),
            children: /* @__PURE__ */ jsx7(ZoomOut, { size: 16 })
          }
        ),
        /* @__PURE__ */ jsxs6("span", { className: c("pct"), children: [
          Math.round(scale * 100),
          "%"
        ] }),
        /* @__PURE__ */ jsx7(
          "button",
          {
            type: "button",
            title: "\u653E\u5927",
            onClick: () => setScale((s) => Math.min(ZOOM_MAX, s * 1.2)),
            children: /* @__PURE__ */ jsx7(ZoomIn, { size: 16 })
          }
        ),
        /* @__PURE__ */ jsx7("span", { className: c("sep") }),
        /* @__PURE__ */ jsx7("button", { type: "button", title: "\u9006\u65F6\u9488\u65CB\u8F6C", onClick: () => setRot((r) => r - 90), children: /* @__PURE__ */ jsx7(RotateCcw, { size: 16 }) }),
        /* @__PURE__ */ jsx7("button", { type: "button", title: "\u987A\u65F6\u9488\u65CB\u8F6C", onClick: () => setRot((r) => r + 90), children: /* @__PURE__ */ jsx7(RotateCw, { size: 16 }) }),
        /* @__PURE__ */ jsx7(
          "button",
          {
            type: "button",
            title: "\u6C34\u5E73\u7FFB\u8F6C",
            className: flipH ? c("on") : void 0,
            onClick: () => setFlipH((v) => !v),
            children: /* @__PURE__ */ jsx7(FlipHorizontal2, { size: 16 })
          }
        ),
        /* @__PURE__ */ jsx7(
          "button",
          {
            type: "button",
            title: "\u5782\u76F4\u7FFB\u8F6C",
            className: flipV ? c("on") : void 0,
            onClick: () => setFlipV((v) => !v),
            children: /* @__PURE__ */ jsx7(FlipVertical2, { size: 16 })
          }
        ),
        /* @__PURE__ */ jsx7("span", { className: c("sep") }),
        /* @__PURE__ */ jsx7("button", { type: "button", title: "\u590D\u4F4D", onClick: reset, children: /* @__PURE__ */ jsx7(Maximize, { size: 16 }) }),
        /* @__PURE__ */ jsx7("span", { className: c("sep") }),
        /* @__PURE__ */ jsx7(
          "button",
          {
            type: "button",
            title: "\u4E0B\u8F7D",
            onClick: () => void downloadImage(cur.url, cur.name ?? "image"),
            children: /* @__PURE__ */ jsx7(Download, { size: 16 })
          }
        )
      ] }),
      items.length > 1 ? /* @__PURE__ */ jsxs6("div", { className: c("ilb-count"), children: [
        index + 1,
        " / ",
        items.length
      ] }) : null,
      dims !== null ? /* @__PURE__ */ jsxs6("div", { className: c("ilb-dims"), children: [
        dims.w,
        "\xD7",
        dims.h
      ] }) : null
    ] }),
    document.body
  );
}
function MediaPreviewHost(props) {
  const { conversation } = props;
  const [state, setState] = React6.useState(null);
  const [pill, setPill] = React6.useState(null);
  const hideTimer = React6.useRef(null);
  React6.useEffect(() => {
    const onEvt = (e) => {
      const d = e.detail;
      if (d.gallery !== void 0 && d.gallery.length > 0) {
        setState({
          items: [...d.gallery],
          index: Math.min(Math.max(d.index ?? 0, 0), d.gallery.length - 1)
        });
      } else if (d.url !== void 0) {
        setState({ items: [{ url: d.url }], index: 0 });
      }
    };
    window.addEventListener(MEDIA_PREVIEW_EVENT, onEvt);
    return () => window.removeEventListener(MEDIA_PREVIEW_EVENT, onEvt);
  }, []);
  React6.useEffect(() => {
    const onClick = (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target;
      const img = target?.closest("img");
      if (img === null || img === void 0 || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      if (target?.closest("button, a") !== null) return;
      e.preventDefault();
      e.stopPropagation();
      const scope = img.closest(MESSAGES_SELECTOR) ?? document;
      const all = [...scope.querySelectorAll(PREVIEW_IMG_SELECTOR)];
      setState({
        items: all.map((el) => ({ url: srcOf(el), name: el.alt })),
        index: Math.max(0, all.indexOf(img))
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  React6.useEffect(() => {
    const cancelHide = () => {
      if (hideTimer.current !== null) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
    const onOver = (e) => {
      const img = e.target?.closest("img");
      if (img === null || img === void 0 || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      cancelHide();
      const r = img.getBoundingClientRect();
      const container = img.closest("[data-pi-response], [data-pi-tool-images]");
      const sibs = container !== null ? [...container.querySelectorAll("img")] : [img];
      setPill({
        url: srcOf(img),
        name: img.alt,
        rect: { top: r.top, right: r.right },
        siblings: sibs.map((el) => ({ url: srcOf(el), name: el.alt }))
      });
    };
    const onOut = (e) => {
      const img = e.target?.closest("img");
      if (img === null || img === void 0 || !img.matches(PREVIEW_IMG_SELECTOR)) return;
      cancelHide();
      hideTimer.current = setTimeout(() => setPill(null), 160);
    };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    return () => {
      cancelHide();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
    };
  }, []);
  const onIndex = React6.useCallback(
    (i) => setState((s) => s !== null ? { ...s, index: i } : s),
    []
  );
  const editInCanvas = (url) => {
    const attId = attachmentIdFromUrl(url);
    if (attId === void 0 || conversation === void 0) return;
    setPill(null);
    conversation.submitUserMessage("\u628A\u8FD9\u5F20\u56FE\u653E\u5230\u753B\u5E03\u4E0A,\u6211\u8981\u7F16\u8F91", { attachmentIds: [attId] });
  };
  const canEdit = pill !== null && conversation !== void 0 && attachmentIdFromUrl(pill.url) !== void 0;
  return /* @__PURE__ */ jsxs6(Fragment2, { children: [
    pill !== null ? createPortal2(
      /* @__PURE__ */ jsxs6(
        "div",
        {
          className: c("img-pill"),
          style: {
            top: pill.rect.top + 8,
            left: Math.min(pill.rect.right - 8, window.innerWidth - 8)
          },
          onMouseEnter: () => {
            if (hideTimer.current !== null) {
              clearTimeout(hideTimer.current);
              hideTimer.current = null;
            }
          },
          onMouseLeave: () => setPill(null),
          children: [
            canEdit ? /* @__PURE__ */ jsxs6(
              "button",
              {
                type: "button",
                title: "\u5728\u753B\u5E03\u7F16\u8F91(\u7ECF\u5BF9\u8BDD\u4EA4\u7ED9\u52A9\u624B)",
                onClick: () => editInCanvas(pill.url),
                children: [
                  /* @__PURE__ */ jsx7(Pencil, { size: 13 }),
                  " \u7F16\u8F91"
                ]
              }
            ) : null,
            /* @__PURE__ */ jsxs6(
              "button",
              {
                type: "button",
                title: "\u4E0B\u8F7D",
                onClick: () => void downloadImage(pill.url, pill.name),
                children: [
                  /* @__PURE__ */ jsx7(Download, { size: 13 }),
                  " \u4E0B\u8F7D"
                ]
              }
            ),
            pill.siblings.length > 1 ? /* @__PURE__ */ jsxs6(
              "button",
              {
                type: "button",
                title: "\u4E0B\u8F7D\u672C\u5361\u5168\u90E8",
                onClick: () => {
                  const all = pill.siblings;
                  void (async () => {
                    for (const s of all) await downloadImage(s.url, s.name ?? "image");
                  })();
                },
                children: [
                  "\u4E0B\u8F7D\u5168\u90E8 ",
                  pill.siblings.length
                ]
              }
            ) : null
          ]
        }
      ),
      document.body
    ) : null,
    state !== null ? /* @__PURE__ */ jsx7(
      MediaLightbox,
      {
        items: state.items,
        index: state.index,
        onIndex,
        onClose: () => setState(null)
      }
    ) : null
  ] });
}

// .pi/web/web.config.tsx
var MAX_PANE_INSTANCES = 2;
var extensionReload = new URL(import.meta.url).searchParams.get("t");
function paneDocumentUrl(paneId) {
  const url = new URL(`./pane-${paneId}.html`, import.meta.url);
  if (extensionReload !== null) url.searchParams.set("t", extensionReload);
  return url.href;
}
var aigcPanesDefinition = definePanes({
  id: AIGC_PANES_ID,
  initialPaneIds: [...aigcPaneModules.map((pane) => pane.id), LOGS_PANE_ID],
  maxOpenPanes: (aigcPaneModules.length + 1) * MAX_PANE_INSTANCES,
  panes: [
    ...aigcPaneModules.map(
      ({ entry: _entry, canvasStyles: _canvasStyles, ...pane }) => definePaneDefinition({
        ...pane,
        allowMultiple: true,
        maxInstances: MAX_PANE_INSTANCES,
        document: {
          kind: "html",
          src: paneDocumentUrl(pane.id)
        }
      })
    ),
    definePaneDefinition({
      id: LOGS_PANE_ID,
      title: "\u65E5\u5FD7",
      icon: "scroll-text",
      allowMultiple: true,
      maxInstances: MAX_PANE_INSTANCES,
      document: { kind: "html", src: paneDocumentUrl(LOGS_PANE_ID) },
      capabilities: {
        routes: [{ name: "session.logs", methods: ["GET"], maxResponseBytes: 2 * 1024 * 1024 }]
      }
    })
  ]
});
var panesConfig = {
  ...AIGC_PANES_CONFIG,
  // 旧键缺日志；升版令四个宿主 WebView 均按 initialPaneIds 首次展开。
  persistenceKey: "pi-web:agic-video-studio:panes:v1"
};
var web_config_default = defineWebExtension3({
  manifestId: "agic-video-studio",
  capabilities: ["slots", "renderers", "config"],
  config: {
    ...AIGC_AGENT_PANEL_CONFIG,
    empty: {
      title: "\u89C6\u9891\u5DE5\u4F5C\u5BA4",
      subtitle: "\u4ECE\u521B\u610F\u7B80\u62A5\u62C6\u955C\u5934\uFF0C\u9010\u955C\u5934\u751F\u6210\u3001\u5B9E\u65F6\u4ECB\u5165\u3001\u590D\u6838\u5E76\u5BFC\u51FA\uFF1B\u56FE\u50CF\u4E0E\u5A92\u4F53\u5DE5\u5177\u53EF\u4F5C\u53C2\u8003\u7D20\u6750\u3002",
      starters: [
        { id: "video-plan", label: "\u62C6\u89C6\u9891\u955C\u5934", value: "\u628A\u8FD9\u4E2A\u521B\u610F\u62C6\u6210 15 \u79D2\u89C6\u9891\u955C\u5934\u65B9\u6848\uFF1A\u6E05\u6668\u6D77\u8FB9\u5496\u5561\u5E97\uFF0C\u4E00\u53EA\u6A58\u732B\u8FFD\u7740\u7EB8\u98DE\u673A\uFF0C\u6E29\u6696\u7535\u5F71\u611F\uFF0C\u7AD6\u7248\u3002", mode: "fill" },
        { id: "video-auto", label: "\u81EA\u52A8\u751F\u6210\u9996\u7248", value: "\u4E3A\u5F53\u524D\u89C6\u9891\u9879\u76EE\u6309\u955C\u5934\u987A\u5E8F\u81EA\u52A8\u751F\u6210\u9996\u7248\uFF0C\u5B8C\u6210\u4E00\u955C\u518D\u7EE7\u7EED\u4E0B\u4E00\u955C\u3002", mode: "fill" },
        { id: "video-revise", label: "\u4FEE\u6539\u5F53\u524D\u955C\u5934", value: "\u6682\u505C\u5F53\u524D\u89C6\u9891\u955C\u5934\uFF0C\u628A\u955C\u5934\u52A8\u4F5C\u6539\u5F97\u66F4\u514B\u5236\uFF0C\u4FDD\u7559\u4E3B\u4F53\u8FDE\u7EED\u6027\u3002", mode: "fill" }
      ],
      mergeCommands: "replace"
    }
  },
  slots: {
    // aigc-agent 专属：左栏开/切「画布」pane tab（非 panelRight 旧画廊）。
    launcherRail: AigcCanvasPanesLauncher,
    promptToolbar: AigcPromptToolbar,
    dialogLayer: MediaPreviewHost
  },
  // WebExtension 契约承载定义本身；`definition` 仅属 PanesHost prop/宿主内部 PaneSource。
  panes: { ...aigcPanesDefinition, config: panesConfig },
  conversationImageActions: [canvasConversationImageAction],
  renderers: {
    tools: {
      ...imageRendererExtension.renderers?.tools ?? {},
      ...mediaRendererExtension.renderers?.tools ?? {}
    }
  }
});
export {
  aigcPanesDefinition,
  web_config_default as default
};
