import { app } from "../firebase.js";
import {
    getAuth,
    setPersistence,
    browserLocalPersistence,
    signInAnonymously,
    updateProfile,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

// Firebase Anonymous Auth supplies a stable browser identity for permissions.
// The chosen name is saved on Auth, then people.js copies it to the directory.
const auth = getAuth(app);

// Restore saved credentials before deciding to create a new account.
export async function restoreUser() {
    await setPersistence(auth, browserLocalPersistence);
    await auth.authStateReady();
    return auth.currentUser;
}

export async function joinChat(displayName) {
    const name = displayName.trim();
    if (!name || name.length > 40) throw new Error("Enter a name between 1 and 40 characters.");
    await restoreUser();
    const user = auth.currentUser || (await signInAnonymously(auth)).user;
    // Store the name on the Firebase Authentication user profile.
    await updateProfile(user, { displayName: name });
    return user;
}

export function watchUser(callback) {
    return onAuthStateChanged(auth, callback);
}
