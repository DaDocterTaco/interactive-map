import { app } from '../../firebase.js';
import { restoreUser, joinChat, watchUser } from '../../LiveChat/chatAuth.js';
import { mountPulse } from './pulse.js';

export function mountCampusPulse({ map, L }) {
  return mountPulse({ app, map, L, auth: { restore: restoreUser, join: joinChat, watch: watchUser } });
}
