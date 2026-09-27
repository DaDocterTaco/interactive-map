export const AVATARS = { initials: 'Initials', leaf: 'Leaf', sun: 'Sun', planet: 'Planet', headphones: 'Headphones', cat: 'Cat' };
export const ACTIVITIES = { coffee: 'Coffee', food: 'Food', chat: 'Hang out' };
export function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return words.length ? (words[0][0] + (words.length > 1 ? words.at(-1)[0] : words[0][1] || '')).toUpperCase() : 'YOU';
}
export function normalizeProfile(input) {
    const text = (key, max, required = false) => {
        if (typeof input[key] !== 'string') throw Error(`Enter a valid ${key}.`);
        const value = input[key].trim();
        if (value.length > max || (required && !value)) throw Error(`${key === 'displayName' ? 'Name' : key} must be ${required ? '1–' : 'at most '}${max} characters.`);
        return value;
    };
    const interests = typeof input.interests === 'string' ? input.interests.split(',') : input.interests;
    if (!Array.isArray(interests) || interests.some(item => typeof item !== 'string')) throw Error('Enter hobbies separated by commas.');
    const tags = [...new Map(interests.map(item => item.trim()).filter(Boolean).map(item => [item.toLowerCase(), item])).values()];
    if (tags.length > 8 || tags.some(item => item.length > 24)) throw Error('Use up to 8 hobbies, with at most 24 characters each.');
    if (!Object.hasOwn(AVATARS, input.avatar)) throw Error('Choose a profile icon.');
    if (!Array.isArray(input.meetupActivities) || input.meetupActivities.some(item => !Object.hasOwn(ACTIVITIES, item))) throw Error('Choose a listed meetup activity.');
    if (typeof input.meetupOpen !== 'boolean') throw Error('Choose your meetup preference.');
    return { displayName: text('displayName', 40, true), major: text('major', 80), bio: text('bio', 280),
        interests: tags, avatar: input.avatar, meetupActivities: [...new Set(input.meetupActivities)], meetupOpen: input.meetupOpen };
}
export function sharedInterests(a, b) {
    const own = new Set((a?.interests || []).map(item => item.toLowerCase()));
    return (b?.interests || []).filter(item => own.has(item.toLowerCase()));
}
