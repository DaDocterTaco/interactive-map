import { app } from '../../firebase.js';
import { restoreUser, joinChat, watchUser } from '../../LiveChat/chatAuth.js';
import { mountPulse } from './pulse.js';
import { getProfile } from '../../LiveChat/people.js';
import { openProfile } from '../../LiveChat/profileUI.js';
import { paintProfileAvatar } from '../../LiveChat/profileEditor.js?v=profile-polish-2';

export function mountCampusPulse({ map, L }) {
  return mountPulse({ app, map, L, auth: { restore: restoreUser, join: joinChat, watch: watchUser }, getProfile, openProfile, paintAvatar: paintProfileAvatar });
}
