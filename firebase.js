// This site has no JavaScript build step, so load Firebase's browser-ready modules.
// The npm-style imports from the Firebase console need a bundler to run in a browser.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";

// These values identify the Firebase project and web app this site connects to.
// They are client-side configuration, not a password or access control.
const firebaseConfig = {
    apiKey: "AIzaSyDHS6fV4qvHKZ6iG2xP-3PyOMpRg6WZsFw",
    authDomain: "hackathon2026-bfbf3.firebaseapp.com",
    projectId: "hackathon2026-bfbf3",
    storageBucket: "hackathon2026-bfbf3.firebasestorage.app",
    messagingSenderId: "738075395209",
    appId: "1:738075395209:web:5d2a39d9f54bca36117258",
    measurementId: "G-42MHLEWBZY"
};

// Initialize the Firebase app once, then enable Analytics for this page.
// Other Firebase products, such as Firestore or Authentication, need their own setup.
export const app = initializeApp(firebaseConfig);
// Analytics should never prevent the chat from signing in.
isSupported().then((supported) => {
    if (supported) getAnalytics(app);
}).catch(() => {});
