export const appearanceColors = ["blue", "violet", "teal", "rose", "amber", "slate"];
export const appearanceIcons = ["people-fill", "chat-fill", "book", "mortarboard", "controller", "cup-hot", "moon-stars", "sun"];
export const MAX_LOGO_DATA_LENGTH = 32768;
export const MAX_LOGO_FILE_BYTES = 5 * 1024 * 1024;

export function logoInitials(name) {
    const words = String(name || "").match(/[A-Za-z0-9]+/g) || [];
    return (words.length > 1 ? words[0][0] + words.at(-1)[0] : words[0]?.slice(0, 2) || "GC").toUpperCase();
}
export function validateAppearance(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Choose a group logo.");
    const field = { initials: "text", icon: "icon", image: "image" }[value.kind];
    if (!field || !appearanceColors.includes(value.color) || Object.keys(value).sort().join() !== ["kind", "color", field].sort().join()) throw Error("Choose a valid logo style and color.");
    if (value.kind === "initials" && (typeof value.text !== "string" || !/^[A-Z0-9]{1,3}$/.test(value.text))) throw Error("Use 1–3 letters or numbers for the initials.");
    if (value.kind === "icon" && !appearanceIcons.includes(value.icon)) throw Error("Choose an icon from the library.");
    if (value.kind === "image" && (typeof value.image !== "string" || value.image.length > MAX_LOGO_DATA_LENGTH || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value.image))) throw Error("Choose a valid image smaller than 32 KB after resizing.");
    return { kind: value.kind, color: value.color, [field]: value[field] };
}
export function renderAppearance(avatar, group) {
    const preview = avatar.className?.split(/\s+/).includes("logo-preview");
    let appearance;
    try { appearance = validateAppearance(group?.appearance); } catch { /* Old groups keep their existing initials. */ }
    avatar.replaceChildren();
    if (!appearance) {
        const name = String(group?.name || "Group");
        const words = name.trim().split(/\s+/);
        const text = words.length > 1 ? words[0][0] + words.at(-1)[0] : name.slice(0, 2);
        const tone = Array.from(name).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0) % 5;
        avatar.className = `avatar avatar-tone-${tone}`;
        avatar.textContent = text.toUpperCase();
    } else {
        avatar.className = `avatar group-logo logo-${appearance.color}`;
        if (appearance.kind === "initials") avatar.textContent = appearance.text;
        if (appearance.kind === "icon") {
            const icon = document.createElement("span"); icon.className = "group-symbol";
            icon.setAttribute("data-symbol", appearance.icon); avatar.appendChild(icon);
        }
        if (appearance.kind === "image") {
            const image = document.createElement("img"); image.src = appearance.image; image.alt = ""; image.width = image.height = 128;
            image.decoding = "async";
            image.addEventListener("error", () => { if (avatar.firstChild === image) renderAppearance(avatar, { ...group, appearance: undefined }); }, { once: true });
            avatar.appendChild(image);
        }
    }
    if (preview) avatar.className += " logo-preview";
    avatar.setAttribute("aria-hidden", "true");
}
export function centerSquare(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > 40000000) throw Error("Choose an image up to 40 megapixels.");
    const size = Math.min(width, height);
    return { x: (width - size) / 2, y: (height - size) / 2, size };
}
export async function prepareLogo(file, environment = {}) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("Choose a PNG, JPEG, or WebP image. SVG files are not supported.");
    if (!file.size || file.size > MAX_LOGO_FILE_BYTES) throw Error("Choose an image smaller than 5 MB.");
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const signature = file.type === "image/jpeg" ? header[0] === 255 && header[1] === 216 && header[2] === 255
        : file.type === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
        : String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
    if (!signature) throw Error("This file does not match its image type. Choose another image.");
    const decode = environment.decode || (blob => createImageBitmap(blob, { imageOrientation: "from-image" }));
    const canvasFactory = environment.canvas || (() => document.createElement("canvas"));
    let bitmap;
    try {
        bitmap = await decode(file);
        const crop = centerSquare(bitmap.width, bitmap.height);
        const canvas = canvasFactory(); canvas.width = canvas.height = 128;
        const context = canvas.getContext("2d");
        if (!context) throw Error("Image editing is unavailable in this browser.");
        context.fillStyle = "#ffffff"; context.fillRect(0, 0, 128, 128);
        context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, 128, 128);
        for (const quality of [0.86, 0.7, 0.5]) {
            const image = canvas.toDataURL("image/jpeg", quality);
            if (image.length <= MAX_LOGO_DATA_LENGTH) return validateAppearance({ kind: "image", color: "blue", image }).image;
        }
        throw Error("This image is too detailed. Try a simpler image.");
    } catch (error) {
        if (error.name === "InvalidStateError" || error.name === "EncodingError") throw Error("This image could not be read. Try another PNG, JPEG, or WebP.");
        throw error;
    } finally { bitmap?.close?.(); }
}
