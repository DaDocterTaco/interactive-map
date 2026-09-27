import { millis } from '../shared/policy.js';

// Only describe this account's live session; never advertise an expired response.
export function backgroundState({ user, state, availability, proposal, meetup, online = true, stale = false, now = Date.now() }) {
  if (!user || !['waiting', 'proposed', 'confirmed'].includes(state?.status)) return null;
  let result;
  if (state.status === 'waiting') {
    if (availability && millis(availability.expiresAt) <= now) return null;
    result = { kind: 'waiting', title: 'Finding your group', detail: 'We’ll let you know here.', action: 'Open Pulse', label: 'Looking for your group' };
  } else if (state.status === 'proposed') {
    if (!proposal || proposal.id !== state.proposalId || proposal.status !== 'pending' || !proposal.candidateIds?.includes(user.uid)) return null;
    const decision = proposal.responses?.[user.uid]?.decision;
    if (decision === 'decline') return null;
    const seconds = Math.max(0, Math.ceil((millis(proposal.responseDeadline) - now) / 1000));
    result = !seconds
      ? { kind: 'settling', title: 'Checking your group’s responses', detail: 'We’ll update you when the plan is confirmed.', action: 'Open Pulse', label: 'Checking responses' }
      : decision === 'accept'
        ? { kind: 'accepted', title: 'You’re in. Waiting for your group.', detail: proposal.spot?.name || 'Your meetup proposal', action: 'View plan', label: 'Waiting for responses' }
        : { kind: 'found', title: 'We found your group!', detail: proposal.spot?.name || 'A meetup is ready for your response.', action: 'View plan', label: 'A plan is ready · respond', seconds };
  } else {
    if (!meetup || meetup.id !== state.meetupId || meetup.status !== 'confirmed' || millis(meetup.endsAt) <= now || !meetup.participantIds?.includes(user.uid)) return null;
    result = { kind: 'confirmed', title: 'Your meetup is confirmed', detail: meetup.spot?.name || 'Your group is ready.', action: 'Open meetup', label: 'Meetup confirmed' };
  }
  if (!online || stale) return { kind: 'reconnecting', title: online ? 'Reconnecting to Pulse…' : 'Pulse is offline', detail: 'Reconnect to check your group’s latest status.', action: 'Open Pulse', label: online ? 'Reconnecting…' : 'Offline · reconnect' };
  return result;
}
