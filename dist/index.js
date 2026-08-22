"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../onelo-core/dist/types.js
var require_types = __commonJS({
  "../onelo-core/dist/types.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.OneloError = void 0;
    exports2.extractErrorCode = extractErrorCode2;
    var OneloError2 = class _OneloError extends Error {
      constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "OneloError";
      }
      static notAuthenticated() {
        return new _OneloError("not_authenticated", "User is not authenticated");
      }
      static hostedFlowRequired() {
        return new _OneloError("hosted_flow_required", "This app requires the hosted sign-in flow. Use loadAuthView().");
      }
      /**
       * The DEVELOPER's app is on a plan that doesn't allow custom auth UI. This is
       * a build-time configuration error — the fix is to use the hosted flow
       * (loadAuthView) or upgrade the Onelo plan. NOT for an end-user's lapsed
       * subscription — see noActivePlan().
       */
      static planRequired() {
        return new _OneloError("plan_required", "[plan_required] Custom UI requires a paid Onelo plan. Use loadAuthView() instead.");
      }
      /**
       * The END USER has no active subscription (it lapsed or was cancelled) — the
       * backend cleared the session. This is NOT a config error and NOT an account
       * revocation: route the user to your store / upgrade flow to re-subscribe.
       */
      static noActivePlan() {
        return new _OneloError("no_active_plan", "[no_active_plan] No active subscription \u2014 the plan has expired or was cancelled. Route the user to your store / upgrade flow to re-subscribe.");
      }
      static invalidKey(msg) {
        return new _OneloError("invalid_publishable_key", `Invalid publishable key: ${msg}`);
      }
      static network(msg) {
        return new _OneloError("network_error", `Network error: ${msg}`);
      }
      static server(msg) {
        return new _OneloError("server_error", msg);
      }
      static timeout(msg) {
        return new _OneloError("timeout", msg);
      }
      static cancelled() {
        return new _OneloError("cancelled", "Sign in was cancelled");
      }
      static revoked() {
        return new _OneloError("revoked", "This application has been revoked");
      }
      static userRevoked() {
        return new _OneloError("user_revoked", "This user account has been suspended");
      }
    };
    exports2.OneloError = OneloError2;
    function extractErrorCode2(json) {
      if (!json || typeof json !== "object")
        return void 0;
      const body = json;
      if (typeof body.error === "string" && body.error)
        return body.error;
      const detail = body.detail;
      if (typeof detail === "string" && detail)
        return detail;
      if (detail && typeof detail === "object") {
        const nested = detail.error;
        if (typeof nested === "string" && nested)
          return nested;
      }
      return void 0;
    }
  }
});

// ../onelo-core/dist/pkce.js
var require_pkce = __commonJS({
  "../onelo-core/dist/pkce.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.generateCodeVerifier = generateCodeVerifier2;
    exports2.generateCodeChallenge = generateCodeChallenge2;
    function generateCodeVerifier2() {
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      return base64urlEncode(array);
    }
    async function generateCodeChallenge2(verifier) {
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return base64urlEncode(new Uint8Array(digest));
    }
    function base64urlEncode(bytes) {
      let str = "";
      for (const byte of bytes) {
        str += String.fromCharCode(byte);
      }
      return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
  }
});

// ../onelo-core/dist/http.js
var require_http = __commonJS({
  "../onelo-core/dist/http.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.httpGet = httpGet6;
    exports2.httpPost = httpPost3;
    exports2.checkHostedFlowRequired = checkHostedFlowRequired2;
    var types_1 = require_types();
    async function httpGet6(url, headers) {
      let res;
      try {
        res = await fetch(url, { headers });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function httpPost3(url, body, headers) {
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body)
        });
      } catch (e) {
        throw types_1.OneloError.network(e instanceof Error ? e.message : "fetch failed");
      }
      const json = await parseJson(res);
      return { status: res.status, json };
    }
    async function parseJson(res) {
      try {
        return await res.json();
      } catch {
        throw types_1.OneloError.network("Invalid JSON response");
      }
    }
    function checkHostedFlowRequired2(json) {
      const j = json;
      const errorCode = j["error"] ?? j["detail"]?.["error"];
      if (errorCode === "hosted_flow_required") {
        const hint = j["hint"] ?? j["detail"]?.["hint"] ?? "Use loadAuthView() in your web app.";
        console.warn("[Onelo] \u26A0\uFE0F  hosted_flow_required:", hint);
        console.info("[Onelo] \u{1F4A1} Fix: call onelo.auth.loadAuthView() or upgrade your Onelo plan.");
        throw types_1.OneloError.hostedFlowRequired();
      }
    }
  }
});

// ../onelo-core/dist/session.js
var require_session = __commonJS({
  "../onelo-core/dist/session.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.TOKEN_KEYS = void 0;
    exports2.mapSession = mapSession2;
    function mapSession2(j) {
      const tokens = j["session"] ?? j;
      const user = j["user"];
      const appMeta = user?.["app_metadata"] ?? {};
      const expiresIn = tokens["expires_in"];
      const expiresAt = typeof expiresIn === "number" ? Math.floor(Date.now() / 1e3) + expiresIn : 0;
      return {
        accessToken: tokens["access_token"],
        refreshToken: tokens["refresh_token"],
        expiresAt,
        user: {
          id: user["id"],
          email: user["email"],
          role: appMeta["user_role"] ?? user["role"] ?? "member",
          tenantId: appMeta["tenant_id"] ?? user["tenant_id"] ?? null,
          // Backend sends "active" | "none"; absent MUST decode to 'none' (never
          // treat a missing entitlement as active). Round-trips via USER_JSON.
          entitlement: user["entitlement"] === "active" ? "active" : "none",
          // Undefined (not false) when the backend did not send it: "the server did
          // not say" and "the server said no" are different, and only the first may
          // fall back to the old client-side derivation.
          allowedIn: typeof user["allowed_in"] === "boolean" ? user["allowed_in"] : void 0
        }
      };
    }
    exports2.TOKEN_KEYS = {
      ACCESS_TOKEN: "onelo_access_token",
      REFRESH_TOKEN: "onelo_refresh_token",
      EXPIRES_AT: "onelo_expires_at",
      USER_JSON: "onelo_user",
      /**
       * PKCE verifier for an OUTSTANDING magic link.
       *
       * Every other verifier this SDK uses lives in memory, which is correct for
       * flows that finish in the same page. A magic link does not: the email opens
       * a NEW tab (often after a relaunch), so an in-memory verifier is gone by the
       * time the code comes back and /hosted-callback would 401 on a link that is
       * already spent — locking the user out with no recovery. That is exactly why
       * magic links shipped WITHOUT a challenge.
       *
       * Persisting it is what makes the binding possible on the web: the new tab is
       * the same origin, so it can read this back. Deleted the moment the exchange
       * finishes or fails, and cleared with the rest on sign-out.
       */
      MAGIC_LINK_VERIFIER: "onelo_magic_link_verifier"
    };
  }
});

// ../onelo-core/dist/reason-enum.js
var require_reason_enum = __commonJS({
  "../onelo-core/dist/reason-enum.js"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.REASON_LABELS = exports2.RESPONSE_REASON_CODES = void 0;
    exports2.RESPONSE_REASON_CODES = [
      "too_expensive",
      "missing_features",
      "not_working",
      "not_using_anymore",
      "found_alternative",
      "bought_by_mistake",
      "duplicate_charge",
      "unauthorized",
      "prefer_not_to_say",
      "other",
      "skipped"
    ];
    exports2.REASON_LABELS = {
      too_expensive: "Too expensive",
      missing_features: "Missing features",
      not_working: "Doesn't work as expected",
      not_using_anymore: "Not using anymore",
      found_alternative: "Found alternative",
      bought_by_mistake: "Bought by mistake",
      duplicate_charge: "Duplicate charge",
      unauthorized: "I didn't authorise this",
      prefer_not_to_say: "Prefer not to say",
      other: "Other",
      skipped: "(skipped survey)"
    };
  }
});

// ../onelo-core/dist/index.js
var require_dist = __commonJS({
  "../onelo-core/dist/index.js"(exports2) {
    "use strict";
    var __createBinding = exports2 && exports2.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports2 && exports2.__exportStar || function(m, exports3) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports3, p)) __createBinding(exports3, m, p);
    };
    Object.defineProperty(exports2, "__esModule", { value: true });
    __exportStar(require_types(), exports2);
    __exportStar(require_pkce(), exports2);
    __exportStar(require_http(), exports2);
    __exportStar(require_session(), exports2);
    __exportStar(require_reason_enum(), exports2);
  }
});

// src/codesign.ts
function getCodesignFingerprint() {
  try {
    if (process.platform === "darwin") {
      return getMacOSFingerprint();
    } else if (process.platform === "win32") {
      return getWindowsFingerprint();
    }
    return null;
  } catch {
    return null;
  }
}
function getMacOSFingerprint() {
  const prefix = (0, import_path2.join)((0, import_os.tmpdir)(), `onelo-cs-${process.pid}-${Date.now()}-`);
  try {
    (0, import_child_process.execSync)(
      `codesign -d --extract-certificates="${prefix}" "${process.execPath}" 2>/dev/null`,
      { timeout: 5e3 }
    );
    const der = (0, import_fs2.readFileSync)(`${prefix}0`);
    return (0, import_crypto.createHash)("sha256").update(der).digest("hex").toLowerCase();
  } catch {
    return null;
  } finally {
    for (let i = 0; i < 8; i++) {
      try {
        (0, import_fs2.unlinkSync)(`${prefix}${i}`);
      } catch {
      }
    }
  }
}
function getWindowsFingerprint() {
  try {
    const script = [
      `$sig = Get-AuthenticodeSignature -FilePath '${process.execPath}'`,
      `if ($sig.Status -eq 'Valid') { $sig.SignerCertificate.GetCertHashString('SHA256') }`
    ].join("; ");
    const output = (0, import_child_process.execSync)(
      `powershell -NoProfile -Command "${script}"`,
      { encoding: "utf8", timeout: 5e3 }
    ).trim();
    if (!output || output.length !== 64) return null;
    return output.toLowerCase();
  } catch {
    return null;
  }
}
function getCachedCodesignFingerprint() {
  if (_cachedFingerprint === void 0) {
    _cachedFingerprint = getCodesignFingerprint();
  }
  return _cachedFingerprint;
}
function getCodesignOS() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return null;
}
var import_child_process, import_crypto, import_fs2, import_os, import_path2, _cachedFingerprint;
var init_codesign = __esm({
  "src/codesign.ts"() {
    "use strict";
    import_child_process = require("child_process");
    import_crypto = require("crypto");
    import_fs2 = require("fs");
    import_os = require("os");
    import_path2 = require("path");
    _cachedFingerprint = void 0;
  }
});

// src/instance-id.ts
function getInstanceId() {
  if (cached) return cached;
  try {
    const { app } = require("electron");
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(app.getPath("userData"), "onelo");
    const file = path.join(dir, "instance-id");
    let id = null;
    try {
      id = fs.readFileSync(file, "utf8").trim() || null;
    } catch {
    }
    if (!id) {
      id = (0, import_node_crypto.randomUUID)();
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, id);
      } catch {
      }
    }
    cached = id;
    return cached;
  } catch {
    return (0, import_node_crypto.randomUUID)();
  }
}
var import_node_crypto, cached;
var init_instance_id = __esm({
  "src/instance-id.ts"() {
    "use strict";
    import_node_crypto = require("crypto");
    cached = null;
  }
});

// package.json
var version;
var init_package = __esm({
  "package.json"() {
    version = "0.46.1";
  }
});

// src/sdk-headers.ts
var sdk_headers_exports = {};
__export(sdk_headers_exports, {
  sdkHeaders: () => sdkHeaders
});
function sdkHeaders(bundleIdOrExtra, extra) {
  const bundleId = typeof bundleIdOrExtra === "string" ? bundleIdOrExtra : void 0;
  const extraHeaders = typeof bundleIdOrExtra === "object" ? bundleIdOrExtra : extra;
  const fp = getCachedCodesignFingerprint();
  const codesignOS = fp ? getCodesignOS() : null;
  return {
    "X-SDK-Version": version,
    // Platform attribution for feature discovery. Without this, rows registered
    // via POST /api/sdk/features/batch-ping stored sdk_platform=NULL (Node fetch
    // sends no SDK User-Agent, so the backend's UA fallback found nothing).
    //
    // The VALUE MUST be 'js', not 'electron': the discovery endpoint validates
    // this header against _KNOWN_SDK_PLATFORMS (= the values of _UA_LANGUAGE_MAP:
    // python/swift/js/kotlin/flutter/go) in backend/app/routes/sdk_features.py,
    // and that map deliberately collapses `onelo-electron → "js"` ("Electron and
    // React Native share js"). An unknown 'electron' is rejected → falls back to
    // UA parsing → NULL again. 'js' is exactly what onelo-js sends
    // (onelo-js/src/features/features.ts) and what the backend expects for this
    // runtime. (The SSE live-connections dashboard uses a SEPARATE vocabulary
    // — broadcaster PLATFORM_WHITELIST, which DOES have 'electron' — so
    // event-stream.ts's query param stays 'electron'; the two are unrelated.)
    "X-Onelo-Sdk-Platform": "js",
    // Per-install id — required by the backend for test-env feature discovery
    // (TOFU binding) and sent on every request (parity with Swift).
    "X-Onelo-Instance-Id": getInstanceId(),
    // WHICH OS, as distinct from 'X-Onelo-Sdk-Platform' above (which SDK).
    // Only 'macos' matters to the backend: it is the one Electron target that
    // can ship through an Apple store, so it is the one where the
    // "Require plan on sign-up" gate may need suppressing
    // (applications.paywall_gate_on_apple). Windows and Linux are unaffected —
    // and a Mac app shipped as a DMG is too, which is why the developer's
    // dashboard setting decides, not this header alone.
    "X-Onelo-OS": process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unknown",
    ...bundleId ? { "X-Bundle-Id": bundleId } : {},
    ...fp ? { "X-Codesign-Fingerprint": fp } : {},
    ...codesignOS ? { "X-Codesign-Platform": codesignOS } : {},
    ...extraHeaders
  };
}
var init_sdk_headers = __esm({
  "src/sdk-headers.ts"() {
    "use strict";
    init_codesign();
    init_instance_id();
    init_package();
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  FeatureState: () => FeatureState,
  IPC_CHANNELS: () => IPC_CHANNELS,
  Onelo: () => Onelo,
  OneloConsent: () => OneloConsent,
  OneloElectronAuth: () => OneloElectronAuth,
  OneloElectronCustomerPortal: () => OneloElectronCustomerPortal,
  OneloError: () => import_core.OneloError,
  OneloFeatures: () => OneloFeatures,
  OneloFeaturesError: () => OneloFeaturesError,
  OneloFeedback: () => OneloFeedback,
  OneloForms: () => OneloForms,
  OneloMonitor: () => OneloMonitor,
  OneloStore: () => OneloStore,
  OneloWaitlist: () => OneloWaitlist,
  REASON_LABELS: () => import_core6.REASON_LABELS,
  RESPONSE_REASON_CODES: () => import_core6.RESPONSE_REASON_CODES,
  SecureTokenStorage: () => SecureTokenStorage
});
module.exports = __toCommonJS(index_exports);

// src/auth.ts
var import_core2 = __toESM(require_dist());

// src/storage.ts
var import_path = require("path");
var import_fs = require("fs");
var SecureTokenStorage = class {
  constructor(storePath) {
    this.cache = /* @__PURE__ */ new Map();
    if (storePath) {
      this.storePath = storePath;
    } else {
      this.storePath = "";
    }
  }
  getStorePath() {
    if (this.storePath) return this.storePath;
    const { app } = require("electron");
    const dir = (0, import_path.join)(app.getPath("userData"), "onelo");
    if (!(0, import_fs.existsSync)(dir)) (0, import_fs.mkdirSync)(dir, { recursive: true });
    this.storePath = (0, import_path.join)(dir, "tokens.enc");
    return this.storePath;
  }
  loadFromDisk() {
    const path = this.getStorePath();
    if (!(0, import_fs.existsSync)(path)) return;
    try {
      const raw = JSON.parse((0, import_fs.readFileSync)(path, "utf-8"));
      const { safeStorage } = require("electron");
      for (const [key, bufArr] of Object.entries(raw)) {
        try {
          const buf = Buffer.from(bufArr);
          const value = safeStorage.decryptString(buf);
          this.cache.set(key, value);
        } catch {
        }
      }
    } catch {
    }
  }
  saveToDisk() {
    const path = this.getStorePath();
    const { safeStorage } = require("electron");
    const out = {};
    for (const [key, value] of this.cache.entries()) {
      const encrypted = safeStorage.encryptString(value);
      out[key] = Array.from(encrypted);
    }
    (0, import_fs.writeFileSync)(path, JSON.stringify(out), "utf-8");
  }
  async set(key, value) {
    const { safeStorage } = await import("electron");
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption is not available on this system");
    }
    if (this.cache.size === 0) this.loadFromDisk();
    this.cache.set(key, value);
    this.saveToDisk();
  }
  async get(key) {
    if (this.cache.size === 0) this.loadFromDisk();
    return this.cache.get(key) ?? null;
  }
  async delete(key) {
    this.cache.delete(key);
    this.saveToDisk();
  }
  async clear() {
    this.cache.clear();
    const path = this.getStorePath();
    if ((0, import_fs.existsSync)(path)) (0, import_fs.writeFileSync)(path, "{}", "utf-8");
  }
  /**
   * Synchronous presence check for one or more stored keys, WITHOUT decrypting.
   * Reads the raw encrypted store straight off disk (`readFileSync`) and reports
   * whether EVERY requested key is present. Backs the cold-start
   * `hasStoredSession()` primitive (#36): a fast, init-independent "am I logged
   * in?" hint. Deliberately checks key presence only (no `decryptString`) so it
   * never depends on the OS keychain being unlockable and never throws.
   * The on-disk file is the source of truth — `set`/`delete`/`clear` all persist
   * synchronously, so this stays consistent with the async accessors.
   * Returns false if the store file is missing, empty, or unreadable.
   */
  hasKeysSync(...keys) {
    if (keys.length === 0) return false;
    const path = this.getStorePath();
    if (!(0, import_fs.existsSync)(path)) return false;
    try {
      const raw = JSON.parse((0, import_fs.readFileSync)(path, "utf-8"));
      return keys.every((k) => Object.prototype.hasOwnProperty.call(raw, k));
    } catch {
      return false;
    }
  }
};

// src/types.ts
var import_core = __toESM(require_dist());
var IPC_CHANNELS = {
  GET_SESSION: "onelo:get-session",
  SIGN_IN: "onelo:sign-in",
  SIGN_OUT: "onelo:sign-out",
  REFRESH_SESSION: "onelo:refresh-session",
  OPEN_AUTH_URL: "onelo:open-auth-url"
};

// src/auth.ts
init_sdk_headers();
init_codesign();
function flowErrorHtml() {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:#111111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;padding:32px;color:rgba(255,255,255,0.92)}
.card{max-width:340px;text-align:center}
.title{font-size:17px;font-weight:600;margin-bottom:8px}
.msg{font-size:13px;line-height:1.5;color:rgba(255,255,255,0.55);margin-bottom:24px}
button{font:inherit;font-size:14px;font-weight:600;padding:11px 24px;border-radius:10px;border:none;background:#ffffff;color:#111111;cursor:pointer}
button:hover{opacity:0.9}
button:focus-visible{outline:2px solid #ffffff;outline-offset:2px}
</style></head><body>
<div class="card">
<div class="title">Couldn't start sign-in</div>
<div class="msg">Something went wrong while connecting. Please check your connection and try again.</div>
<button onclick="location.href='onelo-retry://retry'">Try again</button>
</div>
</body></html>`;
}
async function resolveConfig(publishableKey, apiUrl, codeChallenge, clientSecret) {
  if (!publishableKey.startsWith("onelo_pk_")) {
    throw import_core.OneloError.invalidKey("Key must start with onelo_pk_");
  }
  const url = `${apiUrl}/api/sdk/config?key=${encodeURIComponent(publishableKey)}&code_challenge=${encodeURIComponent(codeChallenge)}`;
  const { status, json } = await (0, import_core2.httpGet)(url, sdkHeaders(
    clientSecret ? { "X-Client-Secret": clientSecret } : void 0
  ));
  if (status === 401 || status === 404) throw import_core.OneloError.invalidKey("Server rejected the key");
  if (status !== 200) throw import_core.OneloError.server(`Config request failed: HTTP ${status}`);
  const j = json;
  return {
    supabaseUrl: j["supabase_url"],
    supabaseAnonKey: j["supabase_anon_key"],
    tenantId: j["tenant_id"],
    allowCustomBranding: j["allow_custom_branding"] ?? false,
    appName: j["app_name"] ?? null,
    appLogoUrl: j["app_logo_url"] ?? null,
    paywallEnabled: j["paywall_enabled"] ?? false,
    waitlistMode: j["waitlist_mode"] ?? false,
    sdkRedirectUrl: j["sdk_redirect_url"] ?? null,
    storeUrl: j["store_url"] ?? null,
    manageUrl: j["manage_url"] ?? null,
    oauthProviders: j["oauth_providers"] ?? [],
    // Branding page background (--onelo-page-bg / checkout_bg_color). Required by
    // the shared ResolvedSDKConfig; parity with RN's resolver. Default dark.
    pageBackgroundColor: j["checkout_bg_color"] || "#111111"
  };
}
function hostedWindowSize(url) {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return { width: 480, minWidth: 440 };
  }
  const isWideSurface = path.startsWith("/store/") || path.startsWith("/customer/portal");
  return isWideSurface ? { width: 780, minWidth: 560 } : { width: 480, minWidth: 440 };
}
function isExpiredAuthError(err) {
  return err === "invalid_token" || err === "expired_token" || err === "token_expired";
}
var HOSTED_ORIGIN_KEY = "onelo_hosted_origin";
var OAUTH_RETURN_TIMEOUT_MS = 5 * 60 * 1e3;
var _OneloElectronAuth = class _OneloElectronAuth {
  constructor(config) {
    this.pkceVerifier = null;
    this.resolvedConfig = null;
    this.heartbeatTimer = null;
    this.refreshTimer = null;
    this._sessionListeners = [];
    /** Incremented on signOut so an in-flight refresh/revalidate can't resurrect a
     *  session that was signed out mid-request (epoch guard — parity with Swift/JS). */
    this.signOutEpoch = 0;
    /** Whether the app has the paywall enabled — gates the entitlement revalidate
     *  on session restore (only paywall apps care about `hasActiveAccess`). */
    this.paywallEnabled = false;
    /** True after a hard account revocation (banned / all sessions server-revoked)
     *  surfaced via the SSE `session.revoked` push, heartbeat 401, or refresh
     *  `user_revoked`. Parity with Swift `isUserRevoked` / JS. */
    this.isUserRevoked = false;
    /** True once /api/sdk/config has been fetched successfully */
    this.isReady = false;
    /** True if the publishable key has been revoked */
    this.isRevoked = false;
    /** #29 — non-null when `initialize()` threw; previously swallowed silently
     *  (isReady=false forever with no trace). Surfaced + logged for diagnosis. */
    this.initError = null;
    /** Whether the tenant's plan allows custom auth UI */
    this.allowCustomBranding = false;
    /** App name from dashboard — shown in hosted sign-in UI */
    this.appName = "App";
    /** App logo URL from dashboard — shown in hosted sign-in UI if set */
    this.appLogoUrl = null;
    /** Plan-gated enabled OAuth providers (google/github/apple) from
     *  /api/sdk/config. Empty when social is disabled. Parity with Swift. */
    this.oauthProviders = [];
    /**
     * Which hosted surface `presentAuthWindow()` last opened: `sign_in`, `store`,
     * `no_plan`, or null when nothing was presented (the caller was already
     * `authorized`, or the flow never got that far).
     *
     * `/api/sdk/flow/init`'s `surface` was read and immediately discarded, so a
     * host app that got `null` back from `presentAuthWindow()` could not tell
     * "user cancelled sign-in" from "user has no plan and closed the no_plan
     * screen" — both close the SAME window the SAME way (`win.on('closed')` →
     * `resolve(null)`). The return type stays `OneloElectronSession | null` —
     * this is additive, reading it is optional. Parity with JS's
     * `lastPresentedSurface`.
     */
    this.lastPresentedSurface = null;
    /** A `loadAuthView()`/`presentAuthWindow()` call whose flow LEFT this app for
     *  the system browser and has not come back yet. See `parkPendingFlow`.
     *  `win` is the still-open hosted window it started in — a magic link (like
     *  OAuth) is finished by a deep-link that lands OUTSIDE that window (email
     *  client → system browser → this app's protocol handler), so nothing
     *  in-window ever navigates it away. Tracking it here lets settlePendingFlow
     *  close it once the flow is actually decided, instead of leaving it open as
     *  an orphaned second "Check your inbox" window while a NEW window (the
     *  deep-link's own outcome — success or the no-plan gate) opens next to it. */
    this.pendingFlow = null;
    this.storage = new SecureTokenStorage();
    this.protocol = config.protocol ?? "onelo";
    this.apiUrl = config.apiUrl;
    this.publishableKey = config.publishableKey;
    this.clientSecret = config.clientSecret;
    this.bundleId = config.bundleId;
    if (!this.bundleId && getCachedCodesignFingerprint()) {
      console.warn(
        '[Onelo] This build is code-signed but no `bundleId` is set in your Onelo config. Set `bundleId` to your app id (e.g. "com.company.app") \u2014 it is REQUIRED for codesign attestation. Without it, requests are rejected with bundle_id_mismatch (403) once enforcement is active.'
      );
    }
    this.initPromise = this.initialize();
  }
  /**
   * Register a callback invoked whenever the session changes (sign-in, restore,
   * or sign-out), receiving the new user id (or `null`). Returns an unsubscribe
   * function. Multi-listener + unsubscribe to match JS `onAuthStateChange`
   * (listener array) and Swift's Combine `currentSession` (multi-observer) — was
   * a single slot that silently overwrote a prior registration. The payload
   * stays `userId: string | null` (the internal Onelo wrapper bridge relies on
   * it to rebind features/monitor identity), NOT the full session object.
   */
  onSessionChange(cb) {
    this._sessionListeners.push(cb);
    return () => {
      this._sessionListeners = this._sessionListeners.filter((l) => l !== cb);
    };
  }
  /** Fire every registered session listener. Snapshots the array first so a
   *  listener that unsubscribes mid-dispatch doesn't skip its peers, and isolates
   *  a throwing listener so it can never break the auth state machine. */
  _notifySessionChange(userId) {
    for (const l of [...this._sessionListeners]) {
      try {
        l(userId);
      } catch {
      }
    }
  }
  async initialize() {
    try {
      const verifier = (0, import_core2.generateCodeVerifier)();
      this.pkceVerifier = verifier;
      const challenge = await (0, import_core2.generateCodeChallenge)(verifier);
      const resolved = await resolveConfig(this.publishableKey, this.apiUrl, challenge, this.clientSecret);
      this.resolvedConfig = resolved;
      this.allowCustomBranding = resolved.allowCustomBranding;
      this.paywallEnabled = resolved.paywallEnabled;
      if (resolved.appName) this.appName = resolved.appName;
      this.appLogoUrl = resolved.appLogoUrl;
      this.oauthProviders = resolved.oauthProviders ?? [];
      this.isReady = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.initError = msg;
      console.warn(
        "[Onelo] SDK initialization failed \u2014 auth and config-gated features are disabled until this is fixed: " + msg
      );
      if (e instanceof import_core.OneloError && e.code === "invalid_publishable_key") {
        this.isRevoked = true;
      }
    }
  }
  async waitReady() {
    await this.initPromise;
  }
  /**
   * Resolves when /api/sdk/config has been fetched. Safe to call multiple times.
   * Pass `timeoutSeconds` to reject with `OneloError.timeout` if the SDK isn't
   * ready in time (so startup UI / monitor events don't hang forever on a slow
   * config fetch). No arg = wait indefinitely (back-compat). Parity with Swift
   * `awaitReady(timeout:)` (whose default is 5s — pass 5 to match).
   */
  async whenReady(timeoutSeconds) {
    if (this.isReady) return;
    if (timeoutSeconds === void 0) {
      await this.initPromise;
      return;
    }
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(import_core.OneloError.timeout(`whenReady exceeded ${timeoutSeconds}s`)),
        timeoutSeconds * 1e3
      );
      timer.unref?.();
    });
    try {
      await Promise.race([this.initPromise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  /**
   * Generate a fresh PKCE verifier AND register its challenge with the backend
   * (GET /api/sdk/config?code_challenge=…), then stash the verifier for the next
   * signin/signup POST. The challenge is single-use — reusing a verifier whose
   * challenge was already consumed (or one whose challenge was never registered)
   * fails the exchange. Called before every signin/signup so retries always work.
   */
  async _ensurePkce() {
    const verifier = (0, import_core2.generateCodeVerifier)();
    const challenge = await (0, import_core2.generateCodeChallenge)(verifier);
    const url = `${this.apiUrl}/api/sdk/config?key=${encodeURIComponent(this.publishableKey)}&code_challenge=${encodeURIComponent(challenge)}`;
    const { status } = await (0, import_core2.httpGet)(url, sdkHeaders(
      this.clientSecret ? { "X-Client-Secret": this.clientSecret } : void 0
    ));
    if (status === 401 || status === 404) throw import_core.OneloError.invalidKey("Server rejected the key");
    if (status !== 200) throw import_core.OneloError.server(`Failed to register PKCE challenge: HTTP ${status}`);
    this.pkceVerifier = verifier;
  }
  // ── Public API ─────────────────────────────────────────────────────────────
  async signIn(email, password) {
    await this.waitReady();
    await this._ensurePkce();
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signin`,
      {
        email,
        password,
        publishableKey: this.publishableKey,
        code_verifier: this.pkceVerifier
      },
      sdkHeaders(this.bundleId)
    );
    (0, import_core2.checkHostedFlowRequired)(json);
    const j = json;
    if (status === 403) {
      const detail = j["detail"];
      if (detail?.["error"] === "user_revoked") throw import_core.OneloError.userRevoked();
      throw import_core.OneloError.server(detail?.["message"] ?? j["error"]);
    }
    if (status !== 200) throw import_core.OneloError.server(`Sign in failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core2.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  async signUp(email, password) {
    await this.waitReady();
    await this._ensurePkce();
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/signup`,
      {
        email,
        password,
        publishableKey: this.publishableKey,
        code_verifier: this.pkceVerifier
      },
      sdkHeaders(this.bundleId)
    );
    (0, import_core2.checkHostedFlowRequired)(json);
    const j = json;
    if (status !== 200) throw import_core.OneloError.server(`Sign up failed: HTTP ${status}`);
    this.pkceVerifier = null;
    const session = (0, import_core2.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  async signOut() {
    this.settlePendingFlow(null);
    this.signOutEpoch++;
    this.stopHeartbeat();
    this.clearRefreshTimer();
    const accessToken = await this.storage.get(import_core2.TOKEN_KEYS.ACCESS_TOKEN);
    await this.storage.clear();
    this._notifySessionChange(null);
    if (accessToken) {
      try {
        await (0, import_core2.httpPost)(
          `${this.apiUrl}/api/sdk/auth/signout`,
          {},
          sdkHeaders(this.bundleId, { Authorization: `Bearer ${accessToken}`, "X-Publishable-Key": this.publishableKey })
        );
      } catch {
      }
    }
  }
  /**
   * Instant, SYNCHRONOUS presence check for a locally stored session. Unlike
   * `getSession()` it does NOT await init (`whenReady()`) — no `/api/sdk/config`
   * round-trip — and never touches the network. It is a pure secure-store
   * presence read (access + refresh + user tokens all present), so the host app
   * / window logic can decide AT COLD START, before init resolves, whether a
   * launch is an auto-login (keep the hidden main window hidden while restore
   * runs, or paint the branded auth window) or a genuine signed-out start.
   * Parity with Android `hasStoredSession()` and Swift `hasStoredSessionSync()`
   * (#36).
   *
   * This is an optimistic hint, NOT validation: it does not check token expiry or
   * server-side revocation. Always drive real access off `getSession()` (expiry →
   * refresh) — that enforcement path is unchanged. Mirrors the same three-token
   * completeness check `getSession()` requires before returning a session.
   */
  hasStoredSession() {
    return this.storage.hasKeysSync(
      import_core2.TOKEN_KEYS.ACCESS_TOKEN,
      import_core2.TOKEN_KEYS.REFRESH_TOKEN,
      import_core2.TOKEN_KEYS.USER_JSON
    );
  }
  async getSession() {
    const [accessToken, refreshToken, expiresAtStr, userJson] = await Promise.all([
      this.storage.get(import_core2.TOKEN_KEYS.ACCESS_TOKEN),
      this.storage.get(import_core2.TOKEN_KEYS.REFRESH_TOKEN),
      this.storage.get(import_core2.TOKEN_KEYS.EXPIRES_AT),
      this.storage.get(import_core2.TOKEN_KEYS.USER_JSON)
    ]);
    if (!accessToken || !refreshToken || !userJson) return null;
    const expiresAt = parseInt(expiresAtStr ?? "0", 10);
    if (Date.now() / 1e3 > expiresAt - 60) {
      return this.refreshSession();
    }
    const user = JSON.parse(userJson);
    if (!user.id) {
      await this.storage.clear();
      return null;
    }
    const session = { accessToken, refreshToken, expiresAt, user };
    this.scheduleRefresh(session);
    if (this.heartbeatTimer === null) {
      this.startHeartbeat(session.accessToken);
      this._notifySessionChange(session.user.id);
      if (this.paywallEnabled) void this.revalidateEntitlement();
    }
    return session;
  }
  /**
   * True when the current session's user has an active paid entitlement.
   * Snapshot read of the persisted session (no network) — mirrors Swift's
   * `hasActiveAccess`. Returns false when there is no session.
   */
  async hasActiveAccess() {
    const session = await this.getSession();
    return session?.user.entitlement === "active";
  }
  /**
   * Hold the flow open across a hand-off to the system browser — an OAuth
   * provider page, or a magic link opened from the user's email client. Both
   * leave this app's hosted window open (or, for OAuth, about to close) with no
   * in-window navigation to react to; the eventual outcome arrives later via
   * `handleDeepLink`, disconnected from whatever `presentHostedUrl` call is
   * still waiting.
   *
   * It used to resolve `null` at hand-off time, which is the same value the SDK
   * uses for "the user cancelled". A host app therefore could not tell "nothing
   * happened" from "a session is on its way", and the obvious
   * `await loadAuthView(); mainWindow.show()` revealed the app as "Not signed
   * in" while the account chooser was still open in Safari (Adrian, 2026-08-19).
   *
   * Now the promise stays pending until `handleDeepLink` settles it, matching
   * Swift (ASWebAuthenticationSession stays alive) and React Native (the modal
   * stays open). `null` goes back to meaning only "no session came of it".
   */
  parkPendingFlow(resolve, win = null) {
    this.settlePendingFlow(null);
    const timer = setTimeout(() => this.settlePendingFlow(null), OAUTH_RETURN_TIMEOUT_MS);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.pendingFlow = { resolve, timer, win };
  }
  /** Drop this window's parked entry WITHOUT resolving it — for when the
   *  window is settling itself in-place (e.g. an in-window deep-link code, or
   *  the expired-token reload) and would otherwise leave a stale parked entry
   *  pointing at a window that's already closing. */
  clearOwnParkedFlow(resolve) {
    if (this.pendingFlow?.resolve !== resolve) return;
    clearTimeout(this.pendingFlow.timer);
    this.pendingFlow = null;
  }
  /** Complete a parked flow, if there is one. Safe to call unconditionally.
   *  Closes the parked window (if still open) so an out-of-window outcome —
   *  the gate refusal or a real session — never leaves it orphaned next to a
   *  second window presenting that outcome. */
  settlePendingFlow(session) {
    const parked = this.pendingFlow;
    if (!parked) return;
    this.pendingFlow = null;
    clearTimeout(parked.timer);
    if (parked.win && !parked.win.isDestroyed()) {
      parked.win.removeAllListeners("closed");
      parked.win.close();
    }
    parked.resolve(session);
  }
  /**
   * May this person see the app?
   *
   * READ from the server, never computed here. The rule
   * `!paywallEnabled || entitlement === 'active'` once lived in this SDK, in
   * the JS SDK and in Swift — three copies, each found wrong on a different
   * day. The JS copy answered `true` while its config was still loading, so a
   * plan-less user walked into a paid app on every page load (2026-08-18).
   * `/api/sdk/auth/user` now ships the conclusion so it cannot recur.
   *
   * The fallback is COMPATIBILITY, not a second source of truth: an older
   * backend simply does not send `allowed_in`, and treating absent as `false`
   * would lock every user out of an app running this SDK ahead of the backend.
   * Delete it once the field is everywhere. Note `=== false`: the config flag is
   * only trustworthy once resolved, so anything else must deny.
   *
   * Contract: docs/sdk-access-gate-wiring.md
   */
  async isAllowedIn() {
    const session = await this.getSession();
    if (!session) return false;
    const answer = session.user.allowedIn;
    if (typeof answer === "boolean") return answer;
    return this.paywallEnabled === false || session.user.entitlement === "active";
  }
  /**
   * True when this app has the paywall enabled (from `/api/sdk/config`). Lets a
   * launch gate decide whether a session ALONE is enough to enter (non-paywall
   * apps) or whether `hasActiveAccess()` must ALSO hold (paywall apps) — without
   * the developer hardcoding a duplicate flag that could drift from the dashboard.
   * Accurate only after `whenReady()` resolves; returns false before config loads.
   */
  isPaywallEnabled() {
    return this.paywallEnabled;
  }
  /**
   * Re-fetch the user's entitlement from the backend and, if it changed, rebuild
   * + persist the session so `hasActiveAccess()` and the onSessionChange bridge
   * see the new value. Call after an external checkout or on app resume.
   * Best-effort: returns the cached entitlement on any non-200/network failure
   * and never throws (mirrors Swift/JS `revalidateEntitlement`).
   */
  async revalidateEntitlement() {
    const epoch = this.signOutEpoch;
    const session = await this.getSession();
    if (!session) return "none";
    try {
      const { status, json } = await (0, import_core2.httpGet)(
        `${this.apiUrl}/api/sdk/auth/user`,
        sdkHeaders(this.bundleId, {
          Authorization: `Bearer ${session.accessToken}`,
          "X-Publishable-Key": this.publishableKey
        })
      );
      if (status !== 200) return session.user.entitlement;
      const body = json;
      const next = body["entitlement"] === "active" ? "active" : "none";
      const nextAllowedIn = typeof body["allowed_in"] === "boolean" ? body["allowed_in"] : session.user.allowedIn;
      const changed = next !== session.user.entitlement || nextAllowedIn !== session.user.allowedIn;
      if (changed && epoch === this.signOutEpoch) {
        await this.saveSession({
          ...session,
          user: { ...session.user, entitlement: next, allowedIn: nextAllowedIn }
        });
      }
      return next;
    } catch {
      return session.user.entitlement;
    }
  }
  /**
   * Wire the shared event stream (called once by `Onelo`). Registers real-time
   * auth pushes: `session.revoked` (server-side force-logout — refund lapse,
   * admin revoke, account deletion, ban → sub-second sign-out, the complement to
   * the ≤13-min heartbeat fallback) and `paywall.access_changed` (a per-user
   * entitlement change → revalidate). Registered once; survives sign-in/out
   * cycles, exactly like the Swift SDK.
   */
  attachEventStream(stream) {
    stream.on("session.revoked", (data) => {
      void this._handleSessionRevoked(data);
    });
    stream.on("paywall.access_changed", () => {
      void this.revalidateEntitlement();
    });
  }
  /**
   * Handle a `session.revoked` push. Filters to the current user (one app can
   * have multiple buyers multiplexed on the shared stream); a missing
   * `app_user_id` is treated as "current user" (forward-compat). No session →
   * ignore. Teardown mirrors the refresh `user_revoked` path exactly.
   */
  async _handleSessionRevoked(data) {
    const userJson = await this.storage.get(import_core2.TOKEN_KEYS.USER_JSON);
    if (!userJson) return;
    let currentUserId;
    try {
      currentUserId = JSON.parse(userJson).id;
    } catch {
    }
    const eventUserId = data["app_user_id"];
    if (typeof eventUserId === "string" && currentUserId && eventUserId !== currentUserId) {
      return;
    }
    this.signOutEpoch++;
    this.stopHeartbeat();
    this.clearRefreshTimer();
    await this.storage.clear();
    this.isUserRevoked = true;
    this._notifySessionChange(null);
  }
  async refreshSession() {
    const epoch = this.signOutEpoch;
    const refreshToken = await this.storage.get(import_core2.TOKEN_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return null;
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/refresh`,
      // Wire key MUST be snake_case `refresh_token`: the backend
      // RefreshRequest model (sdk_auth.py) requires it and rejects a
      // camelCase `refreshToken` with a hard 422 (the handler never runs).
      // Matches every response payload + the Swift SDK request.
      { publishableKey: this.publishableKey, refresh_token: refreshToken },
      sdkHeaders(this.bundleId)
    );
    (0, import_core2.checkHostedFlowRequired)(json);
    const j = json;
    if (status !== 200) {
      this.clearRefreshTimer();
      await this.storage.clear();
      this._notifySessionChange(null);
      const detail = j["detail"];
      const reason = detail?.["error"] ?? detail?.["error_code"];
      if (reason === "banned" || reason === "session_compromised") {
        this.isUserRevoked = true;
        throw import_core.OneloError.userRevoked();
      }
      if (reason === "no_plan_available") {
        throw import_core.OneloError.noActivePlan();
      }
      return null;
    }
    if (epoch !== this.signOutEpoch) return null;
    const session = (0, import_core2.mapSession)(j);
    await this.saveSession(session);
    return session;
  }
  /**
   * Open the Onelo hosted auth page in an in-app BrowserWindow.
   * Handles the deep-link callback automatically — no app.on('open-url') needed.
   * Works on both free and paid plans. On free plan the hosted page includes Onelo branding.
   *
   * A hard flow-resolve failure (attestation / codesign / bundle-id mismatch →
   * 403, store misconfig, offline) is NOT thrown — it opens a graceful error
   * window with "Try again" and resolves `null` if the user closes it (#31).
   * The ONLY case that still throws is a REVOKED publishable key
   * (`OneloError.invalidKey`) — a permanent developer misconfig where retry is
   * meaningless — so wrap this call in try/catch (the auth-gate snippet does).
   *
   * @param parentWindow  Optional parent BrowserWindow (for modal centering)
   * @throws {OneloError} `invalid_publishable_key` if the app key is revoked.
   */
  async presentAuthWindow(parentWindow) {
    await this.waitReady();
    if (this.isRevoked) throw import_core.OneloError.invalidKey("Application key has been revoked");
    let decision;
    try {
      decision = await this.resolveFlow();
    } catch (err) {
      const reason = err instanceof import_core.OneloError ? err.message : String(err);
      console.warn("[Onelo] Auth flow could not be resolved \u2014 showing retry UI: " + reason);
      return this.presentFlowError(parentWindow);
    }
    if (decision.action === "authorized") {
      this.lastPresentedSurface = null;
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {
      });
      return this.getSession();
    }
    this.lastPresentedSurface = decision.surface || null;
    await this.rememberHostedOrigin(decision.url);
    return this.presentHostedUrl(decision.url, parentWindow);
  }
  /** Origin (`host`) serving this app's hosted surfaces, as last named by the
   *  backend. PERSISTED because a magic link can relaunch a killed process: the
   *  deep link then arrives before anything has spoken to the backend, and with
   *  no stored value there would be nothing to check against. */
  async rememberHostedOrigin(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" || !u.hostname) return;
      await this.storage.set(HOSTED_ORIGIN_KEY, u.hostname.toLowerCase());
    } catch {
    }
  }
  /** Is this URL one of Onelo's own hosted surfaces for this app?
   *
   *  Fails CLOSED: an unknown origin, a non-https URL, or no remembered anchor
   *  all answer false. A false negative costs one re-resolve back to sign-in; a
   *  false positive renders an attacker's page inside this app's own sign-in
   *  window, and any process on the machine can hand us a custom-scheme URL. */
  async isOneloHostedSurface(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") return false;
      const known = await this.storage.get(HOSTED_ORIGIN_KEY);
      return !!known && u.hostname.toLowerCase() === known;
    } catch {
      return false;
    }
  }
  /**
   * Present any Onelo-hosted flow URL (sign-in, store, …) in an in-app
   * BrowserWindow and complete it: a `<protocol>://…?code=` deep-link is
   * exchanged for a session (the user/buyer ends up signed in), while OAuth
   * provider pages are punted to the system browser (RFC 8252 — embedded
   * webviews are blocked/insecure). Resolves with the session, or null if the
   * window closed without a same-window code (e.g. OAuth handed off to the
   * browser — the session then arrives via app.on('open-url') → handleDeepLink).
   * Shared by presentAuthWindow and the store flow (OneloStore).
   */
  async presentHostedUrl(hostedUrl, parentWindow, title) {
    return new Promise((resolve, reject) => {
      import("electron").then(({ BrowserWindow }) => {
        const { width: winWidth, minWidth: winMinWidth } = hostedWindowSize(hostedUrl);
        const win = new BrowserWindow({
          // The hosted sign-up form (email + password + confirm + CTA + "Powered
          // by Onelo" footer) is taller than the old fixed 640 → the footer got
          // clipped and a scrollbar appeared. Open tall enough to show every
          // element AND enforce a floor via minWidth/minHeight so it can never be
          // shrunk below the point where content clips (resizable:true is what
          // makes minWidth/minHeight actually bind). Matches the feedback window
          // (720 / min 680) and Swift's 440-min-width.
          width: winWidth,
          height: 720,
          minWidth: winMinWidth,
          minHeight: 680,
          parent: parentWindow ?? void 0,
          modal: !!parentWindow,
          resizable: true,
          minimizable: false,
          maximizable: false,
          // #26 — paint the branding page background (checkout_bg_color, default
          // #111111) so the window doesn't flash white before the hosted page
          // paints. Parity with the customer-portal window (customer-portal.ts).
          backgroundColor: this.resolvedConfig?.pageBackgroundColor ?? "#111111",
          webPreferences: { nodeIntegration: false, contextIsolation: true },
          title: title ?? this.appName ?? "Sign in"
        });
        this.parkPendingFlow(resolve, win);
        win.loadURL(hostedUrl);
        win.setMenuBarVisibility(false);
        win.webContents.setWindowOpenHandler(({ url }) => {
          import("electron").then(({ shell }) => shell.openExternal(url));
          return { action: "deny" };
        });
        const isOAuthProviderUrl = (url) => {
          if (/\/api\/sdk\/auth\/oauth\/(google|github|apple)(\?|$)/.test(url)) {
            return true;
          }
          try {
            const host = new URL(url).host;
            return host === "github.com" || host === "accounts.google.com" || host === "appleid.apple.com";
          } catch {
            return false;
          }
        };
        const schemePrefix = `${this.protocol.toLowerCase()}://`;
        const handleNav = (event, url) => {
          if (url.toLowerCase().startsWith(schemePrefix)) {
            let expired = false;
            try {
              expired = isExpiredAuthError(new URL(url).searchParams.get("error"));
            } catch {
            }
            if (expired) {
              event.preventDefault();
              this.resolveFlow().then(async (decision) => {
                if (decision.action === "present") {
                  win.loadURL(decision.url);
                  return;
                }
                if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {
                });
                const session = await this.getSession();
                this.clearOwnParkedFlow(resolve);
                win.removeAllListeners("closed");
                win.close();
                resolve(session);
              }).catch(() => win.close());
              return;
            }
            win.webContents.removeListener("will-redirect", handleNav);
            win.webContents.removeListener("will-navigate", handleNav);
            this.clearOwnParkedFlow(resolve);
            win.removeAllListeners("closed");
            win.close();
            this.handleDeepLink(url).then((session) => {
              if (session) resolve(session);
              else reject(import_core.OneloError.server("Auth callback did not return a session"));
            }).catch(reject);
            return;
          }
          if (isOAuthProviderUrl(url)) {
            event.preventDefault();
            import("electron").then(({ shell }) => shell.openExternal(url));
            win.webContents.removeListener("will-redirect", handleNav);
            win.webContents.removeListener("will-navigate", handleNav);
            win.removeAllListeners("closed");
            win.close();
          }
        };
        win.webContents.on("will-redirect", handleNav);
        win.webContents.on("will-navigate", handleNav);
        win.on("closed", () => {
          this.clearOwnParkedFlow(resolve);
          resolve(null);
        });
      }).catch(reject);
    });
  }
  /**
   * #31 — Present a graceful error window with a "Try again" button when the auth
   * flow can't be resolved (attestation / codesign / bundle-id mismatch → 403,
   * store misconfig, offline). Called by presentAuthWindow's catch so a hard
   * reject shows UI instead of throwing without a window. Parity with Flutter
   * `_errorScaffold` (#30) and RN's retry screen.
   *
   * Resolves with the eventual session if the user hits "Try again" and the retry
   * succeeds, or `null` if they close the window (same "no session" contract as
   * presentHostedUrl closing without a code).
   */
  presentFlowError(parentWindow) {
    return new Promise((resolve, reject) => {
      import("electron").then(({ BrowserWindow }) => {
        const win = new BrowserWindow({
          // Same enforced floor as the hosted auth window (presentHostedUrl) so the
          // error/retry state doesn't render in an oddly-sized window.
          width: 480,
          height: 720,
          minWidth: 440,
          minHeight: 680,
          parent: parentWindow ?? void 0,
          modal: !!parentWindow,
          resizable: true,
          minimizable: false,
          maximizable: false,
          // Hard #111111 (NOT branding bg) — the error page is #111111 and the white
          // "Try again" button must stay legible; matches Flutter's error scaffold.
          backgroundColor: "#111111",
          webPreferences: { nodeIntegration: false, contextIsolation: true },
          title: this.appName ?? "Sign in"
        });
        win.setMenuBarVisibility(false);
        win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(flowErrorHtml())).catch(() => {
          if (!win.isDestroyed()) win.close();
        });
        let retrying = false;
        const onRetry = (event, url) => {
          if (!url.startsWith("onelo-retry://")) return;
          event.preventDefault();
          retrying = true;
          win.webContents.removeListener("will-redirect", onRetry);
          win.webContents.removeListener("will-navigate", onRetry);
          win.close();
          this.presentAuthWindow(parentWindow).then(resolve).catch(reject);
        };
        win.webContents.on("will-redirect", onRetry);
        win.webContents.on("will-navigate", onRetry);
        win.webContents.setWindowOpenHandler(({ url }) => {
          import("electron").then(({ shell }) => shell.openExternal(url));
          return { action: "deny" };
        });
        win.on("closed", () => {
          if (!retrying) resolve(null);
        });
      }).catch(reject);
    });
  }
  /**
   * Open the Onelo hosted sign-in page in the system default browser.
   * You must call handleDeepLink() from app.on('open-url') to complete the flow.
   *
   * @param onUrl  Optional callback to receive the hosted URL instead of opening it automatically
   */
  async presentHostedSignIn(onUrl) {
    await this.waitReady();
    if (this.isRevoked) throw import_core.OneloError.invalidKey("Application key has been revoked");
    const decision = await this.resolveFlow();
    if (decision.action === "authorized") {
      if (this.paywallEnabled) await this.revalidateEntitlement().catch(() => {
      });
      return;
    }
    if (onUrl) {
      onUrl(decision.url);
    } else {
      const { shell } = await import("electron");
      await shell.openExternal(decision.url);
    }
  }
  /**
   * Resolve the SINGLE next flow step from the backend, sending the current
   * session as a Bearer so /api/sdk/flow/init can decide `authorized` (already
   * signed in + entitled → no UI) vs `present` (open the hosted sign-in OR store
   * URL). This REPLACES the old always-present `/api/sdk/auth/initiate` — the
   * sign-in↔store↔content routing now lives once, behind Onelo's walls (parity
   * with Swift `resolveFlow` and JS `auth.ts:197`). Waitlist mode is surfaced as
   * a `present` so callers open it exactly like any hosted URL.
   */
  async resolveFlow() {
    if (this.resolvedConfig?.waitlistMode && this.resolvedConfig.sdkRedirectUrl) {
      return { action: "present", surface: "waitlist", url: this.resolvedConfig.sdkRedirectUrl };
    }
    const session = await this.getSession();
    const extra = {};
    if (session?.accessToken) extra["Authorization"] = `Bearer ${session.accessToken}`;
    const { status, json } = await (0, import_core2.httpGet)(
      `${this.apiUrl}/api/sdk/flow/init?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${encodeURIComponent(this.protocol)}`,
      sdkHeaders(this.bundleId, extra)
    );
    if (status !== 200) {
      const detail = json?.["detail"];
      const reason = typeof detail === "string" ? detail : `HTTP ${status}`;
      throw import_core.OneloError.server(`Failed to resolve auth flow: ${reason}`);
    }
    const j = json;
    if (j["action"] === "authorized") return { action: "authorized" };
    if (j["action"] === "present" && typeof j["url"] === "string") {
      if (j["app_name"]) this.appName = j["app_name"];
      if (j["app_logo_url"]) this.appLogoUrl = j["app_logo_url"];
      return { action: "present", surface: String(j["surface"] ?? ""), url: j["url"] };
    }
    throw import_core.OneloError.server("Invalid flow response");
  }
  /**
   * Handle a deep link URL from the OS open-url event.
   * Call this from your app's `open-url` handler (app.on('open-url', ...)).
   * Returns the session if the URL contains a valid auth code, null otherwise.
   */
  async handleDeepLink(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const scheme = this.protocol.replace(/:$/, "").toLowerCase();
    if (parsed.protocol.replace(/:$/, "").toLowerCase() !== scheme) return null;
    if (parsed.hostname.toLowerCase() !== "callback") return null;
    const gate = parsed.searchParams.get("gate");
    if (gate) {
      if (!await this.isOneloHostedSurface(gate)) {
        console.warn("[Onelo] refused a gate URL from an unknown origin");
        this.settlePendingFlow(null);
        return null;
      }
      this.settlePendingFlow(null);
      return this.presentHostedUrl(gate, null);
    }
    const code = parsed.searchParams.get("code");
    if (!code) return null;
    const { status, json } = await (0, import_core2.httpPost)(
      `${this.apiUrl}/api/sdk/auth/hosted-callback`,
      { publishableKey: this.publishableKey, code, code_verifier: this.pkceVerifier },
      sdkHeaders(this.bundleId)
    );
    if (status !== 200) {
      const detail = json?.["detail"];
      const reason = typeof detail === "string" ? detail : `HTTP ${status}`;
      this.settlePendingFlow(null);
      throw import_core.OneloError.server(`Hosted callback failed: ${reason}`);
    }
    const session = (0, import_core2.mapSession)(json);
    await this.saveSession(session);
    this.settlePendingFlow(session);
    return session;
  }
  /**
   * Open the Onelo-hosted sign-in page and complete the flow.
   *
   * ALWAYS hosted, on every plan. This used to branch on `allowCustomBranding`
   * and render an inline email/password form the SDK generated itself
   * (`auth-view-html.ts`, deleted 2026-08-19) — so the SAME call produced a
   * different UI depending on the tenant's plan, decided by a server flag rather
   * than by the developer.
   *
   * That inversion made a PAID tenant strictly worse off than a free one. The
   * inline form had no OAuth buttons, no "Forgot password?", no legal consent
   * gate (a developer relying on Onelo for GDPR consent simply did not get it)
   * and received no server-side auth rules, including the Apple App Store
   * sign-up gate. What the plan actually buys is hiding the Onelo footer — which
   * the BACKEND does, on the hosted page.
   *
   * Custom UI is untouched and is a different thing entirely: a developer builds
   * their own screen and calls `signIn()` / `signUp()` directly. Those methods
   * are public and unchanged. What is gone is the SDK substituting a second,
   * lesser UI of its own without being asked.
   *
   * Parity: Swift `OneloAuthView`, Flutter `OneloAuthView`, `@onelo/js`
   * `loadAuthView` — all hosted-only. See docs/sdk-access-gate-wiring.md.
   */
  async loadAuthView(parentWindow) {
    await this.waitReady();
    if (this.isRevoked) throw import_core.OneloError.invalidKey("Application key has been revoked");
    return this.presentAuthWindow(parentWindow);
  }
  // NOTE: a legacy `getOAuthUrl()` that called `@supabase/supabase-js`
  // `signInWithOAuth` directly was removed — it bypassed the Onelo backend OAuth
  // broker (BFF pattern) and was dead code (no caller). OAuth is handled by the
  // hosted page via `presentAuthWindow`, which correctly hands the provider
  // authorize URL to the system browser (`/api/sdk/auth/oauth/{provider}`).
  async sendMagicLink(email, redirectTo) {
    await this.waitReady();
    const body = { publishableKey: this.publishableKey, email };
    if (redirectTo) body.redirectTo = redirectTo;
    const { status } = await (0, import_core2.httpPost)(`${this.apiUrl}/api/sdk/auth/magic-link`, body, sdkHeaders(this.bundleId));
    if (status !== 200) throw import_core.OneloError.server(`Magic link request failed: HTTP ${status}`);
  }
  async sendPasswordReset(email, redirectTo) {
    await this.waitReady();
    const body = { publishableKey: this.publishableKey, email };
    if (redirectTo) body.redirectTo = redirectTo;
    const { status } = await (0, import_core2.httpPost)(`${this.apiUrl}/api/sdk/auth/reset-password/request`, body, sdkHeaders(this.bundleId));
    if (status !== 200) throw import_core.OneloError.server(`Password reset request failed: HTTP ${status}`);
  }
  // ── Private helpers ────────────────────────────────────────────────────────
  async saveSession(session) {
    const epoch = this.signOutEpoch;
    await Promise.all([
      this.storage.set(import_core2.TOKEN_KEYS.ACCESS_TOKEN, session.accessToken),
      this.storage.set(import_core2.TOKEN_KEYS.REFRESH_TOKEN, session.refreshToken),
      this.storage.set(import_core2.TOKEN_KEYS.EXPIRES_AT, String(session.expiresAt)),
      this.storage.set(import_core2.TOKEN_KEYS.USER_JSON, JSON.stringify(session.user))
    ]);
    if (epoch !== this.signOutEpoch) {
      await this.storage.clear();
      return;
    }
    this._notifySessionChange(session.user.id);
    this.startHeartbeat(session.accessToken);
    this.scheduleRefresh(session);
  }
  /**
   * Schedule a background refresh of the access token to fire `REFRESH_LEAD_SECONDS`
   * before it expires. Idempotent — cancels any pending refresh first. Without this,
   * an idle app would carry a stale token past its TTL and the next request would 401.
   */
  scheduleRefresh(session) {
    this.clearRefreshTimer();
    const nowSec = Date.now() / 1e3;
    const delaySec = session.expiresAt - nowSec - _OneloElectronAuth.REFRESH_LEAD_SECONDS;
    const delayMs = delaySec > 0 ? delaySec * 1e3 : 0;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshSession().catch(() => {
      });
    }, delayMs);
  }
  clearRefreshTimer() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
  /**
   * Tear down this module's background timers + the identity bridge so the
   * Electron process can exit cleanly. Called by `Onelo.destroy()`. This does
   * NOT sign out (no server revoke, tokens stay in storage) — it only stops the
   * SDK's own `setInterval`/`setTimeout` and drops the single-slot session
   * callback so it can't re-drive features/monitor after teardown. Parity with
   * JS `Onelo.destroy()` (authUnsubscribe + stopped timers).
   */
  dispose() {
    this.stopHeartbeat();
    this.clearRefreshTimer();
    this._sessionListeners = [];
  }
  startHeartbeat(accessToken) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      const session = await this.getSession();
      if (!session) {
        this.stopHeartbeat();
        return;
      }
      try {
        const res = await fetch(`${this.apiUrl}/api/sdk/presence/heartbeat`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` }
        });
        if (res.status === 401) {
          this.stopHeartbeat();
          this.clearRefreshTimer();
          await this.storage.clear();
          this.isUserRevoked = true;
          this._notifySessionChange(null);
        }
      } catch {
      }
    }, _OneloElectronAuth.HEARTBEAT_MS);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
};
_OneloElectronAuth.HEARTBEAT_MS = 13 * 60 * 1e3;
/** Refresh this many seconds before the access token expires. */
_OneloElectronAuth.REFRESH_LEAD_SECONDS = 60;
var OneloElectronAuth = _OneloElectronAuth;

// src/features.ts
var import_https = __toESM(require("https"));
var import_http = __toESM(require("http"));
init_sdk_headers();
init_instance_id();

// src/feature-cache.ts
function cacheFile() {
  try {
    const { app } = require("electron");
    const path = require("path");
    return path.join(app.getPath("userData"), "onelo", "features.json");
  } catch {
    return null;
  }
}
function keyFor(publishableKey, userId) {
  return `${publishableKey}_${userId ?? "anon"}`;
}
function readFeatureCache(publishableKey, userId) {
  const file = cacheFile();
  if (!file) return null;
  try {
    const fs = require("fs");
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    return all[keyFor(publishableKey, userId)] ?? null;
  } catch {
    return null;
  }
}
function writeFeatureCache(publishableKey, userId, snapshot) {
  const file = cacheFile();
  if (!file) return;
  try {
    const fs = require("fs");
    const path = require("path");
    let all = {};
    try {
      all = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
    }
    all[keyFor(publishableKey, userId)] = snapshot;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(all));
  } catch {
  }
}

// src/features.ts
var OneloFeaturesError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "OneloFeaturesError";
  }
};
var KNOWN_STATUSES = /* @__PURE__ */ new Set([
  "enabled",
  "disabled",
  "greyed",
  "hidden",
  "upsell",
  "new",
  "beta",
  "coming_soon"
]);
function normalizeStatus(status) {
  return KNOWN_STATUSES.has(status) ? status : "hidden";
}
var KNOWN_REASONS = /* @__PURE__ */ new Set([
  "user_override",
  "plan",
  "default",
  "static",
  "paywall_no_plan",
  "paywall_off",
  "suspended",
  "unknown"
]);
function normalizeReason(reason) {
  if (reason == null) return void 0;
  return KNOWN_REASONS.has(reason) ? reason : "unknown";
}
function toRecord(w) {
  return {
    status: normalizeStatus(w.status),
    reason: normalizeReason(w.reason),
    requiredPlan: w.required_plan,
    requiredPlanLabel: w.required_plan_label,
    upgradeCta: w.upgrade_cta ?? false
  };
}
var FeatureState = class {
  constructor(name, status, reason, requiredPlan, requiredPlanLabel, upgradeCta = false) {
    this.name = name;
    this.status = status;
    this.reason = reason;
    this.requiredPlan = requiredPlan;
    this.requiredPlanLabel = requiredPlanLabel;
    this.upgradeCta = upgradeCta;
  }
  get isEnabled() {
    return this.status === "enabled" || this.status === "new" || this.status === "beta";
  }
  get isDisabled() {
    return this.status === "disabled";
  }
  get isVisible() {
    return this.status !== "hidden";
  }
  get isGreyed() {
    return this.status === "greyed";
  }
  get isUpsell() {
    return this.status === "upsell";
  }
  get isNew() {
    return this.status === "new";
  }
  get isBeta() {
    return this.status === "beta";
  }
  get isComingSoon() {
    return this.status === "coming_soon";
  }
  /** Promo/lock badge (parity with Swift/JS): New/Beta/Coming Soon, 🔒 for greyed
   *  (locked — never hide it), and "Available in <plan>" for upsell. */
  get badgeLabel() {
    switch (this.status) {
      case "new":
        return "New";
      case "beta":
        return "Beta";
      case "coming_soon":
        return "Coming Soon";
      case "greyed":
        return "\u{1F512}";
      case "upsell":
        if (this.requiredPlanLabel) return `Available in ${this.requiredPlanLabel}`;
        if (this.requiredPlan) return `Available in ${this.requiredPlan}`;
        return "Upgrade";
      default:
        return null;
    }
  }
  /** Non-null when the feature is plan-blocked AND the backend named the
   *  unlocking plan — surface in upgrade-prompt UI (parity with JS). */
  get upgradeHint() {
    if (this.reason === "plan" && this.requiredPlan && (this.status === "greyed" || this.status === "hidden" || this.status === "upsell" || this.status === "coming_soon")) {
      return { requiredPlan: this.requiredPlan, currentStatus: this.status };
    }
    return null;
  }
  /** IPC-safe plain object — every computed getter materialized as a data property
   *  so it survives Electron structured-clone IPC (`webContents.send` /
   *  `ipcMain.handle`), which drops prototype accessors. Send THIS across IPC, not
   *  the FeatureState instance. Also used automatically by `JSON.stringify`. */
  toJSON() {
    return {
      name: this.name,
      status: this.status,
      reason: this.reason,
      requiredPlan: this.requiredPlan,
      requiredPlanLabel: this.requiredPlanLabel,
      upgradeCta: this.upgradeCta,
      isEnabled: this.isEnabled,
      isDisabled: this.isDisabled,
      isVisible: this.isVisible,
      isGreyed: this.isGreyed,
      isUpsell: this.isUpsell,
      isNew: this.isNew,
      isBeta: this.isBeta,
      isComingSoon: this.isComingSoon,
      badgeLabel: this.badgeLabel,
      upgradeHint: this.upgradeHint
    };
  }
};
function request(url, opts) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? import_https.default : import_http.default;
    const bodyStr = opts.body !== void 0 ? JSON.stringify(opts.body) : void 0;
    const base = sdkHeaders(opts.bundleId);
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method,
        headers: bodyStr ? { ...base, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) } : base
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: null });
          }
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
var POLL_INTERVAL_MS = 6e4;
var _OneloFeatures = class _OneloFeatures {
  constructor(publishableKey, apiUrl, monitor, bundleId, options) {
    this.cache = /* @__PURE__ */ new Map();
    this.discovered = /* @__PURE__ */ new Set();
    this.configVersion = 0;
    this.pollTimer = null;
    this.pingDebounce = null;
    this.monitor = null;
    this.anonymousWarningLogged = false;
    /** In-memory observers notified AFTER any cache change (SSE Deploy push,
     *  lifecycle resync, invalidateCache). Purely local fan-out — no network/DB/SSE.
     *  In Electron the SDK runs in the MAIN process; forward these to the renderer
     *  over IPC (main subscribe → webContents.send) so the UI re-renders on a Deploy. */
    this.changeListeners = /* @__PURE__ */ new Set();
    /** Shared SSE stream (real-time deploys). When present, it is the primary
     *  update channel; the 60s poll runs ONLY as the fallback when the stream is
     *  capped out (429 → X-Fallback: poll). */
    this.stream = null;
    this.currentUserId = null;
    /** HMAC-SHA256(secretKey, "user:"+userId), computed on the DEVELOPER's backend
     *  and passed via identify(userId, userIdHash). The SDK never computes it. Sent
     *  on resolve/batch-ping/poll/stream for secure mode. Null = not secure mode. */
    this.currentUserIdHash = null;
    this.streamActive = false;
    /** True once the first SSE `connected`/`up_to_date` (or a successful resolve)
     *  has landed — gates `ready()` (parity with Swift firstEventReceived). */
    this.firstEventReceived = false;
    this.readyWaiters = /* @__PURE__ */ new Set();
    /** Debounce for refresh() (parity with Swift 1s). */
    this.lastRefreshAt = 0;
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    this.monitor = monitor ?? null;
    this.bundleId = bundleId;
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false;
    this.featureEnvironment = options?.featureEnvironment;
    this.defaultStatus = options?.featureDefaultStatus ?? "hidden";
  }
  /**
   * Subscribe to feature-cache changes so the host can re-render / forward to the
   * renderer the instant a fresh snapshot lands (SSE Deploy, lifecycle resync,
   * invalidateCache). Fires AFTER the cache is updated; re-read feature(name)
   * inside. Purely local (no network/DB/SSE). Returns an unsubscribe fn. In
   * Electron, wire it to `webContents.send` to push updates to the renderer UI.
   * Parity with the RN/JS `subscribe()`.
   */
  subscribe(listener) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }
  /** Notify subscribers after a cache mutation. A throwing listener never breaks
   *  cache application. */
  _emitChange() {
    for (const l of [...this.changeListeners]) {
      try {
        l();
      } catch {
      }
    }
  }
  /** Convenience: `true` when the feature resolves to an active status
   *  (enabled / new / beta). Equivalent to `feature(name).isEnabled`. Parity with RN. */
  isEnabled(name) {
    return this.feature(name).isEnabled;
  }
  /** IPC-safe snapshot of a feature — a plain object with every computed getter
   *  materialized as a data property. Return THIS from an `ipcMain.handle` /
   *  `webContents.send` handler in the main process; a raw `feature()` result loses
   *  its getters over structured-clone IPC and every feature would read as hidden. */
  featureSnapshot(name) {
    return this.feature(name).toJSON();
  }
  feature(name) {
    const isNew = !this.discovered.has(name);
    this.discovered.add(name);
    if (isNew) this._scheduleBatchPing();
    if (isNew) this.monitor?._trackFeatureCall(name);
    const rec = this.cache.get(name) ?? { status: this.defaultStatus, upgradeCta: false };
    this.monitor?.recordFlag?.(name, rec.status);
    return new FeatureState(name, rec.status, rec.reason, rec.requiredPlan, rec.requiredPlanLabel, rec.upgradeCta);
  }
  declare(names) {
    for (const name of names) this.discovered.add(name);
    this._scheduleBatchPing();
  }
  getActiveFeatures() {
    const active = [];
    for (const [name, rec] of this.cache) {
      if (new FeatureState(name, rec.status).isEnabled) active.push(name);
    }
    return active;
  }
  /**
   * Mint a short-lived entitlement token for `slug` — proof the current user is
   * entitled to that feature, verifiable by your backend. Requires an identified
   * user. Parity with Swift `moduleToken(for:)`.
   *
   * @throws OneloFeaturesError — `notAuthenticated` (no user, no network),
   *   `notEntitled` (403), `secureModeRequired`/`invalidUserHash` (401 secure
   *   mode), `networkError` (anything else, incl. the backend's current 503).
   */
  async moduleToken(slug) {
    if (!this.currentUserId) throw new OneloFeaturesError("notAuthenticated");
    let status;
    let json;
    try {
      ({ status, json } = await request(`${this.apiUrl}/api/sdk/features/module-token`, {
        method: "POST",
        body: {
          publishableKey: this.publishableKey,
          userId: this.currentUserId,
          slug,
          ...this.currentUserIdHash ? { userIdHash: this.currentUserIdHash } : {}
        },
        bundleId: this.bundleId
      }));
    } catch {
      throw new OneloFeaturesError("networkError");
    }
    if (status === 200) {
      const token = json?.token;
      if (typeof token === "string" && token.length > 0) return token;
      throw new OneloFeaturesError("networkError");
    }
    if (status === 401) {
      const j = json;
      const err = (typeof j?.detail === "object" ? j?.detail?.error : void 0) ?? j?.error;
      if (err === "secure_mode_required") throw new OneloFeaturesError("secureModeRequired");
      if (err === "invalid_user_hash") throw new OneloFeaturesError("invalidUserHash");
      throw new OneloFeaturesError("notAuthenticated");
    }
    if (status === 403) throw new OneloFeaturesError("notEntitled");
    throw new OneloFeaturesError("networkError");
  }
  /**
   * Wire the shared SSE stream (called once by Onelo, before the first _load).
   * Registers the snapshot handlers + the dynamic `since_version` param provider
   * (read fresh on every reconnect). When attached, the stream is the primary
   * update channel and polling is off — unless a 429 cap forces the poll fallback.
   */
  attachEventStream(stream) {
    this.stream = stream;
    stream.addParamProvider(() => {
      const p = {
        since_version: String(this.configVersion),
        // Per-install id — feature-discovery TOFU binding (parity with Swift/JS).
        instance_id: getInstanceId()
      };
      if (this.featureEnvironment) p.environment = this.featureEnvironment;
      if (this.currentUserIdHash) p.userIdHash = this.currentUserIdHash;
      return p;
    });
    const applyIfSnapshot = (data) => {
      const features = data["features"];
      if (!features) return;
      const v = typeof data["config_version"] === "number" ? data["config_version"] : this.configVersion;
      this._applySnapshot(v, features);
    };
    stream.on("connected", (data) => {
      applyIfSnapshot(data);
      this._signalFirstEvent();
    });
    stream.on("features_updated", applyIfSnapshot);
    stream.on("up_to_date", (data) => {
      if (typeof data["config_version"] === "number") this.configVersion = data["config_version"];
      this._signalFirstEvent();
    });
    stream.on("discovery_requested", () => {
      this._scheduleBatchPing();
    });
    stream.onFallback(() => {
      this.streamActive = false;
      void this._resolve(this.currentUserId).catch(() => {
      });
      this._startPolling(this.currentUserId);
    });
  }
  async _load(userId, userIdHash) {
    const identityChanged = userId !== this.currentUserId;
    this.currentUserId = userId;
    this.currentUserIdHash = userIdHash ?? null;
    if (identityChanged || this.configVersion === 0 && this.cache.size === 0) {
      const cached2 = readFeatureCache(this.publishableKey, userId);
      if (cached2) {
        this.cache = new Map(
          Object.entries(cached2.features).map(([k, v]) => [k, this._coerceRecord(v)])
        );
        this.configVersion = cached2.configVersion;
      } else if (identityChanged) {
        this.cache = /* @__PURE__ */ new Map();
        this.configVersion = 0;
      }
      this._emitChange();
    }
    this._stopPolling();
    if (this.stream) {
      this.streamActive = true;
      this.stream.start(userId);
    }
    await this._batchPing();
    if (!this.stream) {
      await this._resolve(userId);
      this._startPolling(userId);
    }
  }
  _applySnapshot(version2, features) {
    this.cache = new Map(Object.entries(features).map(([k, v]) => [k, toRecord(v)]));
    this.configVersion = version2;
    writeFeatureCache(this.publishableKey, this.currentUserId, {
      configVersion: version2,
      features: Object.fromEntries(this.cache)
    });
    this._emitChange();
  }
  /** Coerce a persisted cache value back to a FeatureRecord, re-normalizing the
   *  status defensively (a value persisted by an older/newer SDK). */
  _coerceRecord(v) {
    const r = v ?? {};
    return {
      status: normalizeStatus(String(r.status ?? "hidden")),
      reason: normalizeReason(r.reason),
      requiredPlan: r.requiredPlan,
      requiredPlanLabel: r.requiredPlanLabel,
      upgradeCta: r.upgradeCta ?? false
    };
  }
  /** Resolve all pending `ready()` waiters once the first event lands. Idempotent. */
  _signalFirstEvent() {
    if (this.firstEventReceived) return;
    this.firstEventReceived = true;
    for (const resolve of this.readyWaiters) resolve();
    this.readyWaiters.clear();
  }
  /**
   * Await the first feature snapshot/handshake so the app can render
   * feature-dependent UI without a cold-start flicker — but never block longer
   * than `timeoutMs` (default 1500). Resolves immediately if already ready.
   * Parity with Swift `ready(timeout:)`.
   */
  async ready(timeoutMs = 1500) {
    if (this.firstEventReceived) return;
    await new Promise((resolve) => {
      let done = false;
      const settle = () => {
        if (!done) {
          done = true;
          this.readyWaiters.delete(settle);
          resolve();
        }
      };
      this.readyWaiters.add(settle);
      const t = setTimeout(settle, timeoutMs);
      t.unref?.();
    });
  }
  /**
   * Manually re-resolve features from the backend (e.g. after a checkout or on
   * app resume). Debounced to 1s unless `force` is true. Never throws. Parity
   * with Swift `refresh(force:)`.
   */
  async refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.lastRefreshAt < _OneloFeatures.REFRESH_DEBOUNCE_MS) return;
    this.lastRefreshAt = now;
    await this._resolve(this.currentUserId);
  }
  /**
   * Re-sync on app lifecycle (resume from sleep / window re-activate). Under OS
   * suspension the SSE socket + the silence watchdog are both frozen, so the
   * system wake event is the only reliable heal trigger. Reconnects the stream
   * and force-refreshes over REST. Parity with Swift `_resyncOnLifecycle`.
   */
  _resyncOnLifecycle() {
    if (this.streamActive) this.stream?.reconnect();
    void this.refresh(true);
  }
  /** Stop background polling. Call when the SDK is no longer needed. */
  stopPolling() {
    this._stopPolling();
  }
  /** Clears the local feature cache and resets the config version. Forces the
   *  stream to resend a full snapshot (since_version=0) — a live connection stays
   *  silent otherwise. */
  invalidateCache() {
    this.cache = /* @__PURE__ */ new Map();
    this.configVersion = 0;
    if (this.streamActive) this.stream?.reconnect();
    this._emitChange();
  }
  _stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pingDebounce) {
      clearTimeout(this.pingDebounce);
      this.pingDebounce = null;
    }
  }
  _scheduleBatchPing() {
    if (this.pingDebounce) clearTimeout(this.pingDebounce);
    this.pingDebounce = setTimeout(() => {
      this._batchPing().catch(() => {
      });
    }, 1e3);
  }
  async _batchPing() {
    const features = Array.from(this.discovered);
    if (features.length === 0) return;
    const isTestEnv = this.featureEnvironment === "test" || this.publishableKey.includes("_test_");
    if (!isTestEnv && Math.random() > 0.01) return;
    try {
      await request(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        method: "POST",
        body: {
          publishableKey: this.publishableKey,
          features,
          // Per-user signal (camelCase `userId` — matches the backend
          // BatchPingRequest model + Swift/JS). Omitted (not null) when anonymous.
          ...this.currentUserId ? { userId: this.currentUserId } : {},
          ...this.currentUserIdHash ? { userIdHash: this.currentUserIdHash } : {},
          ...this.featureEnvironment ? { environment: this.featureEnvironment } : {}
        },
        bundleId: this.bundleId
      });
    } catch {
    }
  }
  async _resolve(userId) {
    try {
      const body = { publishableKey: this.publishableKey };
      if (userId) body.userId = userId;
      if (this.currentUserIdHash) body.userIdHash = this.currentUserIdHash;
      if (this.featureEnvironment) body.environment = this.featureEnvironment;
      const { json } = await request(`${this.apiUrl}/api/sdk/features/resolve`, { method: "POST", body, bundleId: this.bundleId });
      const data = json;
      const features = data["features"];
      if (features) {
        this._applySnapshot(typeof data["config_version"] === "number" ? data["config_version"] : this.configVersion, features);
      } else if (typeof data["config_version"] === "number") {
        this.configVersion = data["config_version"];
      }
      this._maybeWarnAnonymous(data);
      this._signalFirstEvent();
    } catch {
    }
  }
  /**
   * Logs a one-time warning when the backend reports anonymous mode (no userId)
   * AND at least one targeted feature was hidden purely because of it. Helps
   * developers using their own auth system catch missing identify() calls.
   */
  _maybeWarnAnonymous(response) {
    if (this.suppressIdentifyWarning || this.anonymousWarningLogged) return;
    if (response["anonymous"] !== true) return;
    const misses = typeof response["targeting_misses"] === "number" ? response["targeting_misses"] : 0;
    if (misses <= 0) return;
    this.anonymousWarningLogged = true;
    console.warn(
      `[Onelo] ${misses} feature(s) hidden because no user is identified.
If you handle auth yourself, call onelo.identify(userId) after login so per-user/per-plan targeting can apply.
If your app is intentionally anonymous, pass suppressIdentifyWarning: true in OneloElectronConfig to silence this.`
    );
  }
  async _poll(userId) {
    try {
      const params = new URLSearchParams({
        key: this.publishableKey,
        // Backend /poll expects `since_version` (its up_to_date short-circuit
        // keys off it) — NOT `version`, which it ignores.
        since_version: String(this.configVersion)
      });
      if (this.featureEnvironment) params.set("environment", this.featureEnvironment);
      if (userId) params.set("userId", userId);
      if (this.currentUserIdHash) params.set("userIdHash", this.currentUserIdHash);
      const { status, json } = await request(
        `${this.apiUrl}/api/sdk/features/poll?${params}`,
        { method: "GET", bundleId: this.bundleId }
      );
      if (status !== 200) return;
      const data = json;
      if (data["up_to_date"] === true) return;
      const features = data["features"];
      if (features) {
        this._applySnapshot(typeof data["config_version"] === "number" ? data["config_version"] : this.configVersion, features);
      } else if (typeof data["config_version"] === "number") {
        this.configVersion = data["config_version"];
      }
      if (data["discovery_requested"] === true) {
        await this._batchPing();
      }
    } catch {
    }
  }
  _startPolling(userId) {
    this._stopPolling();
    this.pollTimer = setInterval(() => {
      this._poll(userId).catch(() => {
      });
    }, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }
};
_OneloFeatures.REFRESH_DEBOUNCE_MS = 1e3;
var OneloFeatures = _OneloFeatures;

// src/feedback.ts
var import_https2 = __toESM(require("https"));
var import_http2 = __toESM(require("http"));
init_sdk_headers();
function httpGet2(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? import_https2.default : import_http2.default;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) });
          } catch {
            resolve({ status: res.statusCode ?? 0, json: null });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}
var FEEDBACK_SUBMITTED_SENTINEL = "onelo://feedback_submitted";
var FEEDBACK_CLOSE_SENTINEL = "onelo://feedback_close";
var FEEDBACK_RETRY_SENTINEL = "onelo://feedback_retry";
var POSTMESSAGE_RELAY_SCRIPT = `
(function () {
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'onelo:feedback_submitted') {
      window.location.href = '${FEEDBACK_SUBMITTED_SENTINEL}';
    } else if (e.data && e.data.type === 'onelo:feedback_close') {
      window.location.href = '${FEEDBACK_CLOSE_SENTINEL}';
    }
  });
})();
`;
var SKELETON_HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #111;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 40px 36px 32px;
    overflow: hidden;
  }
  @keyframes shimmer {
    0%   { background-position: -600px 0; }
    100% { background-position:  600px 0; }
  }
  .sk {
    border-radius: 10px;
    background: linear-gradient(90deg, #1e1e1e 25%, #2a2a2a 50%, #1e1e1e 75%);
    background-size: 600px 100%;
    animation: shimmer 1.4s infinite linear;
  }
  .icon     { width: 64px; height: 64px; border-radius: 14px; margin: 0 auto 16px; }
  .title    { width: 220px; height: 22px; margin: 0 auto 40px; border-radius: 6px; }
  .cards    { display: flex; gap: 12px; margin-bottom: 32px; }
  .card     { flex: 1; height: 76px; border-radius: 12px; }
  .label    { width: 60px; height: 13px; border-radius: 4px; margin-bottom: 8px; }
  .input    { width: 100%; height: 44px; border-radius: 10px; margin-bottom: 24px; }
  .textarea { width: 100%; height: 110px; border-radius: 10px; margin-bottom: 32px; }
  .btn      { width: 100%; height: 48px; border-radius: 12px; }
</style>
</head>
<body>
  <div class="sk icon"></div>
  <div class="sk title"></div>
  <div class="cards">
    <div class="sk card"></div>
    <div class="sk card"></div>
    <div class="sk card"></div>
  </div>
  <div class="sk label"></div>
  <div class="sk input"></div>
  <div class="sk label"></div>
  <div class="sk textarea"></div>
  <div class="sk btn"></div>
</body>
</html>`;
var OneloFeedback = class {
  constructor(config, features) {
    this.window = null;
    this.config = config;
    this.features = features;
  }
  /** No-op shim — session context is now derived from active feature flags automatically. */
  track(_area) {
  }
  buildInitiateUrl(options) {
    const params = new URLSearchParams({ key: this.config.publishableKey });
    if (options?.type) params.set("type", options.type);
    if (options?.area) params.set("area", options.area);
    const active = this.features.getActiveFeatures();
    if (active.length > 0) {
      params.set("session", JSON.stringify(active));
    }
    return `${this.config.apiUrl}/api/sdk/feedback/initiate?${params.toString()}`;
  }
  open(options) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus();
      return;
    }
    void this._openAsync(options);
  }
  async _openAsync(options) {
    const { BrowserWindow } = await import("electron");
    this.window = new BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 480,
      minHeight: 680,
      resizable: true,
      title: "Send Feedback",
      backgroundColor: "#111111",
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    this.window.show();
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      void import("electron").then(({ shell }) => shell.openExternal(url));
      return { action: "deny" };
    });
    this.window.on("closed", () => {
      this.window = null;
    });
    const handleNav = (event, url) => {
      if (url.startsWith(FEEDBACK_SUBMITTED_SENTINEL) || url.startsWith(FEEDBACK_CLOSE_SENTINEL)) {
        event.preventDefault();
        this.window?.close();
        this.window = null;
      } else if (url.startsWith(FEEDBACK_RETRY_SENTINEL)) {
        event.preventDefault();
        void this._loadHostedForm(options);
      }
    };
    this.window.webContents.on("will-navigate", handleNav);
    this.window.webContents.on("will-redirect", handleNav);
    await this._loadHostedForm(options);
  }
  /** Show the skeleton, resolve the hosted URL, and navigate the WebView. On
   *  failure renders an in-window error screen WITH a Retry button (never a
   *  silent close). Retry (the button's onelo://feedback_retry nav → handleNav)
   *  re-invokes this exact method — 1:1 with Swift's loadHostedForm/onRetry. */
  async _loadHostedForm(options) {
    if (!this.window || this.window.isDestroyed()) return;
    try {
      await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SKELETON_HTML)}`);
      if (!this.window || this.window.isDestroyed()) return;
      const initiateUrl = this.buildInitiateUrl(options);
      const headers = { ...sdkHeaders(this.config.bundleId), ...options?.userId ? { "X-Onelo-User-Id": options.userId } : {} };
      const { status, json } = await httpGet2(initiateUrl, headers);
      if (status < 200 || status >= 300) {
        await this._showError(`Couldn't load feedback (HTTP ${status}).`);
        return;
      }
      const { hosted_url } = json;
      if (!this.window || this.window.isDestroyed()) return;
      await this.window.loadURL(hosted_url);
      await this.window.webContents.executeJavaScript(POSTMESSAGE_RELAY_SCRIPT);
    } catch {
      await this._showError("Couldn't reach the feedback service. Check your connection and try again.");
    }
  }
  /** Render an error screen WITH a "Try again" button inside the feedback window
   *  instead of silently closing (no-silent-swallows). The button navigates to
   *  the onelo://feedback_retry sentinel, which handleNav (installed once in
   *  _openAsync) intercepts → re-runs _loadHostedForm in the SAME window. This is
   *  the 1:1 parity with Swift's errorHTML + onRetry (JS just throws — no retry). */
  async _showError(message) {
    if (!this.window || this.window.isDestroyed()) return;
    const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const html = `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{height:100%}
      body{background:#111;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 36px}
      .title{font-size:17px;font-weight:600;margin-bottom:10px}
      .msg{font-size:13px;color:#9a9a9a;line-height:1.5;max-width:320px;margin-bottom:28px}
      .btn{appearance:none;border:0;cursor:pointer;background:#fff;color:#111;font-size:14px;font-weight:600;padding:11px 22px;border-radius:10px}
      .btn:active{opacity:.8}</style>
      <div class="title">Couldn't load feedback</div>
      <div class="msg">${safe}</div>
      <button class="btn" onclick="window.location.href='${FEEDBACK_RETRY_SENTINEL}'">Try again</button>`;
    try {
      await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    } catch {
    }
  }
};

// src/monitor.ts
var import_os2 = __toESM(require("os"));

// src/scrubber.ts
var REDACTED = "[REDACTED]";
var MAX_DEPTH = 10;
var KEY_DENYLIST = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "private_key",
  "client_secret",
  "cvv",
  "ssn"
];
var VALUE_PATTERNS = [
  /(^|[^A-Za-z0-9])Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(^|[^A-Za-z0-9])eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+(?![A-Za-z0-9])/g,
  // JWT
  /(^|[^A-Za-z0-9])(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}(?![A-Za-z0-9])/g,
  // Stripe-style
  /(^|[^A-Za-z0-9])onelo_(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}(?![A-Za-z0-9])/g,
  // Onelo keys
  /(^|[^A-Za-z0-9])(?:4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6(?:011|5[0-9]{2}))[\s-][0-9]{4}[\s-][0-9]{4}[\s-][0-9]{4}(?![A-Za-z0-9])/g,
  // CC separated
  /(^|[^A-Za-z0-9])(?:4|5[1-5]|6(?:011|5))[0-9]{14,}(?![0-9])/g,
  // CC unseparated
  /(^|[^A-Za-z0-9])3[47][0-9]{13,}(?![0-9])/g
  // Amex
];
function keyIsPii(key) {
  const k = key.toLowerCase();
  if (KEY_DENYLIST.some((p) => k.includes(p))) return true;
  return k.replace(/-/g, "_").split("_").includes("key");
}
function scrubText(text) {
  let out = text;
  for (const pat of VALUE_PATTERNS) out = out.replace(pat, (_m, boundary) => boundary + REDACTED);
  return out;
}
function scrubValue(value, redacted, depth) {
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, redacted, depth + 1));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "_onelo_redacted") {
        out[k] = v;
        continue;
      }
      if (keyIsPii(k)) {
        redacted.add(k);
        out[k] = REDACTED;
      } else out[k] = scrubValue(v, redacted, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return scrubText(value);
  return value;
}
function scrubMeta(meta) {
  if (meta == null) return meta;
  const redacted = /* @__PURE__ */ new Set();
  const cleaned = scrubValue(meta, redacted, 0);
  if (redacted.size > 0) cleaned["_onelo_redacted"] = Array.from(redacted).sort();
  return cleaned;
}

// src/monitor.ts
init_package();
var MAX_BUFFER_SIZE = 200;
var MAX_FLAGS = 100;
var MAX_BREADCRUMBS = 100;
var PLATFORM = "electron";
var SDK_NAME = "@onelo/electron";
var MAX_RETRY_AFTER_MS = 36e5;
var DEFAULT_SEND_TIMEOUT_MS = 1e4;
var _warn = (...args) => console.warn("[onelo.monitor]", ...args);
function _parseRetryAfter(res) {
  let raw = null;
  try {
    raw = res.headers?.get?.("Retry-After") ?? null;
  } catch {
  }
  if (!raw) return 0;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(seconds * 1e3, MAX_RETRY_AFTER_MS));
}
function _extractError(err) {
  if (err instanceof Error) return { message: err.message, stack: err.stack, errorType: err.name };
  return { message: String(err) };
}
function _deviceContext() {
  const d = {};
  try {
    d["platform"] = process.platform;
    d["osRelease"] = import_os2.default.release();
    d["arch"] = process.arch;
    d["nodeVersion"] = process.version;
  } catch {
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) d["timezone"] = tz;
  } catch {
  }
  return d;
}
var _activeMonitor = null;
var _handlersInstalled = false;
var _lifecycleInstalled = false;
function _installLifecycleFlush() {
  if (_lifecycleInstalled) return;
  let app;
  try {
    app = require("electron").app;
  } catch {
    return;
  }
  if (!app || typeof app.on !== "function") return;
  _lifecycleInstalled = true;
  let flushed = false;
  app.on("before-quit", (event) => {
    const m = _activeMonitor;
    if (flushed || !m || !m._hasPending()) return;
    flushed = true;
    event.preventDefault();
    void m.flush(2e3).finally(() => app.quit());
  });
}
function _installGlobalHandlers() {
  if (_handlersInstalled) return;
  const proc = globalThis.process;
  if (!proc || typeof proc.on !== "function") return;
  _handlersInstalled = true;
  proc.on("uncaughtExceptionMonitor", (err) => {
    const { message, stack } = _extractError(err);
    _activeMonitor?._onGlobalError(message, stack);
  });
}
var OneloMonitor = class {
  constructor(publishableKey, apiUrl, context) {
    this.sessionId = crypto.randomUUID();
    this.buffer = [];
    // Aggregated feature-call counters (name→count). Kept SEPARATE from the capped
    // event buffer so a burst of feature discoveries never evicts real errors;
    // drained into one `feature_call_summary` event per feature at flush. Mirrors
    // Swift's summaryBuffer (OneloMonitor.swift).
    this.summaryBuffer = /* @__PURE__ */ new Map();
    // Rolling LRU snapshot of the most recently evaluated feature flags
    // (name→status), attached to ERROR events (flag↔error correlation).
    this.flags = /* @__PURE__ */ new Map();
    // Ring buffer of breadcrumbs (the trail leading to an error), snapshotted into
    // meta.breadcrumbs on error events.
    this.breadcrumbs = [];
    this.flushTimer = null;
    this.currentUserId = null;
    /** Serialises all drains so a timer flush and an error flush can't overlap. */
    this.flushChain = Promise.resolve();
    /** Epoch ms until which we hold off sending (set from a 429 `Retry-After`). */
    this.retryAfterUntil = 0;
    this.publishableKey = publishableKey;
    this.apiUrl = apiUrl;
    this.bundleId = context?.bundleId;
    this.environment = context?.environment;
    const app = {};
    if (context?.appVersion) app.version = context.appVersion;
    if (context?.appBuild) app.build = context.appBuild;
    if (context?.bundleId) app.bundleId = context.bundleId;
    this.staticMeta = {
      sdk: { name: SDK_NAME, version },
      ...Object.keys(app).length ? { app } : {}
    };
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 15e3);
    this.flushTimer.unref?.();
    _activeMonitor = this;
    _installGlobalHandlers();
    _installLifecycleFlush();
    this._push("session_opened", true, void 0, void 0, void 0, "event");
  }
  /** True when there is buffered telemetry not yet delivered (events queued, or
   *  feature-call counters awaiting their summary drain). Read by the clean-quit
   *  lifecycle flush so it only delays the quit when there's actually something
   *  to send. Package-private. */
  _hasPending() {
    return this.buffer.length > 0 || this.summaryBuffer.size > 0;
  }
  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId) {
    this.currentUserId = userId;
  }
  _trackFeatureCall(featureName) {
    this.summaryBuffer.set(featureName, (this.summaryBuffer.get(featureName) ?? 0) + 1);
  }
  /**
   * Record the current value of a feature flag for flag↔error correlation.
   * Called by OneloFeatures on every evaluation. LRU: re-recording a key moves
   * it to most-recent; capped at MAX_FLAGS. Not an event — just updates the
   * snapshot attached to future error captures.
   */
  recordFlag(key, value) {
    if (this.flags.has(key)) this.flags.delete(key);
    this.flags.set(key, value);
    if (this.flags.size > MAX_FLAGS) {
      const oldest = this.flags.keys().next().value;
      if (oldest !== void 0) this.flags.delete(oldest);
    }
  }
  async track(featureName, fn, options) {
    const start = Date.now();
    try {
      const result = await fn();
      this._push(featureName, true, Date.now() - start, void 0, options?.meta, "track");
      return result;
    } catch (err) {
      const { message, stack, errorType } = _extractError(err);
      this._push(featureName, false, Date.now() - start, message, this._withError(options?.meta, stack, errorType), "track");
      throw err;
    }
  }
  event(featureName, opts) {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, "event");
  }
  /**
   * Add a breadcrumb — a step in the trail leading to an error. Snapshotted into
   * `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100). The
   * message is scrubbed of secrets on the way in. Parity with Swift/JS.
   */
  breadcrumb(message, opts) {
    this.breadcrumbs.push({
      category: opts?.category ?? "info",
      message: scrubText(message),
      ts: Date.now(),
      ...opts?.data ? { data: opts.data } : {}
    });
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) this.breadcrumbs.shift();
  }
  /**
   * Manually capture an error/exception with its stack + the active breadcrumbs
   * and feature flags (parity with Swift/JS `capture`). Use for caught errors you
   * still want reported. Never throws.
   */
  capture(error, opts) {
    const { message, stack, errorType } = _extractError(error);
    this._push(opts?.featureName ?? "captured", false, void 0, message, this._withError(opts?.meta, stack, errorType), "event");
  }
  /**
   * Send the buffered events. `await flush()` already resolves only after the
   * POST settles (and `keepalive` survives a process exit), so the last batch is
   * delivered. Pass `timeoutMs` to bound the wait — for a short-lived process
   * exiting against a possibly-hung API, so shutdown can't block forever (parity
   * with Swift `flush(timeout:)` / Python `flush(timeout=)`). Never throws.
   *
   * Drains are SERIALISED through one promise chain: the 15s timer, an error
   * auto-flush and the quit flush must never drain concurrently, because two
   * overlapping drains would interleave batches (and the second would see an
   * empty buffer and report "sent").
   */
  async flush(timeoutMs) {
    this.flushChain = this.flushChain.then(() => this._drain(timeoutMs)).catch(() => {
    });
    return this.flushChain;
  }
  async _drain(timeoutMs) {
    for (const [featureName, calls] of this.summaryBuffer) {
      if (calls <= 0) continue;
      this.buffer.push({
        // Stamped as the summary event is materialised — the close of the
        // aggregation window it describes. Same reason as _push: without it a
        // batch delayed by an outage lands under the recovery's timestamp.
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        featureName,
        ok: true,
        meta: this._enrich({ calls }),
        source: "feature_call_summary",
        userId: this.currentUserId ?? void 0,
        platform: PLATFORM,
        sessionId: this.sessionId
      });
    }
    this.summaryBuffer.clear();
    if (this.buffer.length === 0) return;
    if (timeoutMs == null && Date.now() < this.retryAfterUntil) return;
    const events = this.buffer.splice(0);
    const body = JSON.stringify({ publishableKey: this.publishableKey, events });
    if (await this._sendOnce(body, timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS) === "requeue") this._requeue(events);
  }
  /**
   * One POST. Never throws — classifies the result instead. When `timeoutMs` is
   * set the attempt is bounded two ways: we abort the request AND race it
   * against a timer. The race is what actually guarantees the bound — an
   * `AbortController` only helps if the fetch implementation honours the signal,
   * and if it doesn't, `await fetch(...)` would hang and block the quit forever.
   * The abort is still issued so the aborted request can't dangle and hold the
   * event loop open past exit.
   */
  async _sendOnce(body, timeoutMs) {
    const controller = new AbortController();
    const attempt = (async () => {
      try {
        const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
        return this._classify(await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
          method: "POST",
          headers: { ...sdkHeaders2(this.bundleId), "Content-Type": "application/json" },
          body,
          keepalive: true,
          // best-effort survival if the process is exiting
          signal: controller.signal
        }));
      } catch {
        return "requeue";
      }
    })();
    if (timeoutMs == null) return await attempt ?? "requeue";
    let t;
    const timer = new Promise((resolve) => {
      t = setTimeout(() => {
        controller.abort();
        resolve(void 0);
      }, timeoutMs);
      t.unref?.();
    });
    try {
      return await Promise.race([attempt, timer]) ?? "requeue";
    } finally {
      if (t) clearTimeout(t);
    }
  }
  /** Map an HTTP response to a delivery outcome. */
  _classify(res) {
    const status = res?.status ?? 0;
    if (status >= 200 && status < 300) return "done";
    if (status === 429) {
      const waitMs = _parseRetryAfter(res);
      if (waitMs > 0) this.retryAfterUntil = Math.max(this.retryAfterUntil, Date.now() + waitMs);
      return "requeue";
    }
    if (status >= 400 && status < 500) {
      _warn(`batch rejected with HTTP ${status} \u2014 dropping it (retrying would fail identically)`);
      return "drop";
    }
    return "requeue";
  }
  /**
   * Put an undelivered batch back at the FRONT of the buffer so the next flush
   * retries it, then re-apply the cap.
   *
   * Priority policy under a sustained outage: NEWEST EVENTS WIN. The buffer is
   * trimmed from the front, so the oldest re-queued events go first. This matches
   * `_push`'s newest-wins eviction, keeps memory bounded at MAX_BUFFER_SIZE no
   * matter how long the backend is down, and stops a wedged batch from starving
   * live telemetry. Drops are reported, never silent.
   */
  _requeue(events) {
    this.buffer.unshift(...events);
    let dropped = 0;
    while (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
      dropped++;
    }
    _warn(
      `delivery failed \u2014 ${events.length} event(s) re-queued` + (dropped > 0 ? `, ${dropped} oldest dropped (buffer cap ${MAX_BUFFER_SIZE})` : "")
    );
  }
  async destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (_activeMonitor === this) _activeMonitor = null;
    await this.flush();
  }
  /** Fold stack/errorType into a caller's meta without mutating it. */
  _withError(meta, stack, errorType) {
    return {
      ...meta ?? {},
      ...stack ? { stack } : {},
      ...errorType ? { errorType } : {}
    };
  }
  /** New meta with always-on SDK/app context merged in (SDK keys authoritative).
   *  A per-event meta.environment wins; else the config default fills in (parity
   *  with Swift/JS). */
  _enrich(meta) {
    const out = { ...meta ?? {}, ...this.staticMeta };
    if (this.environment != null && out["environment"] == null) out["environment"] = this.environment;
    return out;
  }
  _push(featureName, ok, durationMs, error, meta, source = "event") {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift();
    const isError = !ok || source === "global_error";
    const enriched = this._enrich(meta);
    if (isError) {
      const device = _deviceContext();
      if (Object.keys(device).length > 0) enriched["device"] = device;
      if (this.breadcrumbs.length > 0) enriched["breadcrumbs"] = this.breadcrumbs.slice();
    }
    const scrubbed = scrubMeta(enriched);
    if (isError && this.flags.size > 0 && scrubbed) {
      scrubbed["flags"] = Object.fromEntries(this.flags);
    }
    this.buffer.push({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      featureName,
      ok,
      durationMs,
      error: error != null ? scrubText(error) : error,
      meta: scrubbed,
      source,
      userId: this.currentUserId ?? void 0,
      platform: PLATFORM,
      sessionId: this.sessionId
    });
    if (isError) void this.flush();
  }
  /**
   * Internal: routed here by the module-level crash handlers. Only the current
   * active monitor receives these. `_push` already flushes on a `global_error`.
   */
  _onGlobalError(message, stack) {
    this._push("unhandled", false, void 0, message, this._withError(void 0, stack), "global_error");
  }
};

// src/forms.ts
var OneloForms = class {
  constructor(apiUrl, publishableKey, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.bundleId = bundleId;
  }
  async submit(formSlug, data, submitterEmail) {
    try {
      const body = { publishableKey: this.publishableKey, formSlug, data };
      if (submitterEmail) body.submitterEmail = submitterEmail;
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const res = await fetch(`${this.apiUrl}/api/sdk/forms/submit`, {
        method: "POST",
        headers: { ...sdkHeaders2(this.bundleId), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      return { success: json.success ?? false, message: json.message };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
};

// src/waitlist.ts
var OneloWaitlist = class {
  constructor(apiUrl, publishableKey, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.bundleId = bundleId;
  }
  async join(slug, email) {
    try {
      const body = { publishableKey: this.publishableKey, email };
      if (slug !== void 0) body.slug = slug;
      const { sdkHeaders: sdkHeaders2 } = await Promise.resolve().then(() => (init_sdk_headers(), sdk_headers_exports));
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: "POST",
        headers: { ...sdkHeaders2(this.bundleId), "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      return { success: json.success ?? false, position: json.position, alreadyJoined: json.alreadyJoined ?? false };
    } catch {
      return { success: false, alreadyJoined: false };
    }
  }
};

// src/customer-portal.ts
var import_core3 = __toESM(require_dist());
init_sdk_headers();
var SKELETON_HTML2 = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111111;font-family:-apple-system,sans-serif;overflow:hidden}
@keyframes onelo-shimmer{0%{background-position:-60vw 0}100%{background-position:100vw 0}}
.wrap{display:flex;flex-direction:column;align-items:center;width:100%;padding:48px 24px 0}
.col{width:100%;max-width:432px;display:flex;flex-direction:column;gap:14px}
.sk{background-color:rgba(255,255,255,0.04);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.12) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:8px}
.strong{background-color:rgba(255,255,255,0.08);background-image:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.18) 50%,rgba(255,255,255,0) 100%);background-size:60vw 100%;background-repeat:no-repeat;background-attachment:fixed;animation:onelo-shimmer 2.4s linear infinite;border-radius:9px}
.icon{width:64px;height:64px;border-radius:14px;margin-bottom:14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1)}
.title{width:200px;height:22px;margin-bottom:10px;border-radius:6px}
.sub{width:80px;height:13px;opacity:0.7;margin-bottom:32px;border-radius:4px}
.c1{height:240px;border-radius:14px}
.c2{height:80px;border-radius:14px}
.c3{height:140px;border-radius:14px}
</style></head><body>
<div class="wrap">
<div class="sk icon"></div>
<div class="sk title"></div>
<div class="sk sub"></div>
<div class="col"><div class="strong c1"></div><div class="strong c2"></div><div class="strong c3"></div></div>
</div>
</body></html>`;
var _OneloElectronCustomerPortal = class _OneloElectronCustomerPortal {
  constructor(apiUrl, publishableKey, auth, protocol, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.auth = auth;
    this.bundleId = bundleId;
    this.protocol = protocol.toLowerCase();
  }
  /**
   * Mint a portal token and return the hosted portal URL. Requires an active
   * session — the token travels in the `Authorization: Bearer` header, NEVER in
   * the URL, so it can't leak into logs / history / crash reports. Mirrors Swift
   * `initiateCustomerPortal()`. Use for a custom presentation; `open()` /
   * `openInBrowser()` wrap it.
   */
  async initiate() {
    const session = await this.auth.getSession();
    if (!session) throw import_core.OneloError.notAuthenticated();
    const initiateUrl = `${this.apiUrl}/api/sdk/paywall/portal-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${encodeURIComponent(this.protocol)}`;
    const { status, json } = await (0, import_core3.httpGet)(
      initiateUrl,
      sdkHeaders(this.bundleId, { Authorization: `Bearer ${session.accessToken}` })
    );
    if (status === 401) throw import_core.OneloError.notAuthenticated();
    if (status !== 200) throw import_core.OneloError.server(`Failed to initiate customer portal: HTTP ${status}`);
    const j = json;
    const hostedUrl = j["hosted_url"];
    if (!hostedUrl) throw import_core.OneloError.server("Invalid portal-initiate response: missing hosted_url");
    return hostedUrl;
  }
  /**
   * Open the Onelo hosted customer portal in a standalone in-app BrowserWindow.
   * Throws `OneloError` (`not_authenticated`) when no session is active.
   *
   * @param parentWindow  Optional parent BrowserWindow (for modal centering).
   * @returns             Resolves when the portal window is closed.
   */
  async open(parentWindow) {
    const hostedUrl = await this.initiate();
    return this._presentPortalWindow(hostedUrl, parentWindow);
  }
  /**
   * Open the customer portal in the user's DEFAULT SYSTEM BROWSER (via
   * `shell.openExternal`) instead of an in-app window. Preferred for the payment
   * surface — the buyer sees the real domain + has their saved cards / password
   * manager, and the app can't inspect the page. Mirrors Swift
   * `openCustomerPortalInBrowser()`.
   *
   * The portal signals account-lifecycle events (e.g. deletion) back via the
   * app's deep-link scheme. Wire your `app.on('open-url')` (macOS) /
   * `second-instance` (win/linux) handler to call `handlePortalCallback(url)` so
   * those events clear the local session.
   */
  async openInBrowser() {
    const hostedUrl = await this.initiate();
    const { shell } = await import("electron");
    await shell.openExternal(hostedUrl);
  }
  /**
   * Process a portal deep-link the OS handed to your app — only needed for the
   * `openInBrowser()` path (the embedded `open()` intercepts it itself). On a
   * hard account event (deletion / revoke / compromise) it clears the local
   * session. Returns true if the URL was a portal callback. Never throws.
   */
  async handlePortalCallback(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.searchParams.get("source") !== "portal") return false;
    await this._applyPortalEvent(parsed.searchParams.get("event"));
    return true;
  }
  /** Clear the local session on a hard portal event: flag isUserRevoked + sign
   *  out. No-op for other/absent events. Never throws. */
  async _applyPortalEvent(event) {
    if (!event || !_OneloElectronCustomerPortal.REVOKE_EVENTS.has(event)) return;
    this.auth.isUserRevoked = true;
    await this.auth.signOut().catch((err) => {
      console.warn("[Onelo] signOut after portal event failed (session may not be fully cleared):", err);
    });
  }
  _presentPortalWindow(hostedUrl, parentWindow) {
    return new Promise((resolve, reject) => {
      import("electron").then(({ BrowserWindow }) => {
        const win = new BrowserWindow({
          // Tall enough for the full hosted portal (plan, receipts, cancel /
          // resume, manage) + an enforced floor so nothing clips. Same sizing
          // as the auth + feedback windows (720 / min 440×680; resizable makes
          // the min bind).
          // Wide, like the store: the portal's content column is a fixed
          // 432px that does not grow, so in a 480px window it touches both
          // edges and reads as enormous even though every size is exactly as
          // configured (measured 2026-08-19). Given room, it looks like the
          // same page does in a browser. Kept in step with
          // `hostedWindowSize()` in auth.ts, which sizes the store window.
          width: 780,
          height: 720,
          minWidth: 560,
          minHeight: 680,
          parent: parentWindow,
          modal: !!parentWindow,
          resizable: true,
          minimizable: false,
          maximizable: false,
          // Dark ground so the window never flashes white before the skeleton /
          // hosted page paints (matches the skeleton + hosted portal background).
          backgroundColor: "#111111",
          webPreferences: { nodeIntegration: false, contextIsolation: true },
          title: "Manage Account"
        });
        win.setMenuBarVisibility(false);
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SKELETON_HTML2)}`).then(() => {
          if (!win.isDestroyed()) return win.loadURL(hostedUrl);
        }).catch(() => {
          if (!win.isDestroyed()) win.close();
        });
        win.webContents.on("did-fail-load", (_e, _errorCode, _errorDesc, _validatedURL, isMainFrame) => {
          if (isMainFrame && !win.isDestroyed()) win.close();
        });
        win.webContents.setWindowOpenHandler(({ url }) => {
          import("electron").then(({ shell }) => shell.openExternal(url));
          return { action: "deny" };
        });
        let pendingSignOut = null;
        const handleNav = (_event, url) => {
          const prefix = `${this.protocol}://`;
          if (url.slice(0, prefix.length).toLowerCase() !== prefix) return;
          let parsed;
          try {
            parsed = new URL(url);
          } catch {
            return;
          }
          if (parsed.searchParams.get("source") !== "portal") return;
          win.webContents.removeListener("will-redirect", handleNav);
          win.webContents.removeListener("will-navigate", handleNav);
          const closeAndResolve = () => {
            if (!win.isDestroyed()) win.close();
          };
          pendingSignOut = this._applyPortalEvent(parsed.searchParams.get("event"));
          pendingSignOut.finally(closeAndResolve);
        };
        win.webContents.on("will-redirect", handleNav);
        win.webContents.on("will-navigate", handleNav);
        win.on("closed", () => {
          if (!win.isDestroyed()) {
            win.webContents.removeListener("will-redirect", handleNav);
            win.webContents.removeListener("will-navigate", handleNav);
          }
          if (pendingSignOut) {
            pendingSignOut.then(resolve);
          } else {
            resolve();
          }
        });
      }).catch(reject);
    });
  }
};
/** Hard account-lifecycle events the portal can deep-link back — each clears
 *  the local session instantly (mirrors Swift's set). */
_OneloElectronCustomerPortal.REVOKE_EVENTS = /* @__PURE__ */ new Set([
  "account_deletion_scheduled",
  "account_revoked",
  "session_compromised"
]);
var OneloElectronCustomerPortal = _OneloElectronCustomerPortal;

// src/consent.ts
var import_core4 = __toESM(require_dist());
init_sdk_headers();
var CONSENT_SENTINEL = "onelo-consent://done";
var POSTMESSAGE_RELAY_SCRIPT2 = `
(function () {
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'onelo:consent' && e.data.action) {
      window.location.href = '${CONSENT_SENTINEL}?action=' + encodeURIComponent(e.data.action);
    }
  });
})();
`;
function _mapRequirement(j) {
  const versionId = j["version_id"];
  const docType = j["doc_type"];
  const version2 = j["version"];
  if (typeof versionId !== "string" || typeof docType !== "string" || typeof version2 !== "string") {
    return null;
  }
  const rawEnf = j["enforcement"];
  const enforcement = rawEnf === "block" || rawEnf === "notify" ? rawEnf : "unknown";
  return {
    docType,
    versionId,
    version: version2,
    enforcement,
    blocking: j["blocking"] === true,
    url: typeof j["url"] === "string" ? j["url"] : null,
    consentUrl: typeof j["consent_url"] === "string" ? j["consent_url"] : null
  };
}
var OneloConsent = class {
  constructor(apiUrl, publishableKey, auth, bundleId, autoPresent = true) {
    /** Bumped on each `legal.consent_required` SSE push. Observe via
     *  `onConsentRequired` to drive your own UI (parity with Swift's
     *  @Published consentRevision). */
    this._consentRevision = 0;
    this.revisionListeners = /* @__PURE__ */ new Set();
    /** Single-owner gate claim (parity with Swift's consentGateOwner) so that when
     *  several presenters exist only ONE opens a window. */
    this._gateOwner = null;
    /** This instance's stable claim token. */
    this.gateToken = crypto.randomUUID();
    /** The live gate window, if one is open — prevents opening a second. */
    this._gateWindow = null;
    /** The live gate overlay (BrowserView filling the app window), if one is open.
     *  Preferred presentation when a parent window is registered — fits the app
     *  window, resizes with it, blocks input, non-dismissible. The standalone
     *  `_gateWindow` is only the no-parent fallback. */
    this._gateView = null;
    /** Main window to parent the gate on for the auto-present paths (sign-in +
     *  SSE). Registered via `setGateParent(mainWindow)`. When set, the blocking
     *  gate opens MODALLY over it — the OS blocks the app window while the gate is
     *  up, which (together with the non-dismissible close guard) is what makes the
     *  Terms gate a true block, matching Swift's `OneloAuthView` content cover.
     *  Unset → the gate still can't be dismissed, but floats non-modally so the
     *  user could alt-tab back to the app; that's why the snippet tells devs to
     *  register the window. */
    this._gateParent = null;
    /** Set true once the app is genuinely quitting (Cmd-Q / app.quit()) so the
     *  gate's no-dismiss close veto lets the quit through — the block must never
     *  trap the user with only force-quit left. Installed once (idempotent). */
    this._appQuitting = false;
    this._quitHookInstalled = false;
    /** Set synchronously at the top of presentGateIfNeeded and held across its
     *  `await requiredConsents()` round-trip, BEFORE `_gateWindow` is assigned —
     *  serializes concurrent callers (e.g. sign-in + a buffered SSE push on boot)
     *  so only one window opens. JS is single-threaded, so a boolean is enough. */
    this._presenting = false;
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.auth = auth;
    this.bundleId = bundleId;
    this.autoPresent = autoPresent;
  }
  // ── Observable revision (mirrors Swift @Published consentRevision) ──────────
  get consentRevision() {
    return this._consentRevision;
  }
  /** Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
   *  unsubscribe fn. Use when you build your own consent UI instead of the
   *  auto-presented gate. */
  onConsentRequired(listener) {
    this.revisionListeners.add(listener);
    return () => {
      this.revisionListeners.delete(listener);
    };
  }
  // ── Single-owner gate claim ─────────────────────────────────────────────────
  /** Claim the gate. Succeeds if free OR already yours (idempotent). Returns
   *  false if another presenter owns it → that caller must NOT show a gate. */
  claimConsentGate(id) {
    if (this._gateOwner === null || this._gateOwner === id) {
      this._gateOwner = id;
      return true;
    }
    return false;
  }
  /** Release the gate — only if `id` currently owns it (never steals). Safe to
   *  call unconditionally on teardown. */
  releaseConsentGate(id) {
    if (this._gateOwner === id) this._gateOwner = null;
  }
  /**
   * Register the app's main window so the AUTO-presented consent gate (sign-in +
   * `legal.consent_required` SSE) opens modally over it. Required for a true
   * hard block — without a parent the gate can't be dismissed but still floats
   * non-modally, so the user could keep using the app underneath. Call once after
   * you create your main window; pass `null` to clear (e.g. on window close).
   */
  setGateParent(win) {
    this._gateParent = win;
  }
  // ── Data API (mirrors Swift OneloAuth.requiredConsents / acceptConsent) ──────
  /**
   * Fetch the signed-in user's outstanding legal documents. Requires a session;
   * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
   * returns `[]` (never throws) — parity with Swift's `requiredConsents()`.
   */
  async requiredConsents() {
    const session = await this.auth.getSession();
    if (!session) return [];
    try {
      const { status, json } = await (0, import_core4.httpGet)(
        `${this.apiUrl}/v1/sdk/consent/required`,
        sdkHeaders(this.bundleId, {
          Authorization: `Bearer ${session.accessToken}`,
          "X-Publishable-Key": this.publishableKey
        })
      );
      if (status !== 200) return [];
      const rows = json.required;
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => _mapRequirement(r)).filter((r) => r !== null);
    } catch {
      return [];
    }
  }
  /**
   * Record acceptance of a legal document version. Requires a session. Throws
   * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
   * Mirrors Swift `acceptConsent(versionId:)`.
   */
  async acceptConsent(versionId) {
    const session = await this.auth.getSession();
    if (!session) throw import_core.OneloError.notAuthenticated();
    const { status } = await (0, import_core4.httpPost)(
      `${this.apiUrl}/v1/sdk/consent/accept`,
      // snake_case `document_version_id` — the backend ConsentActionIn model.
      { document_version_id: versionId },
      sdkHeaders(this.bundleId, {
        Authorization: `Bearer ${session.accessToken}`,
        "X-Publishable-Key": this.publishableKey,
        "Content-Type": "application/json"
      })
    );
    if (status === 401) throw import_core.OneloError.notAuthenticated();
    if (status < 200 || status >= 300) throw import_core.OneloError.server(`Failed to record consent: HTTP ${status}`);
  }
  // ── SSE wiring ──────────────────────────────────────────────────────────────
  /**
   * Register the `legal.consent_required` listener on the shared stream. The
   * event is a signal only (payload ignored, like Swift) — on receipt we bump
   * the revision, notify observers, and auto-present the gate if one is warranted.
   */
  attachEventStream(stream) {
    stream.on("legal.consent_required", () => {
      this._consentRevision++;
      for (const listener of this.revisionListeners) {
        try {
          listener(this._consentRevision);
        } catch {
        }
      }
      if (this.autoPresent) void this.presentGateIfNeeded();
    });
  }
  // ── Gate presentation (mirrors Swift OneloAuthView.checkConsent + gate) ──────
  /**
   * Check for an outstanding BLOCKING consent and, if present, open the hosted
   * gate. Returns true if a gate was shown. No-op when: no session, no blocking
   * document, another presenter owns the gate, or a gate window is already open.
   *
   * @param parentWindow  Pass your main window to present modally (blocks the app
   *                       until resolved — the faithful "blocking" behaviour).
   */
  async presentGateIfNeeded(parentWindow) {
    if (this._presenting) return false;
    if (this._gateWindow && !this._gateWindow.isDestroyed()) return false;
    if (this._gateView) return false;
    this._presenting = true;
    try {
      const items = await this.requiredConsents();
      const blocker = items.find((i) => i.blocking);
      if (!blocker) {
        this.releaseConsentGate(this.gateToken);
        return false;
      }
      if (!this.claimConsentGate(this.gateToken)) return false;
      if (!blocker.consentUrl) {
        this.releaseConsentGate(this.gateToken);
        return false;
      }
      const rawParent = parentWindow ?? this._gateParent;
      const parent = rawParent && !rawParent.isDestroyed() ? rawParent : void 0;
      if (parent) {
        await this._presentConsentOverlay(blocker, parent);
      } else {
        await this._presentConsentWindow(blocker, void 0);
      }
      return true;
    } finally {
      this._presenting = false;
    }
  }
  /**
   * Present the gate as a BrowserView overlay that FILLS the app window and
   * resizes with it — the native equivalent of the web full-screen overlay. It
   * sits on top of the app content (blocking input) with no window chrome, so it
   * is non-dismissible: the only exits are Accept / Sign out (via the sentinel
   * nav) or a fail-open teardown if the page can't load. Requires a parent
   * window (from setGateParent or an explicit arg).
   */
  async _presentConsentOverlay(requirement, parentWindow) {
    const { BrowserView, shell } = await import("electron");
    const view = new BrowserView({
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    this._gateView = view;
    const fit = () => {
      if (parentWindow.isDestroyed()) return;
      const [w, h] = parentWindow.getContentSize();
      view.setBounds({ x: 0, y: 0, width: w, height: h });
    };
    parentWindow.addBrowserView(view);
    fit();
    const onResize = () => fit();
    parentWindow.on("resize", onResize);
    const wc = view.webContents;
    const cleanup = () => {
      if (wc.isDestroyed()) return;
      wc.removeListener("will-navigate", handleNav);
      wc.removeListener("will-redirect", handleNav);
    };
    let torn = false;
    const teardown = () => {
      if (torn) return;
      torn = true;
      if (this._gateView === view) this._gateView = null;
      parentWindow.removeListener("resize", onResize);
      parentWindow.removeListener("closed", teardown);
      cleanup();
      this.releaseConsentGate(this.gateToken);
      try {
        if (!parentWindow.isDestroyed()) parentWindow.removeBrowserView(view);
      } catch {
      }
      try {
        const vwc = view.webContents;
        if (!vwc.isDestroyed?.()) vwc.destroy?.();
      } catch {
      }
    };
    parentWindow.on("closed", teardown);
    const handleNav = (event, url) => {
      if (!url.startsWith(CONSENT_SENTINEL)) return;
      event.preventDefault();
      let action = null;
      try {
        action = new URL(url).searchParams.get("action");
      } catch {
      }
      cleanup();
      void this._handleConsentAction(action, requirement, teardown, parentWindow);
    };
    wc.on("will-navigate", handleNav);
    wc.on("will-redirect", handleNav);
    wc.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
    wc.on("did-fail-load", (_e, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame) teardown();
    });
    try {
      await wc.loadURL(requirement.consentUrl);
      await wc.executeJavaScript(POSTMESSAGE_RELAY_SCRIPT2);
      wc.focus();
    } catch {
      teardown();
    }
  }
  async _presentConsentWindow(requirement, parentWindow) {
    const { BrowserWindow, app } = await import("electron");
    const modal = !!parentWindow;
    if (!this._quitHookInstalled) {
      this._quitHookInstalled = true;
      app.on("before-quit", () => {
        this._appQuitting = true;
      });
    }
    const win = new BrowserWindow({
      width: 480,
      height: 640,
      parent: parentWindow,
      modal,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
      title: "Review & Accept"
    });
    this._gateWindow = win;
    let allowClose = false;
    const forceClose = () => {
      allowClose = true;
      if (this._gateWindow === win) this._gateWindow = null;
      if (!win.isDestroyed()) win.close();
    };
    if (modal) {
      win.on("close", (e) => {
        if (this._appQuitting) return;
        if (!allowClose && !win.isDestroyed()) {
          e.preventDefault();
          win.focus();
        }
      });
    } else {
      console.warn(
        "[Onelo] Consent gate is NOT hard-blocking: no main window registered. Call onelo.consent.setGateParent(mainWindow) so a blocking Terms/Privacy update modally blocks the app until the user accepts."
      );
    }
    let actionHandled = false;
    const cleanup = () => {
      if (win.isDestroyed()) return;
      win.webContents.removeListener("will-navigate", handleNav);
      win.webContents.removeListener("will-redirect", handleNav);
    };
    const handleNav = (event, url) => {
      if (!url.startsWith(CONSENT_SENTINEL)) return;
      event.preventDefault();
      let action = null;
      try {
        action = new URL(url).searchParams.get("action");
      } catch {
      }
      cleanup();
      actionHandled = true;
      void this._handleConsentAction(action, requirement, forceClose, parentWindow);
    };
    win.webContents.on("will-navigate", handleNav);
    win.webContents.on("will-redirect", handleNav);
    win.webContents.setWindowOpenHandler(({ url }) => {
      void import("electron").then(({ shell }) => shell.openExternal(url));
      return { action: "deny" };
    });
    win.on("closed", () => {
      cleanup();
      if (this._gateWindow === win) this._gateWindow = null;
      if (!actionHandled) this.releaseConsentGate(this.gateToken);
    });
    win.webContents.on("did-fail-load", (_e, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame) forceClose();
    });
    try {
      await win.loadURL(requirement.consentUrl);
      await win.webContents.executeJavaScript(POSTMESSAGE_RELAY_SCRIPT2);
    } catch {
      forceClose();
    }
  }
  /**
   * Apply the hosted page's accept/decline signal. Accept → record consent, then
   * RE-CHECK (documents stack — there may be another blocking doc). Decline (or
   * any non-accept) → sign out. Mirrors Swift `handleConsent`.
   */
  async _handleConsentAction(action, requirement, closeGate, parentWindow) {
    if (action === "accept") {
      try {
        await this.acceptConsent(requirement.versionId);
      } catch {
      }
      this.releaseConsentGate(this.gateToken);
      closeGate();
      await this.presentGateIfNeeded(parentWindow);
    } else {
      this.releaseConsentGate(this.gateToken);
      closeGate();
      await this.auth.signOut().catch(() => {
      });
    }
  }
};

// src/store.ts
var import_core5 = __toESM(require_dist());
init_sdk_headers();
var OneloStore = class {
  constructor(apiUrl, publishableKey, auth, protocol, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.auth = auth;
    this.bundleId = bundleId;
    this.protocol = protocol.toLowerCase();
  }
  /**
   * Mint a tokenized hosted-store URL (plan selection + payment + registration in
   * one page). When a session exists its access token is attached (`Authorization:
   * Bearer`) so the store binds to the existing user and skips signup (re-purchase);
   * cold-start omits it. Mirrors Swift `initiateStoreFlow(lang:)`. Use for a custom
   * presentation; `open()`/`openInBrowser()` wrap it.
   *
   * @throws OneloError('server_error') on `store_not_configured` (409) /
   *   `paywall_not_enabled` (403) — DO NOT open a window in that case — or any
   *   other non-200. `OneloError('invalid_publishable_key')` on 401.
   */
  async initiateStoreFlow(lang = "en") {
    const session = await this.auth.getSession();
    const initiateUrl = `${this.apiUrl}/api/sdk/paywall/store-initiate?key=${encodeURIComponent(this.publishableKey)}&callback_scheme=${encodeURIComponent(this.protocol)}&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core5.httpGet)(
      initiateUrl,
      // Bearer only when signed in (re-purchase binding); anonymous store omits it.
      sdkHeaders(this.bundleId, session ? { Authorization: `Bearer ${session.accessToken}` } : {})
    );
    if (status === 401) throw import_core.OneloError.invalidKey("Store rejected the publishable key");
    if (status !== 200) {
      const code = (0, import_core5.extractErrorCode)(json);
      throw import_core.OneloError.server(`Failed to initiate store flow: HTTP ${status}${code ? ` (${code})` : ""}`);
    }
    const storeUrl = json["store_url"];
    if (!storeUrl) throw import_core.OneloError.server("Invalid store-initiate response: missing store_url");
    return storeUrl;
  }
  /**
   * Open the hosted store in an in-app BrowserWindow and complete checkout — the
   * recommended path, and the 1:1 Electron equivalent of Swift's OneloAuthView:
   * the plan selection renders in the window; when the hosted page `window.open`s
   * the Stripe checkout, [OneloElectronAuth.presentHostedUrl]'s
   * `setWindowOpenHandler` sends THAT (and only that) to the system browser via
   * `shell.openExternal`. The store completes with a `<protocol>://…?code=`
   * deep-link that is exchanged for a session — the buyer ends up signed in.
   * Resolves with that session (or null if the window closed without completing,
   * in which case the session arrives via your `handleDeepLink`).
   *
   * @param parentWindow  Pass your main window to present modally.
   */
  async open(parentWindow) {
    const storeUrl = await this.initiateStoreFlow();
    return this.auth.presentHostedUrl(storeUrl, parentWindow, "Store");
  }
  /**
   * Open the hosted store in the user's DEFAULT SYSTEM BROWSER (via
   * `shell.openExternal`). Preferred for the payment surface — the buyer sees the
   * real domain + their saved cards / password manager. The store redirects back
   * via your deep-link scheme on completion; wire `app.on('open-url')` (macOS) /
   * `second-instance` (win/linux) to `auth.handleDeepLink(url)` to finish sign-in.
   */
  async openInBrowser(lang = "en") {
    const storeUrl = await this.initiateStoreFlow(lang);
    const { shell } = await import("electron");
    await shell.openExternal(storeUrl);
  }
  /**
   * Act on an upsell (a feature's `upgradeCta`/`upgradeHint`, an "Available in
   * <plan>" tap). Requires a signed-in session. The backend is the single source
   * of truth for billing: an active subscriber is routed to a hosted plan-switch
   * checkout, a user with no subscription to the hosted store. The resulting URL
   * opens in the SYSTEM BROWSER (mirrors Swift `openUpgrade(forPlan:)` /
   * `NSWorkspace.open`). Mirrors Swift — never opens an in-app window.
   *
   * @throws OneloError('not_authenticated') when signed out (401) or
   *   `OneloError('server_error')` on `plan_not_purchasable` (404) /
   *   `callback_scheme_required` (400) / any other non-200.
   */
  async openUpgrade(plan, lang = "en") {
    const session = await this.auth.getSession();
    if (!session) throw import_core.OneloError.notAuthenticated();
    const initiateUrl = `${this.apiUrl}/api/sdk/paywall/upgrade-initiate?key=${encodeURIComponent(this.publishableKey)}&plan=${encodeURIComponent(plan)}&callback_scheme=${encodeURIComponent(this.protocol)}&lang=${encodeURIComponent(lang)}`;
    const { status, json } = await (0, import_core5.httpGet)(
      initiateUrl,
      sdkHeaders(this.bundleId, { Authorization: `Bearer ${session.accessToken}` })
    );
    if (status === 401) throw import_core.OneloError.notAuthenticated();
    if (status !== 200) {
      const code = (0, import_core5.extractErrorCode)(json);
      throw import_core.OneloError.server(`Failed to initiate upgrade: HTTP ${status}${code ? ` (${code})` : ""}`);
    }
    const upgradeUrl = json["upgrade_url"];
    if (!upgradeUrl) throw import_core.OneloError.server("Invalid upgrade-initiate response: missing upgrade_url");
    const { shell } = await import("electron");
    await shell.openExternal(upgradeUrl);
  }
};

// src/onelo.ts
init_codesign();

// src/event-stream.ts
init_sdk_headers();
var RECONNECT_DELAYS_MS = [1e3, 2e3, 5e3, 1e4, 3e4];
var SILENCE_TIMEOUT_MS = 45e3;
var MAX_BUFFER_BYTES = 1 << 20;
var OneloEventStream = class {
  constructor(apiUrl, publishableKey, sdkVersion, bundleId) {
    this.apiUrl = apiUrl;
    this.publishableKey = publishableKey;
    this.sdkVersion = sdkVersion;
    this.bundleId = bundleId;
    this.controller = null;
    this.handlers = /* @__PURE__ */ new Map();
    this.paramProviders = [];
    this.userId = null;
    this.started = false;
    this.destroyed = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.silenceTimer = null;
    /** Fired when the server caps the connection (429, X-Fallback: poll) and the
     *  stream stops — a consumer (features) can start polling instead. */
    this.onFallbackCb = null;
    // Monotonic connection id: a read loop only acts if it is still the current
    // connection (guards against a stale loop resurrecting after stop/reconnect).
    this.connEpoch = 0;
  }
  /**
   * Register a handler for a named server event (`connected`, `features_updated`,
   * `session.revoked`, …). Survives reconnects. Register BEFORE `start()` (e.g.
   * in a module constructor) so no event is missed between connect and sign-in.
   */
  on(event, handler) {
    const arr = this.handlers.get(event) ?? [];
    arr.push(handler);
    this.handlers.set(event, arr);
  }
  /**
   * Extra query params, read fresh on EVERY (re)connect — for values that change
   * over the connection's life (e.g. features' `since_version`), so a reconnect
   * always sends the current value.
   */
  addParamProvider(fn) {
    this.paramProviders.push(fn);
  }
  /** Register a callback fired when a 429 connection-cap stops the stream, so a
   *  consumer can fall back to polling (honours the backend's X-Fallback: poll). */
  onFallback(cb) {
    this.onFallbackCb = cb;
  }
  /**
   * Open (or re-open) the connection for a user. Idempotent: a repeat call with
   * the same userId while already connected is a no-op. A changed userId
   * reconnects so per-user routing (features + `session.revoked` targeting) is
   * correct.
   */
  start(userId) {
    if (this.destroyed) return;
    const changed = userId !== this.userId || !this.started;
    this.userId = userId;
    this.started = true;
    if (changed) void this._connect();
  }
  /** Close the connection and cancel any pending reconnect. */
  stop() {
    this.started = false;
    this._clearReconnect();
    this._clearSilence();
    this._abort();
  }
  /** Permanent teardown — cannot be restarted. */
  destroy() {
    this.destroyed = true;
    this.stop();
  }
  /**
   * Force a fresh connection NOW, re-reading all params. Used after a consumer
   * resets a provider value (e.g. features' `invalidateCache()` → `since_version
   * = 0`, so only a reconnect makes the server resend a full snapshot). No-op
   * when not started or destroyed.
   */
  reconnect() {
    if (this.destroyed || !this.started) return;
    void this._connect();
  }
  // ── internals ──────────────────────────────────────────────────────────────
  _buildUrl() {
    const params = new URLSearchParams({ key: this.publishableKey, sdk_platform: "electron" });
    if (this.sdkVersion) params.set("sdk_version", this.sdkVersion);
    if (this.userId) params.set("userId", this.userId);
    for (const provide of this.paramProviders) {
      for (const [k, v] of Object.entries(provide())) params.set(k, v);
    }
    return `${this.apiUrl}/api/sdk/features/stream?${params.toString()}`;
  }
  async _connect() {
    if (this.destroyed || !this.started) return;
    this._clearReconnect();
    this._abort();
    const epoch = ++this.connEpoch;
    const controller = new AbortController();
    this.controller = controller;
    let res;
    try {
      res = await fetch(this._buildUrl(), {
        method: "GET",
        // sdkHeaders adds X-Bundle-Id (+ X-SDK-Version / X-Onelo-Instance-Id) — the
        // backend security gate 403s a live app with a registered bundle on
        // /features/stream without X-Bundle-Id → the stream would reconnect-loop
        // forever and realtime (features_updated / session.revoked) would be dead.
        headers: { Accept: "text/event-stream", ...sdkHeaders(this.bundleId) },
        signal: controller.signal
      });
    } catch {
      if (epoch === this.connEpoch && this.started && !this.destroyed) this._scheduleReconnect();
      return;
    }
    if (epoch !== this.connEpoch) return;
    if (res.status === 429) {
      this.stop();
      this.onFallbackCb?.();
      return;
    }
    if (!res.ok || !res.body) {
      if (this.started && !this.destroyed) this._scheduleReconnect();
      return;
    }
    this._armSilence(epoch);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        if (epoch !== this.connEpoch) return;
        this.reconnectAttempts = 0;
        this._armSilence(epoch);
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        if (buffer.length > MAX_BUFFER_BYTES) break;
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          this._dispatchFrame(frame);
        }
      }
    } catch {
    }
    if (epoch === this.connEpoch && this.started && !this.destroyed) this._scheduleReconnect();
  }
  /** Parse one SSE frame (`event:`/`data:` lines) and dispatch to handlers. */
  _dispatchFrame(frame) {
    let eventName = "message";
    const dataLines = [];
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line.length === 0 || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let val = colon === -1 ? "" : line.slice(colon + 1);
      if (val.startsWith(" ")) val = val.slice(1);
      if (field === "event") eventName = val;
      else if (field === "data") dataLines.push(val);
    }
    const handlers = this.handlers.get(eventName);
    if (!handlers || handlers.length === 0) return;
    let data = {};
    const raw = dataLines.join("\n");
    if (raw.length > 0) {
      try {
        data = JSON.parse(raw);
      } catch {
      }
    }
    for (const handler of handlers) {
      try {
        handler(data);
      } catch {
      }
    }
  }
  _armSilence(epoch) {
    this._clearSilence();
    this.silenceTimer = setTimeout(() => {
      if (epoch !== this.connEpoch || this.destroyed || !this.started) return;
      this.connEpoch++;
      this._abort();
      this._scheduleReconnect();
    }, SILENCE_TIMEOUT_MS);
  }
  _scheduleReconnect() {
    if (this.destroyed || !this.started) return;
    this._clearSilence();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts++;
    const delay = Math.floor(Math.random() * base);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this._connect();
    }, delay);
  }
  _clearReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
  _clearSilence() {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
  _abort() {
    if (this.controller !== null) {
      this.controller.abort();
      this.controller = null;
    }
  }
};

// src/onelo.ts
init_package();
var Onelo = class {
  constructor(config) {
    if (!config.apiUrl) throw new Error("[Onelo] apiUrl is required");
    if (!config.publishableKey) throw new Error("[Onelo] publishableKey is required");
    getCachedCodesignFingerprint();
    this.auth = new OneloElectronAuth(config);
    let appVersion = config.appVersion;
    if (!appVersion) {
      try {
        appVersion = require("electron").app.getVersion();
      } catch {
      }
    }
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl, {
      bundleId: config.bundleId,
      appVersion,
      appBuild: config.appBuild,
      environment: config.environment
    });
    let envFromProcess;
    if (typeof window === "undefined") {
      const proc = globalThis.process;
      envFromProcess = proc?.env?.["ONELO_FEATURE_ENVIRONMENT"];
    }
    const rawFeatureEnv = config.featureEnvironment ?? envFromProcess;
    const featureEnvironment = rawFeatureEnv === "test" || rawFeatureEnv === "live" ? rawFeatureEnv : void 0;
    this.features = new OneloFeatures(config.publishableKey, config.apiUrl, this.monitor, config.bundleId, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false,
      featureEnvironment,
      featureDefaultStatus: config.featureDefaultStatus
    });
    this.feedback = new OneloFeedback({ publishableKey: config.publishableKey, apiUrl: config.apiUrl, bundleId: config.bundleId }, this.features);
    this.forms = new OneloForms(config.apiUrl, config.publishableKey, config.bundleId);
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey, config.bundleId);
    this.customerPortal = new OneloElectronCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      this.auth,
      config.protocol ?? "onelo",
      config.bundleId
    );
    this.autoPresentConsentGate = config.autoPresentConsentGate ?? true;
    this.consent = new OneloConsent(
      config.apiUrl,
      config.publishableKey,
      this.auth,
      config.bundleId,
      this.autoPresentConsentGate
    );
    this.store = new OneloStore(
      config.apiUrl,
      config.publishableKey,
      this.auth,
      config.protocol ?? "onelo",
      config.bundleId
    );
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, version, config.bundleId);
    this.auth.attachEventStream(this.eventStream);
    this.features.attachEventStream(this.eventStream);
    this.consent.attachEventStream(this.eventStream);
    this.features._load(null);
    this.auth.onSessionChange((userId) => {
      this.monitor.setUserId(userId);
      this.features._load(userId);
      if (userId && this.autoPresentConsentGate) void this.consent.presentGateIfNeeded();
    });
    void this.auth.getSession().catch(() => {
    });
    if (config.autoLifecycleRefresh ?? true) {
      this._registerLifecycleResync();
    }
  }
  /** Wire powerMonitor 'resume' + app 'activate' → features._resyncOnLifecycle().
   *  Registered after app 'ready' (powerMonitor requires it); guarded for
   *  non-Electron / test contexts. */
  _registerLifecycleResync() {
    try {
      const { app, powerMonitor } = require("electron");
      const wire = () => {
        powerMonitor.on("resume", () => this.features._resyncOnLifecycle());
        app.on("activate", () => this.features._resyncOnLifecycle());
      };
      if (app.isReady()) wire();
      else void app.whenReady().then(wire);
    } catch {
    }
  }
  /** Identify the current user (your own auth). Sets features targeting + monitor
   *  user id. Pass `userIdHash` (HMAC computed on YOUR backend) for secure mode. */
  async identify(userId, userIdHash) {
    await this.features._load(userId, userIdHash);
    this.monitor.setUserId(userId);
  }
  /**
   * Opens the hosted upgrade flow for `plan` in the SYSTEM BROWSER. The backend
   * decides the destination: an active subscriber lands on "Change plan" (target
   * pinned), a non-subscriber on the store. Requires a signed-in session.
   *
   * Wire it to a plan-gated tile whose `upgradeCta` is on:
   *   `if (f.upgradeCta && f.requiredPlan) onelo.openUpgrade(f.requiredPlan)`
   *
   * Thin delegate to {@link OneloStore.openUpgrade} for cross-platform parity with
   * Swift `Onelo.openUpgrade(forPlan:)` / Android / Flutter / RN `onelo.openUpgrade`.
   */
  async openUpgrade(plan, lang = "en") {
    return this.store.openUpgrade(plan, lang);
  }
  /** Drop the active identity WITHOUT a full session sign-out (identity-mode /
   *  own-auth only — Onelo Auth resets via onSessionChange). Parity with Swift
   *  Onelo.clearIdentity(). */
  async clearIdentity() {
    await this.features._load(null);
    this.monitor.setUserId(null);
  }
  async destroy() {
    this.auth.dispose();
    this.features.stopPolling();
    this.eventStream.destroy();
    await this.monitor.destroy();
  }
};

// src/index.ts
var import_core6 = __toESM(require_dist());
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FeatureState,
  IPC_CHANNELS,
  Onelo,
  OneloConsent,
  OneloElectronAuth,
  OneloElectronCustomerPortal,
  OneloError,
  OneloFeatures,
  OneloFeaturesError,
  OneloFeedback,
  OneloForms,
  OneloMonitor,
  OneloStore,
  OneloWaitlist,
  REASON_LABELS,
  RESPONSE_REASON_CODES,
  SecureTokenStorage
});
