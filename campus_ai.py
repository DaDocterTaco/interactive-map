import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from google import genai
from dotenv import load_dotenv

# 1. Load the secure environment variables
load_dotenv()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

app = Flask(__name__)
CORS(app) 

client = genai.Client(api_key=GEMINI_API_KEY)

# 2. Load your JSON data into memory
try:
    with open('buildings.json', 'r') as f:
        buildings_data = f.read()
except FileNotFoundError:
    buildings_data = "No building data available."

try:
    with open('events.json', 'r') as f:
        events_data = f.read()
except FileNotFoundError:
    events_data = "No event data available."

# 3. Create the endpoint that your website will talk to
@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')

    prompt = f"""
    You are a helpful FIU campus map assistant.
    Answer the user's question using ONLY the provided building and event data below.
    If the question cannot be answered using this data, politely inform them that you only have information on FIU campus buildings and events.
    Keep answers concise and friendly.

    BUILDINGS DATA:
    {buildings_data}

    EVENTS DATA:
    {events_data}

    USER QUESTION:
    {user_message}
    """

    try:
        response = client.models.generate_content(
            model='gemini-3.8-flash',
            contents=prompt,
        )
        return jsonify({'reply': response.text})
    except Exception as e:
        print("Error:", e)
        return jsonify({'reply': "Sorry, I ran into an error getting that info."}), 500

if __name__ == '__main__':
    app.run(port=5000, debug=True)