import * as people from './people.js?v=profiles-1';
import { restoreUser, joinChat, watchUser } from './chatAuth.js';
import { createProfileUI } from './profileView.js?v=profile-polish-2';

const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./profile.css?v=profile-polish-2', import.meta.url).href; document.head.append(style);
const ui = createProfileUI({ auth: { restore: restoreUser, join: joinChat, watch: watchUser }, people,
    onMessage: person => new Promise((resolve, reject) => {
        const event = new CustomEvent('campus-message-user', { cancelable: true, detail: { person, resolve, reject } });
        if (window.dispatchEvent(event)) reject(Error('Chat is still loading. Close this profile and try again shortly.'));
    }) });
export const openProfile = (uid, options) => ui.open(uid, options);
