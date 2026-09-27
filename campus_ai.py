#NOTE: This script MUST be running to initiate a Python server that provides Gemini with instruction for the campus map's chatbot

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

#Update: now including alerts from forum posts
try:
    with open('forum_alerts.json', 'r') as f:
        alerts_data = f.read()
except FileNotFoundError:
        alerts_data = "No events data available."

# 3. Create the endpoint that your website will talk to
@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')

    prompt = f"""
    You are a helpful Florida International University (FIU) campus map assistant.
    For questions about specific campus locations or today's schedule, use the provided BUILDINGS DATA and EVENTS DATA below.
    You can also provide users information about current warnings or alerts on campus as posted from forum posts using ALERTS DATA below.
    For general questions about FIU (history, admissions, mascots, academic programs), use your own general knowledge.
    Keep answers concise, friendly, and formatted in Markdown.

    BUILDINGS DATA:
    {buildings_data}

    EVENTS DATA:
    {events_data}

    ALERTS DATA:
    {alerts_data}

    USER QUESTION:
    {user_message}
    """

    try:
        response = client.models.generate_content(
            model='gemini-3.5-flash-lite', #WARNING: Free plan limits this model to 500 responses per day (RPD)
            contents=prompt,
        )
        return jsonify({'reply': response.text})
    except Exception as e:
        print("Error:", e)
        return jsonify({'reply': "Sorry, I ran into an error getting that info."}), 500

if __name__ == '__main__':
    app.run(port=5000, debug=True)