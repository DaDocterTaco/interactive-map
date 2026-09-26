// Isolated UI preview: conversations are sample arrays in browser memory and
// reset on refresh. The live app is implemented in the parent LiveChat folder.
const chats = {
  campus: { name: 'Campus public chat', type: 'Public', description: 'A shared space for the FIU community.', messages: [
    { author: 'Alex Morgan', text: 'Anyone on campus working on their hackathon project tonight?', time: '6:42 PM' },
    { author: 'Sam Rivera', text: 'Our team is at Green Library! Come join us — we have a few seats open.', time: '6:44 PM' },
    { author: 'You', text: 'Working on the campus chat. See you there!', time: '6:45 PM' }
  ] },
  study: { name: 'Library study group', type: 'Public group', description: 'Find a study buddy and share a table.', messages: [{ author: 'Sam Rivera', text: 'What is everyone studying today?', time: '6:30 PM' }] },
  team: { name: 'Hackathon team', type: 'Private group', description: 'Sample private group. Member permissions are not connected yet.', messages: [{ author: 'Alex Morgan', text: 'The map is coming together. Let’s connect the chat next!', time: '6:35 PM' }] },
  direct: { name: 'Alex Morgan', type: 'Direct message', description: 'Sample direct conversation.', messages: [{ author: 'Alex Morgan', text: 'Hey! How is the chat screen going?', time: '6:40 PM' }] }
};

let currentChat = 'campus';
const messageList = document.querySelector('#message-list');
const conversationPanel = document.querySelector('#conversation-panel');
const warningsPanel = document.querySelector('#warnings-panel');
const status = document.querySelector('#status');
const chatDialog = document.querySelector('#new-chat-dialog');

// textContent displays user input as text, without interpreting it as HTML.
function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendMessage(message) {
  const item = makeElement('li', `message${message.author === 'You' ? ' own' : ''}`);
  const meta = makeElement('div', 'message-meta');
  meta.append(makeElement('strong', '', message.author), makeElement('time', '', message.time));
  item.append(meta, makeElement('p', 'message-text', message.text));
  messageList.append(item);
}

function selectNavigation(button) {
  document.querySelectorAll('.chat-choice').forEach(choice => {
    choice.classList.remove('active');
    choice.removeAttribute('aria-current');
  });
  button.classList.add('active');
  button.setAttribute('aria-current', 'true');
}

function showChat(id, button) {
  currentChat = id;
  const chat = chats[id];
  conversationPanel.hidden = false;
  warningsPanel.hidden = true;
  document.querySelector('#conversation-title').textContent = chat.name;
  document.querySelector('#conversation-description').textContent = chat.description;
  document.querySelector('#visibility-badge').textContent = chat.type;
  document.querySelector('#message-input').placeholder = `Message ${chat.name}…`;
  document.querySelector('#message-form').reset();
  messageList.replaceChildren();
  chat.messages.forEach(appendMessage);
  selectNavigation(button);
  status.textContent = '';
}

document.querySelector('.chat-navigation').addEventListener('click', event => {
  const button = event.target.closest('[data-chat]');
  if (button) showChat(button.dataset.chat, button);
});

document.querySelector('#message-form').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#message-input');
  const text = input.value.trim();
  if (!text) { input.setCustomValidity('Write a message first.'); input.reportValidity(); return; }
  const message = { author: 'You', text, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
  chats[currentChat].messages.push(message);
  appendMessage(message);
  input.value = '';
  input.focus();
  const body = document.querySelector('.conversation-body');
  body.scrollTop = body.scrollHeight;
  status.textContent = 'Demo message added on this page only.';
});

document.querySelectorAll('input, textarea').forEach(input => {
  input.addEventListener('input', () => input.setCustomValidity(''));
});

document.querySelector('#warnings-button').addEventListener('click', event => {
  conversationPanel.hidden = true;
  warningsPanel.hidden = false;
  selectNavigation(event.currentTarget);
  status.textContent = '';
});

document.querySelector('#report-form').addEventListener('submit', event => {
  event.preventDefault();
  const location = document.querySelector('#report-location');
  const description = document.querySelector('#report-description');
  if (!description.value.trim()) { description.setCustomValidity('Describe the concern first.'); description.reportValidity(); return; }
  const card = makeElement('li', 'report-card');
  card.append(makeElement('strong', '', location.selectedOptions[0].textContent), makeElement('p', '', description.value.trim()), makeElement('small', '', 'Unverified · Demo report · Not published to the map'));
  document.querySelector('#report-list').prepend(card);
  document.querySelector('#reports-empty').hidden = true;
  event.target.reset();
  status.textContent = 'Demo report added. Verification and map markers are not connected yet.';
});

document.querySelector('#new-chat-button').addEventListener('click', () => chatDialog.showModal());
document.querySelector('#close-dialog').addEventListener('click', () => chatDialog.close());
document.querySelector('#new-chat-form').addEventListener('submit', event => {
  event.preventDefault();
  const nameInput = document.querySelector('#chat-name');
  const name = nameInput.value.trim();
  if (!name) { nameInput.setCustomValidity('Enter a name first.'); nameInput.reportValidity(); return; }
  const type = document.querySelector('#chat-type').value;
  const id = `demo-${Object.keys(chats).length}`;
  chats[id] = { name, type, description: 'Local preview. No invitations have been sent.', messages: [] };
  const button = makeElement('button', 'chat-choice');
  button.type = 'button';
  button.dataset.chat = id;
  const details = makeElement('span', '');
  details.append(makeElement('strong', '', name), makeElement('small', '', `${type} · Demo`));
  button.append(makeElement('span', 'chat-icon', '#'), details);
  document.querySelector('.chat-navigation').append(button);
  chatDialog.close();
  event.target.reset();
  showChat(id, button);
  status.textContent = 'Demo chat created on this page only.';
  document.querySelector('#message-input').focus();
});

chats.campus.messages.forEach(appendMessage);
