// Derive the same salted proof for group creation and joining. Firestore rules
// compare it to a verifier that client reads cannot download.
export function makeSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function passwordVerifier(password, salt) {
    if (typeof password !== "string" || password.length < 6 || password.length > 128) {
        throw new Error("Use a password between 6 and 128 characters.");
    }
    const bytes = new TextEncoder();
    let result;
    if (crypto.subtle) {
        const key = await crypto.subtle.importKey("raw", bytes.encode(password), "PBKDF2", false, ["deriveBits"]);
        result = new Uint8Array(await crypto.subtle.deriveBits({
            name: "PBKDF2", hash: "SHA-256", salt: bytes.encode(salt), iterations: 600000
        }, key, 256));
    } else {
        // WebCrypto isn't available on an HTTP LAN address. Use the same KDF there.
        const [{ pbkdf2Async }, { sha256 }] = await Promise.all([
            import("https://esm.sh/@noble/hashes@2.0.1/pbkdf2.js"),
            import("https://esm.sh/@noble/hashes@2.0.1/sha2.js")
        ]);
        result = await pbkdf2Async(sha256, bytes.encode(password), bytes.encode(salt), { c: 600000, dkLen: 32 });
    }
    return Array.from(result, byte => byte.toString(16).padStart(2, "0")).join("");
}
